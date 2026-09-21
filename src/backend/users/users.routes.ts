import { Express } from 'express';
import bodyParser from 'body-parser';
import { UsersController, UsersContextHelpers } from './users.controller';

export interface UserModuleDependencies extends UsersContextHelpers {
    backofficeAuth: any;
}

/**
 * Registra todas las rutas de Usuarios, Autenticación y Perfil
 */
export function registerUserRoutes(app: Express, deps: UserModuleDependencies) {
    const controller = new UsersController(deps);
    const auth = deps.backofficeAuth;
    const json = bodyParser.json();

    // --- AUTH & ME ---
    app.post('/api/backoffice/auth', json, controller.auth);
    app.get('/api/backoffice/me', auth, controller.me);

    // --- USUARIOS ---
    app.get('/api/backoffice/users', auth, controller.list);
    app.post('/api/backoffice/users', auth, json, controller.create);
    app.put('/api/backoffice/users/:id', auth, json, controller.update);
    app.delete('/api/backoffice/users/:id', auth, controller.delete);

    // --- ASIGNACIÓN DE CHAT A USUARIO ---
    app.post('/api/backoffice/chat/assign', auth, json, controller.assignChat);

    console.log('✅ [Users Module] Rutas de Usuarios y Autenticación registradas exitosamente en src/backend/users.');
}
