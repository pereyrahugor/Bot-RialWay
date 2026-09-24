import { Express } from 'express';
import bodyParser from 'body-parser';
import { NotificationsController, NotificationsContextHelpers } from './notifications.controller';

export interface NotificationModuleDependencies extends NotificationsContextHelpers {
    backofficeAuth: any;
}

/**
 * Registra todas las rutas de Notificaciones del Sistema y Mensajes Rápidos
 */
export function registerNotificationRoutes(app: Express, deps: NotificationModuleDependencies) {
    const controller = new NotificationsController(deps);
    const auth = deps.backofficeAuth;
    const json = bodyParser.json();

    // --- NOTIFICACIONES ---
    app.get('/api/backoffice/notifications/status', auth, controller.getStatus);
    app.post('/api/backoffice/notifications/activate', auth, json, controller.activate);
    app.post('/api/backoffice/notifications/deactivate', auth, json, controller.deactivate);
    app.get('/api/backoffice/notifications', auth, controller.list);
    app.post('/api/backoffice/notifications/read', auth, json, controller.markRead);

    // --- MENSAJES RÁPIDOS ---
    app.get('/api/backoffice/quick-messages', auth, controller.listQuickMessages);
    app.post('/api/backoffice/quick-messages', auth, json, controller.createQuickMessage);
    app.delete('/api/backoffice/quick-messages/:id', auth, controller.deleteQuickMessage);

    // --- BANNER SUPERIOR DE NOVEDADES Y ERRORES ---
    app.get('/api/backoffice/system-banner', controller.getSystemBanner);
    app.post('/api/backoffice/system-banner', auth, json, controller.setSystemBanner);

    console.log('✅ [Notification Module] Rutas de Notificaciones y Mensajes Rápidos registradas exitosamente en src/backend/notifications.');
}
