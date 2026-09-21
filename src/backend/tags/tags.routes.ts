import { Express } from 'express';
import bodyParser from 'body-parser';
import { TagsController, TagsContextHelpers } from './tags.controller';

export interface TagsModuleDependencies extends TagsContextHelpers {
    backofficeAuth: any;
}

/**
 * Registra todas las rutas de Tags/Etiquetas de forma modular y desacoplada
 */
export function registerTagsRoutes(app: Express, deps: TagsModuleDependencies) {
    const controller = new TagsController(deps);
    const auth = deps.backofficeAuth;
    const json = bodyParser.json();

    app.get('/api/backoffice/tags', auth, controller.listTags);
    app.post('/api/backoffice/tags', auth, json, controller.createTag);
    app.put('/api/backoffice/tags/:id', auth, json, controller.updateTag);
    app.delete('/api/backoffice/tags/:id', auth, controller.deleteTag);
    app.post('/api/backoffice/chats/:chatId/tags', auth, json, controller.addTagToChat);
    app.delete('/api/backoffice/chats/:chatId/tags/:tagId', auth, controller.removeTagFromChat);

    console.log('✅ [Tags Module] Rutas de Etiquetas registradas exitosamente en src/backend/tags.');
}
