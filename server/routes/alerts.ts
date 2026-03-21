import { Router } from 'express';
import { Resend } from 'resend';

const router = Router();
const resend = new Resend(process.env.RESEND_API_KEY);

router.post('/send-alert', async (req, res) => {
  const { documentName, analysisResult, userEmail } = req.body;

  if (!documentName || !analysisResult) {
    res.status(400).json({ error: 'Faltan campos requeridos: documentName, analysisResult' });
    return;
  }

  const to = process.env.ALERT_EMAIL_TO || userEmail;
  const from = process.env.ALERT_EMAIL_FROM || 'alertas@atlasops.dev';

  if (!to) {
    res.status(400).json({ error: 'No se definió destinatario de correo (ALERT_EMAIL_TO)' });
    return;
  }

  try {
    const { data, error } = await resend.emails.send({
      from,
      to,
      subject: `⚠️ Alerta AtlasOps: Documento requiere atención`,
      html: `
        <div style="font-family: sans-serif; max-width: 600px; margin: 0 auto;">
          <h2 style="color: #dc2626;">⚠️ Alerta de Análisis Documental</h2>
          <p><strong>Documento analizado:</strong> ${escapeHtml(documentName)}</p>
          <hr style="border: 1px solid #e4e4e7;" />
          <h3>Resultado del análisis:</h3>
          <pre style="background:#f4f4f5; padding:16px; border-radius:8px; white-space:pre-wrap;">${escapeHtml(analysisResult)}</pre>
          <p style="color:#71717a; font-size:12px; margin-top:24px;">
            Este mensaje fue generado automáticamente por AtlasOps.<br/>
            Por favor revisa el documento en la plataforma.
          </p>
        </div>
      `,
    });

    if (error) {
      console.error('Error de Resend:', error);
      res.status(500).json({ error: error.message });
      return;
    }

    console.log(`Alerta enviada a ${to} para documento "${documentName}" (id: ${data?.id})`);
    res.json({ success: true, id: data?.id });
  } catch (error) {
    console.error('Error inesperado al enviar correo:', error);
    res.status(500).json({ error: 'Error interno al enviar el correo' });
  }
});

function escapeHtml(str: string): string {
  return str
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

export default router;
