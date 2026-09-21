import { Request, Response } from 'express';
import { UsersService } from './users.service';

export interface UsersContextHelpers {
    resolveProjectId: (req: Request) => string | null;
    resolveServiceId: (req: Request) => string | null;
    defaultProjectId?: string;
    defaultServiceId?: string;
}

export class UsersController {
    constructor(private helpers: UsersContextHelpers) {}

    private getContext(req: Request) {
        const projectId = this.helpers.resolveProjectId(req) || this.helpers.defaultProjectId || 'default_project';
        const serviceId = this.helpers.resolveServiceId(req) || this.helpers.defaultServiceId || null;
        return { projectId, serviceId };
    }

    auth = async (req: Request, res: Response) => {
        try {
            const { user, pass } = req.body;
            const { projectId } = this.getContext(req);
            const result = await UsersService.authenticate(user, pass, projectId);
            if (!result.success) {
                return res.status(401).json(result);
            }
            res.json(result);
        } catch (err: any) {
            res.status(500).json({ success: false, error: err.message });
        }
    };

    me = async (req: any, res: Response) => {
        try {
            const { projectId, serviceId } = this.getContext(req);
            const result = await UsersService.getMe(req.auth, projectId, serviceId);
            res.json(result);
        } catch (err: any) {
            res.status(500).json({ success: false, error: err.message });
        }
    };

    list = async (req: Request, res: Response) => {
        try {
            const { projectId } = this.getContext(req);
            const users = await UsersService.listUsers(projectId);
            res.json(users);
        } catch (err: any) {
            res.status(500).json({ success: false, error: err.message });
        }
    };

    create = async (req: any, res: Response) => {
        try {
            if (!req.auth?.isAdmin) {
                return res.status(403).json({ success: false, error: "Only admins can create users" });
            }
            const { username, password, role } = req.body;
            const { projectId } = this.getContext(req);
            const result = await UsersService.createUser(username, password, role, projectId);
            res.json(result);
        } catch (err: any) {
            res.status(500).json({ success: false, error: err.message });
        }
    };

    update = async (req: any, res: Response) => {
        try {
            if (!req.auth?.isAdmin) {
                return res.status(403).json({ success: false, error: "Only admins can modify users" });
            }
            const { id } = req.params;
            const { role, username, password } = req.body;
            const { projectId } = this.getContext(req);
            const result = await UsersService.updateUser(id, { role, username, password }, projectId);
            res.json(result);
        } catch (err: any) {
            res.status(500).json({ success: false, error: err.message });
        }
    };

    delete = async (req: any, res: Response) => {
        try {
            if (!req.auth?.isAdmin) {
                return res.status(403).json({ success: false, error: "Only admins can delete users" });
            }
            const { id } = req.params;
            const { projectId } = this.getContext(req);
            const result = await UsersService.deleteUser(id, projectId);
            res.json(result);
        } catch (err: any) {
            res.status(500).json({ success: false, error: err.message });
        }
    };

    assignChat = async (req: Request, res: Response) => {
        try {
            const { chatId, userId } = req.body;
            const { projectId, serviceId } = this.getContext(req);
            const result = await UsersService.assignChatToUser(chatId, userId, projectId, serviceId);
            res.json(result);
        } catch (err: any) {
            res.status(500).json({ success: false, error: err.message });
        }
    };
}
