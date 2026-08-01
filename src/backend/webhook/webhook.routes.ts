import bodyParser from 'body-parser';
import { HistoryHandler, supabase } from '../db/historyHandler';
import { backofficeAuth } from '../backoffice/middleware/auth';

function resolveProjectId(req: any): string {
    return req.query.projectId || (req.body && req.body.projectId) || req.headers['x-project-id'] || (req.auth && req.auth.projectId) || HistoryHandler.PROJECT_IDENTIFIER || 'default';
}

function resolveServiceId(req: any): string {
    return req.query.serviceId || (req.body && req.body.serviceId) || req.headers['x-service-id'] || (req.auth && req.auth.serviceId) || HistoryHandler.SERVICE_IDENTIFIER || 'default';
}

export const registerWebhookRoutes = (app: any) => {
    // 1. GET /api/backoffice/webhooks/config -> Retorna la configuración actual
    app.get('/api/backoffice/webhooks/config', backofficeAuth, async (req: any, res: any) => {
        try {
            const projectId = resolveProjectId(req);
            
            const webhookUrl = await HistoryHandler.getSetting('WEBHOOK_URL', projectId) || '';
            const webhookSecret = await HistoryHandler.getSetting('WEBHOOK_SECRET', projectId) || '';
            const webhookEventsRaw = await HistoryHandler.getSetting('WEBHOOK_EVENTS', projectId) || '[]';
            
            let webhookEvents: string[] = [];
            try {
                if (webhookEventsRaw.trim().startsWith('[')) {
                    webhookEvents = JSON.parse(webhookEventsRaw);
                } else if (webhookEventsRaw.trim() !== '') {
                    webhookEvents = webhookEventsRaw.split(',').map((s: string) => s.trim());
                }
            } catch {
                webhookEvents = webhookEventsRaw.split(',').map((s: string) => s.trim());
            }

            res.json({
                success: true,
                config: {
                    webhookUrl,
                    webhookSecret,
                    webhookEvents
                }
            });
        } catch (err: any) {
            console.error('[WebhookRoutes] Error GET config:', err.message);
            res.status(500).json({ success: false, error: err.message });
        }
    });

    // 2. POST /api/backoffice/webhooks/config -> Actualiza la configuración del webhook
    app.post('/api/backoffice/webhooks/config', backofficeAuth, bodyParser.json(), async (req: any, res: any) => {
        try {
            const projectId = resolveProjectId(req);
            const serviceId = resolveServiceId(req);
            const { webhookUrl, webhookSecret, webhookEvents } = req.body;

            if (webhookUrl && !webhookUrl.startsWith('http') && webhookUrl.trim() !== '') {
                return res.status(400).json({ success: false, error: 'La URL del webhook debe comenzar con http o https' });
            }

            // Convertir webhookEvents a formato string JSON para almacenar en settings
            const eventsValue = Array.isArray(webhookEvents) ? JSON.stringify(webhookEvents) : '[]';

            // Guardar settings en Supabase usando upsert
            const settingsToUpsert = [
                { project_id: projectId, service_id: serviceId, key: 'WEBHOOK_URL', value: (webhookUrl || '').trim(), updated_at: new Date().toISOString() },
                { project_id: projectId, service_id: serviceId, key: 'WEBHOOK_SECRET', value: (webhookSecret || '').trim(), updated_at: new Date().toISOString() },
                { project_id: projectId, service_id: serviceId, key: 'WEBHOOK_EVENTS', value: eventsValue, updated_at: new Date().toISOString() }
            ];

            const { error } = await supabase
                .from('settings')
                .upsert(settingsToUpsert, { onConflict: 'project_id,key' });

            if (error) throw error;

            // Invalidad caches en HistoryHandler
            (HistoryHandler as any).settingsCache?.clear();

            res.json({ success: true, message: 'Configuración de webhooks guardada correctamente' });
        } catch (err: any) {
            console.error('[WebhookRoutes] Error POST config:', err.message);
            res.status(500).json({ success: false, error: err.message });
        }
    });

    // 3. POST /api/backoffice/webhooks/test -> Envía un evento de prueba
    app.post('/api/backoffice/webhooks/test', backofficeAuth, bodyParser.json(), async (req: any, res: any) => {
        try {
            const projectId = resolveProjectId(req);
            const serviceId = resolveServiceId(req);
            const { webhookUrl, webhookSecret } = req.body;

            if (!webhookUrl || !webhookUrl.startsWith('http')) {
                return res.status(400).json({ success: false, error: 'Proporcione una URL de webhook de prueba válida' });
            }

            const testPayload = {
                event: 'test.connection',
                timestamp: new Date().toISOString(),
                project_id: projectId,
                service_id: serviceId,
                data: {
                    message: '¡Prueba de webhook de Neurolinks exitosa!',
                    version: '1.0.0',
                    details: 'Este evento simula una conexión de webhook exitosa desde Neurolinks.'
                }
            };

            const bodyStr = JSON.stringify(testPayload);
            const headers: Record<string, string> = {
                'Content-Type': 'application/json'
            };

            if (webhookSecret && webhookSecret.trim() !== '') {
                const crypto = await import('crypto');
                const hmac = crypto.createHmac('sha256', webhookSecret);
                hmac.update(bodyStr);
                headers['X-Neurolinks-Signature'] = hmac.digest('hex');
            }

            console.log(`🧪 [WebhookRoutes] Enviando evento de prueba a ${webhookUrl}...`);
            
            try {
                const axios = (await import('axios')).default;
                const response = await axios.post(webhookUrl, bodyStr, { headers, timeout: 5000 });
                res.json({
                    success: true,
                    status: response.status,
                    statusText: response.statusText,
                    message: `Evento de prueba enviado con éxito. Código de respuesta: ${response.status}`
                });
            } catch (postErr: any) {
                console.warn('[WebhookRoutes] Error enviando webhook de prueba:', postErr.message);
                res.status(502).json({
                    success: false,
                    error: `Error de conexión con el servidor destino: ${postErr.message}`,
                    details: postErr.response?.data || null
                });
            }

        } catch (err: any) {
            console.error('[WebhookRoutes] Error en test webhook:', err.message);
            res.status(500).json({ success: false, error: err.message });
        }
    });
};
