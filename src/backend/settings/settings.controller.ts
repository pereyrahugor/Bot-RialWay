import { Request, Response } from 'express';
import { SettingsService } from './settings.service';
import { historyEvents } from '../db/historyHandler';

export interface SettingsContextHelpers {
    resolveProjectId: (req: any) => string;
    resolveServiceId: (req: any) => string;
    defaultProjectId?: string;
    defaultServiceId?: string;
}

export class SettingsController {
    constructor(private helpers: SettingsContextHelpers) {}

    private getProjectId(req: Request): string {
        return this.helpers.resolveProjectId(req) || this.helpers.defaultProjectId || '';
    }

    private getServiceId(req: Request): string {
        return this.helpers.resolveServiceId(req) || this.helpers.defaultServiceId || '';
    }

    getSetting = async (req: any, res: Response) => {
        const key = req.query.key as string;
        if (!key) return res.status(400).json({ success: false, error: 'key is required' });
        try {
            const projectId = this.getProjectId(req);
            const serviceId = this.getServiceId(req);
            const value = await SettingsService.getSetting(key, projectId, serviceId);
            res.json({ success: true, value });
        } catch (error: any) {
            res.status(500).json({ success: false, error: error.message });
        }
    };

    saveSetting = async (req: any, res: Response) => {
        const { key, value } = req.body;
        if (!key) return res.status(400).json({ success: false, error: 'key is required' });
        try {
            const PROTECTED_KEYS = ['OPENAI_ADMIN_API_KEY', 'OPENAI_API_KEY_TOOLS'];
            if (PROTECTED_KEYS.includes(key)) {
                return res.status(403).json({ success: false, error: 'Esta variable es estática y solo puede editarse vía base de datos.' });
            }
            const projectId = this.getProjectId(req);
            const serviceId = this.getServiceId(req);

            // Protección de seguridad para el entorno de Demo (Sandbox)
            if (serviceId === '8f906621-de6d-441a-97bc-fa732cf36456') {
                const DEMO_IMMUTABLE_KEYS = ['ADMIN_PASS', 'ADMIN_USER', 'SUPABASE_KEY', 'SUPABASE_URL', 'RAILWAY_TOKEN', 'OPENAI_API_KEY'];
                if (DEMO_IMMUTABLE_KEYS.includes(key) && !req.auth?.isSuperAdmin) {
                    return res.status(403).json({
                        success: false,
                        error: 'Esta credencial está protegida en el entorno de demostración para preservar la disponibilidad del sandbox.'
                    });
                }
            }

            await SettingsService.saveSetting(key, value, projectId, serviceId);
            if (key === 'GLOBAL_BOT_ENABLED' || key === 'HUMAN_INACTIVITY_TIMEOUT_MINUTES') {
                historyEvents.emit('setting_changed', { key, value, projectId, serviceId });
            }
            res.json({ success: true });
        } catch (error: any) {
            res.status(500).json({ success: false, error: error.message });
        }
    };

    saveSettingsBulk = async (req: any, res: Response) => {
        const { settings } = req.body;
        if (!settings || typeof settings !== 'object') {
            return res.status(400).json({ success: false, error: 'settings object is required' });
        }

        try {
            const projectId = this.getProjectId(req);
            const serviceId = this.getServiceId(req);

            const { savedCount, omittedCount } = await SettingsService.saveSettingsBulk(settings, projectId, serviceId);

            res.json({
                success: true,
                message: `${savedCount} variables guardadas (se omitieron ${omittedCount} protegidas)`
            });
        } catch (error: any) {
            console.error('[SettingsController] Error al guardar settings bulk:', error.message);
            res.status(500).json({ success: false, error: error.message });
        }
    };

    getProjectServices = async (req: any, res: Response) => {
        try {
            const projectId = this.getProjectId(req);
            const serviceId = this.getServiceId(req);

            const result = await SettingsService.getProjectServicesWithMetadata(projectId, serviceId);
            if (!result.isSupervisorActive) {
                return res.json({ success: true, services: [], isSupervisorActive: false });
            }

            res.json({ success: true, services: result.services });
        } catch (error: any) {
            console.error('[SettingsController] Error al obtener servicios del proyecto:', error.message);
            res.status(500).json({ success: false, error: error.message });
        }
    };

    getAllSettings = async (req: any, res: Response) => {
        try {
            const projectId = this.getProjectId(req);
            const serviceId = this.getServiceId(req);

            const settings = await SettingsService.getMergedSettings(projectId, serviceId);
            res.json(settings);
        } catch (error: any) {
            res.status(500).json({ success: false, error: error.message });
        }
    };
}
