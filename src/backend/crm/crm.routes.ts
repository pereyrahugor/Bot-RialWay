import { Express } from 'express';
import bodyParser from 'body-parser';
import { CrmController, CrmContextHelpers } from './crm.controller';

export interface CrmModuleDependencies extends CrmContextHelpers {
    backofficeAuth: any;
}

/**
 * Registra todas las rutas del CRM y Tickets de forma limpia y desacoplada
 */
export function registerCrmRoutes(app: Express, deps: CrmModuleDependencies) {
    const controller = new CrmController(deps);
    const auth = deps.backofficeAuth;
    const json = bodyParser.json();

    // --- TICKETS ---
    app.get('/api/backoffice/tickets/pending-count', auth, controller.getPendingCount);
    app.get('/api/backoffice/tickets', auth, controller.listTickets);
    app.post('/api/backoffice/tickets', auth, json, controller.createTicket);
    app.put('/api/backoffice/tickets/:id', auth, json, controller.updateTicket);
    app.delete('/api/backoffice/tickets/:id', auth, controller.deleteTicket);

    // --- CRM TICKETS & LEADS ---
    app.put('/api/backoffice/crm/ticket/:id', auth, json, controller.updateLeadAndTicket);
    app.post('/api/backoffice/crm/bulk-delete-leads', auth, json, controller.bulkDeleteLeads);
    app.get('/api/backoffice/leads', auth, controller.listLeads);
    app.post('/api/backoffice/crm/update-lead', auth, json, controller.updateLead);

    // --- CRM CONFIG & TAREAS (KANBAN) ---
    app.get('/api/backoffice/crm/config', auth, controller.getConfig);
    app.post('/api/backoffice/crm/config', auth, json, controller.saveConfig);
    app.get('/api/backoffice/crm/tasks', auth, controller.getTasks);

    // --- ASIGNACIÓN DE CHAT / OPERADOR ---
    app.post('/api/backoffice/chat/assign', auth, json, controller.assignChat);

    console.log('✅ [CRM Module] Rutas de CRM y Tickets registradas exitosamente en src/backend/crm.');
}
