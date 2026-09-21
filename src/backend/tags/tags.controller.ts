import { Request, Response } from 'express';
import { TagsService } from './tags.service';

export interface TagsContextHelpers {
    resolveProjectId: (req: Request) => string | null;
    resolveServiceId: (req: Request) => string | null;
    defaultProjectId?: string;
    defaultServiceId?: string;
}

export class TagsController {
    constructor(private helpers: TagsContextHelpers) {}

    private getContext(req: Request) {
        const projectId = this.helpers.resolveProjectId(req) || this.helpers.defaultProjectId || null;
        const serviceId = this.helpers.resolveServiceId(req) || this.helpers.defaultServiceId || null;
        return { projectId, serviceId };
    }

    listTags = async (req: Request, res: Response) => {
        try {
            const { projectId, serviceId } = this.getContext(req);
            const tags = await TagsService.getTags(projectId, serviceId);
            res.json(tags);
        } catch (err: any) {
            res.status(500).json({ success: false, error: err.message });
        }
    };

    createTag = async (req: Request, res: Response) => {
        try {
            const { name, color } = req.body;
            const { projectId, serviceId } = this.getContext(req);
            const result = await TagsService.createTag(name, color, projectId, serviceId);
            res.json(result);
        } catch (err: any) {
            res.status(500).json({ success: false, error: err.message });
        }
    };

    updateTag = async (req: Request, res: Response) => {
        try {
            const { name, color } = req.body;
            const { projectId, serviceId } = this.getContext(req);
            const result = await TagsService.updateTag(req.params.id, name, color, projectId, serviceId);
            res.json(result);
        } catch (err: any) {
            res.status(500).json({ success: false, error: err.message });
        }
    };

    deleteTag = async (req: Request, res: Response) => {
        try {
            const { projectId, serviceId } = this.getContext(req);
            const result = await TagsService.deleteTag(req.params.id, projectId, serviceId);
            res.json(result);
        } catch (err: any) {
            res.status(500).json({ success: false, error: err.message });
        }
    };

    addTagToChat = async (req: Request, res: Response) => {
        try {
            const { tagId } = req.body;
            const { projectId, serviceId } = this.getContext(req);
            const result = await TagsService.addTagToChat(req.params.chatId, tagId, projectId, serviceId);
            res.json(result);
        } catch (err: any) {
            res.status(500).json({ success: false, error: err.message });
        }
    };

    removeTagFromChat = async (req: Request, res: Response) => {
        try {
            const { projectId, serviceId } = this.getContext(req);
            const result = await TagsService.removeTagFromChat(req.params.chatId, req.params.tagId, projectId, serviceId);
            res.json(result);
        } catch (err: any) {
            res.status(500).json({ success: false, error: err.message });
        }
    };
}
