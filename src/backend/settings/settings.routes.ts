import { Express } from 'express';
import bodyParser from 'body-parser';
import { SettingsController, SettingsContextHelpers } from './settings.controller';

export interface SettingsModuleDependencies extends SettingsContextHelpers {
    backofficeAuth: any;
    systemConfigAuth: any;
}

/**
 * Registra todas las rutas del módulo de Configuración y Settings del Backoffice
 */
export function registerSettingsRoutes(app: Express, deps: SettingsModuleDependencies) {
    const controller = new SettingsController(deps);
    const auth = deps.backofficeAuth;
    const configAuth = deps.systemConfigAuth;
    const json = bodyParser.json();

    app.get('/api/backoffice/get-setting', auth, controller.getSetting);
    app.post('/api/backoffice/save-setting', auth, json, controller.saveSetting);
    app.post('/api/backoffice/save-settings-bulk', configAuth, json, controller.saveSettingsBulk);
    app.get('/api/backoffice/project-services', auth, controller.getProjectServices);
    app.get('/api/backoffice/settings', auth, controller.getAllSettings);

    console.log('✅ [Settings Module] Rutas de Configuración y Settings registradas exitosamente en src/backend/settings.');
}
