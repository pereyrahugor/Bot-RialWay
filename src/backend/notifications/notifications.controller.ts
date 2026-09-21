import { Request, Response } from 'express';
import { NotificationsService } from './notifications.service';

export interface NotificationsContextHelpers {
    resolveProjectId: (req: Request) => string | null;
    resolveServiceId: (req: Request) => string | null;
    defaultProjectId?: string;
    defaultServiceId?: string;
}

export class NotificationsController {
    constructor(private helpers: NotificationsContextHelpers) {}

    private getContext(req: Request) {
        const projectId = this.helpers.resolveProjectId(req) || this.helpers.defaultProjectId || 'default_project';
        const serviceId = this.helpers.resolveServiceId(req) || this.helpers.defaultServiceId || null;
        return { projectId, serviceId };
    }

    getStatus = async (_req: Request, res: Response) => {
        try {
            res.json({ active: true });
        } catch (e: any) {
            res.status(500).json({ success: false, error: e.message });
        }
    };

    activate = async (req: Request, res: Response) => {
        try {
            const { projectId } = this.getContext(req);
            await NotificationsService.activate(projectId);
            res.json({ success: true });
        } catch (e: any) {
            res.status(500).json({ success: false, error: e.message });
        }
    };

    deactivate = async (req: Request, res: Response) => {
        try {
            const { projectId } = this.getContext(req);
            await NotificationsService.deactivate(projectId);
            res.json({ success: true });
        } catch (e: any) {
            res.status(500).json({ success: false, error: e.message });
        }
    };

    list = async (req: Request, res: Response) => {
        try {
            const { projectId, serviceId } = this.getContext(req);
            const limit = parseInt(req.query.limit as string) || 20;
            const offset = parseInt(req.query.offset as string) || 0;

            const notifications = await NotificationsService.getSystemNotifications(projectId, serviceId, limit, offset);
            const totalUnread = await NotificationsService.getUnreadNotificationsCount(projectId, serviceId);

            res.json({
                success: true,
                data: notifications,
                unread_count: totalUnread
            });
        } catch (e: any) {
            res.status(500).json({ success: false, error: e.message });
        }
    };

    markRead = async (req: Request, res: Response) => {
        try {
            const { projectId, serviceId } = this.getContext(req);
            const { ids } = req.body;

            if (!Array.isArray(ids) || ids.length === 0) {
                return res.status(400).json({ success: false, error: 'Se requiere una lista de IDs válida.' });
            }

            const ok = await NotificationsService.markNotificationsAsRead(projectId, serviceId, ids);
            let unread_notifications_count = 0;
            if (ok) {
                unread_notifications_count = await NotificationsService.getUnreadNotificationsCount(projectId, serviceId);
            }
            res.json({ success: ok, unread_notifications_count });
        } catch (e: any) {
            res.status(500).json({ success: false, error: e.message });
        }
    };

    listQuickMessages = async (req: Request, res: Response) => {
        try {
            const { projectId, serviceId } = this.getContext(req);
            const messages = await NotificationsService.getQuickMessages(projectId, serviceId);
            res.json(messages);
        } catch (err: any) {
            res.status(500).json({ success: false, error: err.message });
        }
    };

    createQuickMessage = async (req: Request, res: Response) => {
        try {
            const { title, message } = req.body;
            if (!title || !message) {
                return res.status(400).json({ success: false, error: 'title and message are required' });
            }
            const { projectId, serviceId } = this.getContext(req);
            const result = await NotificationsService.createQuickMessage(projectId, title, message, serviceId);
            res.json(result);
        } catch (err: any) {
            res.status(500).json({ success: false, error: err.message });
        }
    };

    deleteQuickMessage = async (req: Request, res: Response) => {
        try {
            const { projectId, serviceId } = this.getContext(req);
            const result = await NotificationsService.deleteQuickMessage(req.params.id, projectId, serviceId);
            res.json({ success: result });
        } catch (err: any) {
            res.status(500).json({ success: false, error: err.message });
        }
    };
}
