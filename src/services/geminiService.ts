import { GoogleGenAI } from "@google/genai";

const ai = new GoogleGenAI({ apiKey: process.env.GEMINI_API_KEY || "" });

export type AgentType = 'classify_doc' | 'review_result' | 'json_output' | 'doc_data' | 'custom';

export interface AnalysisResult {
  text: string;
  usage?: {
    promptTokenCount: number;
    candidatesTokenCount: number;
    totalTokenCount: number;
  };
}

export async function analyzeDocument(
  content: string,
  mimeType: string,
  agentType: AgentType,
  customPrompt?: string
): Promise<AnalysisResult> {
  const TIMEOUT_MS = 120_000; // 2 minutos
  const timeout = new Promise<never>((_, reject) =>
    setTimeout(() => reject(new Error('Tiempo de espera agotado. El modelo tardó demasiado en responder.')), TIMEOUT_MS)
  );

  const request = ai.models.generateContent({
    model: "gemini-3-flash-preview",
    contents: [
      {
        parts: [
          {
            inlineData: {
              data: content.split(',')[1] || content, // Handle data URL or raw base64
              mimeType: mimeType,
            },
          },
          {
            text: getPromptForAgent(agentType, customPrompt),
          },
        ],
      },
    ],
    config: {
      responseMimeType: agentType === 'json_output' ? "application/json" : undefined,
    }
  });

  const response = await Promise.race([request, timeout]);
  let text = response.text || "No response from AI.";
  const usage = response.usageMetadata ? {
    promptTokenCount: response.usageMetadata.promptTokenCount || 0,
    candidatesTokenCount: response.usageMetadata.candidatesTokenCount || 0,
    totalTokenCount: response.usageMetadata.totalTokenCount || 0,
  } : undefined;

  if (agentType === 'json_output') {
    try {
      const data = JSON.parse(text);
      
      // Only apply F30 logic if it's a certificate
      const isF30 = data["tipo_documento"]?.toLowerCase().includes("certificado") || 
                    data["individualizacion_empleador"];

      if (isF30) {
        if (
          (data["multas_no_publicadas"] === "NO REGISTRA" || data["multas_no_publicadas"] === "No registra") &&
          (data["multas_publicadas"] === "NO REGISTRA" || data["multas_publicadas"] === "No registra") &&
          (data["deuda_previsional"] === "NO REGISTRA" || data["deuda_previsional"] === "No registra")
        ) {
          data["Certificado"] = "APROBADO SIN DEUDAS/MULTAS";
        } else {
          data["Certificado"] = "NO APROBADO";
        }
      }
      
      return { text: JSON.stringify(data, null, 2), usage };
    } catch (e) {
      console.error("Error parsing JSON output:", e);
      return { text, usage };
    }
  }

  return { text, usage };
}

function getPromptForAgent(type: AgentType, custom?: string): string {
  switch (type) {
    case 'classify_doc':
      return "Analiza este documento e identifica qué tipo de documento es. Específicamente, determina si es un 'Certificado de Antecedentes Laborales y Previsionales' (F30-1) o una 'Licencia de Conductor'. Si es una Licencia de Conductor, identifica también la 'Clase' (por ejemplo: Clase B, Clase A2, etc.). Responde de forma breve y clara.";
    case 'review_result':
      const today = new Date().toISOString().split('T')[0];
      return `Analiza este documento. 
      
      Si es un 'Certificado de Antecedentes Laborales y Previsionales' (F30):
      - Si no registra multas ni deudas previsionales, responde ÚNICAMENTE 'APROBADO SIN DEUDAS/MULTAS'.
      - De lo contrario, responde 'NO APROBADO'.
      
      Si es una 'Licencia de Conductor':
      1. Indica la Clase de la licencia.
      2. Determina la vigencia: Si la 'Fecha de Control' es posterior a hoy (${today}), indica 'VIGENTE'. De lo contrario, indica 'VENCIDA'.
      3. Indica restricciones: Si no tiene, indica 'SIN RESTRICCIONES'. Si tiene, indica 'CON RESTRICCIONES' y detalla cuáles son.`;
    case 'json_output':
      return `Analiza este documento y extrae la información en formato JSON estrictamente.
      
      Si es un 'Certificado de Antecedentes Laborales y Previsionales' (F30), usa esta estructura:
      {
        "tipo_documento": "Certificado de Antecedentes Laborales y Previsionales",
        "individualizacion_empleador": "Información del empleador",
        "multas_no_publicadas": "Estado de multas no publicadas",
        "multas_publicadas": "Estado de multas publicadas",
        "deuda_previsional": "Estado de deuda previsional"
      }
      
      Si es una 'Licencia de Conductor', usa esta estructura (basada en Datos Documento):
      {
        "tipo_documento": "Licencia de Conductor",
        "clase": "Clase de la licencia",
        "nombre_titular": "Nombre completo del titular",
        "fecha_control": "Fecha de control/vencimiento",
        "estado_vigencia": "VIGENTE o VENCIDA (comparado con hoy ${new Date().toISOString().split('T')[0]})",
        "restricciones": "Indicar 'SIN RESTRICCIONES' o 'CON RESTRICCIONES: [detalle]'"
      }`;
    case 'doc_data':
      return "Extrae los datos más relevantes de este documento. Si es una Licencia de Conductor, identifica claramente la Clase, nombre del titular, fecha de control e indica explícitamente si tiene restricciones o no tiene restricciones. Si es un Certificado de Antecedentes Laborales, extrae el empleador y el resumen de multas. Presenta la información de forma estructurada con viñetas y negritas.";
    case 'custom':
      return custom || "Analiza este documento.";
    default:
      return "Analiza este documento.";
  }
}
