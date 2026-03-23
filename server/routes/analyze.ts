import { Router, Request, Response } from 'express';
import { GoogleGenAI } from "@google/genai";

const router = Router();
const ai = new GoogleGenAI({ apiKey: process.env.GEMINI_API_KEY || "" });

type AgentType = 'classify_doc' | 'review_result' | 'json_output' | 'doc_data' | 'custom';

router.post('/', async (req: Request, res: Response) => {
  const { storageUrl, content, mimeType, agentType, customPrompt } = req.body;

  if (!mimeType || !agentType) {
    res.status(400).json({ error: 'Faltan campos requeridos: mimeType, agentType' });
    return;
  }

  try {
    let base64Content: string | undefined = content;

    // Si no hay contenido inline (legacy), descargar desde Firebase Storage en el servidor
    // Esto evita problemas de CORS en el navegador
    if (!base64Content && storageUrl) {
      const fileResponse = await fetch(storageUrl);
      if (!fileResponse.ok) {
        res.status(400).json({ error: 'No se pudo descargar el documento desde Firebase Storage' });
        return;
      }
      const fileBuffer = await fileResponse.arrayBuffer();
      base64Content = Buffer.from(fileBuffer).toString('base64');
    }

    if (!base64Content) {
      res.status(400).json({ error: 'No se proporcionó contenido ni URL del documento' });
      return;
    }

    // Si viene como data URL, extraer solo la parte base64
    const cleanBase64 = base64Content.includes(',') ? base64Content.split(',')[1] : base64Content;

    const TIMEOUT_MS = 120_000; // 2 minutos
    const timeout = new Promise<never>((_, reject) =>
      setTimeout(
        () => reject(new Error('Tiempo de espera agotado. El modelo tardó demasiado en responder.')),
        TIMEOUT_MS
      )
    );

    const request = ai.models.generateContent({
      model: "gemini-1.5-flash",
      contents: [
        {
          parts: [
            { inlineData: { data: cleanBase64, mimeType } },
            { text: getPromptForAgent(agentType as AgentType, customPrompt) },
          ],
        },
      ],
      config: {
        responseMimeType: agentType === 'json_output' ? 'application/json' : undefined,
      },
    });

    const response = await Promise.race([request, timeout]);
    let text = response.text || 'No response from AI.';
    const usage = response.usageMetadata
      ? {
          promptTokenCount: response.usageMetadata.promptTokenCount || 0,
          candidatesTokenCount: response.usageMetadata.candidatesTokenCount || 0,
          totalTokenCount: response.usageMetadata.totalTokenCount || 0,
        }
      : undefined;

    if (agentType === 'json_output') {
      try {
        const data = JSON.parse(text);

        // Lógica de aprobación para certificados F30
        const isF30 =
          data['tipo_documento']?.toLowerCase().includes('certificado') ||
          data['individualizacion_empleador'];

        if (isF30) {
          if (
            (data['multas_no_publicadas'] === 'NO REGISTRA' ||
              data['multas_no_publicadas'] === 'No registra') &&
            (data['multas_publicadas'] === 'NO REGISTRA' ||
              data['multas_publicadas'] === 'No registra') &&
            (data['deuda_previsional'] === 'NO REGISTRA' ||
              data['deuda_previsional'] === 'No registra')
          ) {
            data['Certificado'] = 'APROBADO SIN DEUDAS/MULTAS';
          } else {
            data['Certificado'] = 'NO APROBADO';
          }
        }

        res.json({ text: JSON.stringify(data, null, 2), usage });
        return;
      } catch (e) {
        console.error('Error parsing JSON output:', e);
      }
    }

    res.json({ text, usage });
  } catch (error: any) {
    console.error('Error en análisis Gemini:', error);
    res.status(500).json({ error: error.message || 'Error al analizar el documento' });
  }
});

function getPromptForAgent(type: AgentType, custom?: string): string {
  switch (type) {
    case 'classify_doc':
      return "Analiza este documento e identifica qué tipo de documento es. Específicamente, determina si es un 'Certificado de Antecedentes Laborales y Previsionales' (F30-1) o una 'Licencia de Conductor'. Si es una Licencia de Conductor, identifica también la 'Clase' (por ejemplo: Clase B, Clase A2, etc.). Responde de forma breve y clara.";

    case 'review_result': {
      const today = new Date().toISOString().split('T')[0];
      return `Analiza este documento.

      Si es un 'Certificado de Antecedentes Laborales y Previsionales' (F30):
      - Si no registra multas ni deudas previsionales, responde ÚNICAMENTE 'APROBADO SIN DEUDAS/MULTAS'.
      - De lo contrario, responde 'NO APROBADO'.

      Si es una 'Licencia de Conductor':
      1. Indica la Clase de la licencia.
      2. Determina la vigencia: Si la 'Fecha de Control' es posterior a hoy (${today}), indica 'VIGENTE'. De lo contrario, indica 'VENCIDA'.
      3. Indica restricciones: Si no tiene, indica 'SIN RESTRICCIONES'. Si tiene, indica 'CON RESTRICCIONES' y detalla cuáles son.`;
    }

    case 'json_output': {
      const today = new Date().toISOString().split('T')[0];
      return `Analiza este documento y extrae la información en formato JSON estrictamente.

      Si es un 'Certificado de Antecedentes Laborales y Previsionales' (F30), usa esta estructura:
      {
        "tipo_documento": "Certificado de Antecedentes Laborales y Previsionales",
        "individualizacion_empleador": "Información del empleador",
        "multas_no_publicadas": "Estado de multas no publicadas",
        "multas_publicadas": "Estado de multas publicadas",
        "deuda_previsional": "Estado de deuda previsional"
      }

      Si es una 'Licencia de Conductor', usa esta estructura:
      {
        "tipo_documento": "Licencia de Conductor",
        "clase": "Clase de la licencia",
        "nombre_titular": "Nombre completo del titular",
        "fecha_control": "Fecha de control/vencimiento",
        "estado_vigencia": "VIGENTE o VENCIDA (comparado con hoy ${today})",
        "restricciones": "Indicar 'SIN RESTRICCIONES' o 'CON RESTRICCIONES: [detalle]'"
      }`;
    }

    case 'doc_data':
      return "Extrae los datos más relevantes de este documento. Si es una Licencia de Conductor, identifica claramente la Clase, nombre del titular, fecha de control e indica explícitamente si tiene restricciones o no tiene restricciones. Si es un Certificado de Antecedentes Laborales, extrae el empleador y el resumen de multas. Presenta la información de forma estructurada con viñetas y negritas.";

    case 'custom':
      return custom || 'Analiza este documento.';

    default:
      return 'Analiza este documento.';
  }
}

export default router;
