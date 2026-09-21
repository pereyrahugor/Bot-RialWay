import { Request, Response } from 'express';
import { BlacklistService } from './blacklist.service';

export interface BlacklistContextHelpers {
    resolveProjectId: (req: Request) => string | null;
    resolveServiceId: (req: Request) => string | null;
    defaultProjectId?: string;
    defaultServiceId?: string;
}

export class BlacklistController {
    constructor(private helpers: BlacklistContextHelpers) {}

    private getContext(req: Request) {
        const projectId = this.helpers.resolveProjectId(req) || this.helpers.defaultProjectId || 'default_project';
        const serviceId = this.helpers.resolveServiceId(req) || this.helpers.defaultServiceId || null;
        return { projectId, serviceId };
    }

    getStatus = async (req: Request, res: Response) => {
        try {
            const { projectId, serviceId } = this.getContext(req);
            const active = await BlacklistService.getStatus(projectId, serviceId);
            res.json({ active });
        } catch (e: any) {
            res.status(500).json({ success: false, error: e.message });
        }
    };

    activate = async (req: Request, res: Response) => {
        try {
            const { projectId, serviceId } = this.getContext(req);
            await BlacklistService.activate(projectId, serviceId);
            res.json({ success: true });
        } catch (e: any) {
            res.status(500).json({ success: false, error: e.message });
        }
    };

    deactivate = async (req: Request, res: Response) => {
        try {
            const { projectId, serviceId } = this.getContext(req);
            await BlacklistService.deactivate(projectId, serviceId);
            res.json({ success: true });
        } catch (e: any) {
            res.status(500).json({ success: false, error: e.message });
        }
    };

    list = async (req: Request, res: Response) => {
        try {
            const { projectId, serviceId } = this.getContext(req);
            const entries = await BlacklistService.listEntries(projectId, serviceId);
            res.json(entries);
        } catch (e: any) {
            res.status(500).json({ success: false, error: e.message });
        }
    };

    upsert = async (req: Request, res: Response) => {
        try {
            const { chat_id, sin_bot, bloqueado_crm, notes } = req.body;
            if (!chat_id) return res.status(400).json({ success: false, error: 'chat_id requerido' });
            const { projectId, serviceId } = this.getContext(req);
            await BlacklistService.upsertEntry({ chat_id, sin_bot, bloqueado_crm, notes }, projectId, serviceId);
            res.json({ success: true });
        } catch (e: any) {
            res.status(500).json({ success: false, error: e.message });
        }
    };

    delete = async (req: Request, res: Response) => {
        try {
            const { projectId, serviceId } = this.getContext(req);
            const chatId = req.params.chatId;
            await BlacklistService.deleteEntry(chatId, projectId, serviceId);
            res.json({ success: true });
        } catch (e: any) {
            res.status(500).json({ success: false, error: e.message });
        }
    };

    check = async (req: Request, res: Response) => {
        try {
            const { projectId, serviceId } = this.getContext(req);
            const chatId = req.params.chatId;
            const isBlocked = await BlacklistService.isContactBlacklisted(chatId, projectId, serviceId);
            res.json({ inBlacklist: isBlocked, sin_bot: isBlocked, bloqueado_crm: false });
        } catch (e: any) {
            res.status(500).json({ success: false, error: e.message });
        }
    };

    toggle = async (req: Request, res: Response) => {
        try {
            const { projectId, serviceId } = this.getContext(req);
            const chatId = req.params.chatId;
            const { inBlacklist } = req.body;
            await BlacklistService.toggleEntry(chatId, !!inBlacklist, projectId, serviceId);
            res.json({ success: true, inBlacklist: !!inBlacklist });
        } catch (e: any) {
            res.status(500).json({ success: false, error: e.message });
        }
    };
}
