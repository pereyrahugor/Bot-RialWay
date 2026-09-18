import { Request, Response } from 'express';
import { CrmService } from './crm.service';

export interface CrmContextHelpers {
    resolveProjectId: (req: Request) => string | null;
    resolveServiceId: (req: Request) => string | null;
    getVisibleServiceIds: (projectId: string | null, serviceId: string | null) => Promise<string[]>;
    sendJson: (res: Response, status: number, data: any) => void;
}

export class CrmController {
    constructor(private helpers: CrmContextHelpers) {}

    getPendingCount = async (req: Request, res: Response) => {
        try {
            const projectId = this.helpers.resolveProjectId(req);
            const tipo = req.query.tipo as string;
            const count = await CrmService.getPendingTicketsCount(projectId, tipo);
            res.json({ count });
        } catch (error: any) {
            res.status(500).json({ success: false, error: error.message });
        }
    };

    listTickets = async (req: Request, res: Response) => {
        try {
            const estado = req.query.estado as string;
            const tipo = req.query.tipo as string;
            const id = req.query.id as string;
            const limit = parseInt(req.query.limit as string) || 300;
            const offset = parseInt(req.query.offset as string) || 0;
            const chatId = req.query.chatId as string;
            const projectId = this.helpers.resolveProjectId(req);
            const serviceId = this.helpers.resolveServiceId(req);
            const visibleServices = await this.helpers.getVisibleServiceIds(projectId, serviceId);
            const result = await CrmService.listTickets(
                limit,
                offset,
                estado,
                tipo,
                chatId,
                id,
                projectId,
                visibleServices.join(',')
            );
            res.json(result);
        } catch (error: any) {
            res.status(500).json({ success: false, error: error.message });
        }
    };

    createTicket = async (req: Request, res: Response) => {
        try {
            const { chatId, titulo, descripcion, chats_adjuntos, attachments, tipo } = req.body;
            if (!titulo) {
                return this.helpers.sendJson(res, 400, { success: false, error: 'titulo is required' });
            }
            const adjuntos = Array.isArray(chats_adjuntos) ? chats_adjuntos : [];
            const atts = Array.isArray(attachments) ? attachments : [];
            const projectId = this.helpers.resolveProjectId(req);
            const serviceId = this.helpers.resolveServiceId(req);
            const result = await CrmService.createTicket(
                chatId,
                titulo,
                descripcion,
                tipo || 'Soporte',
                'Media',
                projectId,
                atts,
                adjuntos,
                serviceId
            );
            res.json(result);
        } catch (error: any) {
            res.status(500).json({ success: false, error: error.message });
        }
    };

    updateTicket = async (req: Request, res: Response) => {
        try {
            const { id } = req.params;
            const serviceId = this.helpers.resolveServiceId(req);
            const result = await CrmService.updateTicket(id, req.body, serviceId);
            res.json(result);
        } catch (err: any) {
            res.status(500).json({ success: false, error: err.message });
        }
    };

    updateLeadAndTicket = async (req: Request, res: Response) => {
        try {
            const { id } = req.params;
            const result = await CrmService.updateLeadAndTicket(id, req.body);
            res.json(result);
        } catch (err: any) {
            res.status(500).json({ success: false, error: err.message });
        }
    };

    deleteTicket = async (req: Request, res: Response) => {
        try {
            const { id } = req.params;
            const projectId = this.helpers.resolveProjectId(req);
            const result = await CrmService.deleteTicket(id, projectId);
            res.json(result);
        } catch (err: any) {
            res.status(500).json({ success: false, error: err.message });
        }
    };

    bulkDeleteLeads = async (req: Request, res: Response) => {
        try {
            const { ticketIds } = req.body;
            const projectId = this.helpers.resolveProjectId(req);

            if (!Array.isArray(ticketIds) || ticketIds.length === 0) {
                return this.helpers.sendJson(res, 400, { success: false, error: 'ticketIds array is required' });
            }

            const deletedCount = await CrmService.bulkDeleteLeads(ticketIds, projectId);
            res.json({ success: true, deletedCount });
        } catch (err: any) {
            console.error('[Bulk Delete Leads Error]:', err);
            res.status(500).json({ success: false, error: err.message });
        }
    };

    getConfig = async (req: Request, res: Response) => {
        try {
            const projectId = this.helpers.resolveProjectId(req);
            const serviceId = this.helpers.resolveServiceId(req);
            const config = await CrmService.getCrmConfig(projectId, serviceId);
            res.json({ success: true, config });
        } catch (e: any) {
            res.status(500).json({ success: false, error: e.message });
        }
    };

    saveConfig = async (req: Request, res: Response) => {
        try {
            const { config } = req.body;
            const projectId = this.helpers.resolveProjectId(req);
            const serviceId = this.helpers.resolveServiceId(req);
            await CrmService.saveCrmConfig(config, projectId, serviceId);
            res.json({ success: true });
        } catch (e: any) {
            res.status(500).json({ success: false, error: e.message });
        }
    };

    getTasks = async (req: Request, res: Response) => {
        try {
            const projectId = this.helpers.resolveProjectId(req);
            const serviceId = this.helpers.resolveServiceId(req);
            const visibleServices = await this.helpers.getVisibleServiceIds(projectId, serviceId);
            const tasks = await CrmService.getTasksDashboard(projectId, visibleServices.join(','));
            res.json(tasks);
        } catch (e: any) {
            res.status(500).json({ success: false, error: e.message });
        }
    };

    listLeads = async (req: Request, res: Response) => {
        try {
            const limit = parseInt(req.query.limit as string) || 50;
            const offset = parseInt(req.query.offset as string) || 0;
            const projectId = this.helpers.resolveProjectId(req);
            const serviceId = this.helpers.resolveServiceId(req);
            const visibleServices = await this.helpers.getVisibleServiceIds(projectId, serviceId);
            const result = await CrmService.listEditedLeads(limit, offset, projectId, visibleServices.join(','));
            res.json(result);
        } catch (e: any) {
            res.status(500).json({ success: false, error: e.message });
        }
    };

    updateLead = async (req: Request, res: Response) => {
        const { leadId, crm_status, crm_due_date } = req.body;
        if (!leadId) return res.status(400).json({ success: false, error: 'leadId is required' });

        try {
            const projectId = this.helpers.resolveProjectId(req);
            const serviceId = this.helpers.resolveServiceId(req);
            const result = await CrmService.updateLeadStatus(leadId, crm_status, crm_due_date, projectId, serviceId);
            res.json(result);
        } catch (error: any) {
            res.status(500).json({ success: false, error: error.message });
        }
    };

    assignChat = async (req: Request, res: Response) => {
        const { chatId, agentId, userId } = req.body;
        if (!chatId) return res.status(400).json({ success: false, error: 'chatId is required' });

        try {
            const projectId = this.helpers.resolveProjectId(req);
            const serviceId = this.helpers.resolveServiceId(req);
            console.log(`[BACKOFFICE] Reasignando chat ${chatId}: agentId=${agentId}, userId=${userId}`);
            const result = await CrmService.assignChat(chatId, agentId, userId, projectId, serviceId);
            res.json(result);
        } catch (error: any) {
            console.error('❌ Error en /api/backoffice/chat/assign:', error);
            res.status(500).json({ success: false, error: error.message });
        }
    };
}
