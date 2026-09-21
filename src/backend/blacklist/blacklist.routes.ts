import { Express } from 'express';
import bodyParser from 'body-parser';
import { BlacklistController, BlacklistContextHelpers } from './blacklist.controller';

export interface BlacklistModuleDependencies extends BlacklistContextHelpers {
    backofficeAuth: any;
}

/**
 * Registra todas las rutas de Lista Negra de forma desacoplada
 */
export function registerBlacklistRoutes(app: Express, deps: BlacklistModuleDependencies) {
    const controller = new BlacklistController(deps);
    const auth = deps.backofficeAuth;
    const json = bodyParser.json();

    app.get('/api/backoffice/blacklist/status', auth, controller.getStatus);
    app.post('/api/backoffice/blacklist/activate', auth, json, controller.activate);
    app.post('/api/backoffice/blacklist/deactivate', auth, json, controller.deactivate);
    app.get('/api/backoffice/blacklist', auth, controller.list);
    app.post('/api/backoffice/blacklist', auth, json, controller.upsert);
    app.delete('/api/backoffice/blacklist/:chatId', auth, controller.delete);
    app.get('/api/backoffice/blacklist/check/:chatId', auth, controller.check);
    app.post('/api/backoffice/blacklist/toggle/:chatId', auth, json, controller.toggle);

    console.log('✅ [Blacklist Module] Rutas de Lista Negra registradas exitosamente en src/backend/blacklist.');
}
