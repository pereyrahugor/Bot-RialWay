import { supabase, historyEvents, HistoryHandler } from '../db/historyHandler';
import { LocalHistoryStore } from '../db/localHistoryStore';

export class NotificationsService {
    /**
     * Obtiene todos los mensajes rápidos para un proyecto/servicio.
     */
    static async getQuickMessages(projectId: string, serviceId: string | null = null): Promise<any[]> {
        const currentProjectId = projectId || HistoryHandler.PROJECT_IDENTIFIER;
        const currentServiceId = serviceId || HistoryHandler.SERVICE_IDENTIFIER;
        if (process.env.STORAGE_MODE === "local") {
            return LocalHistoryStore.getQuickMessages(currentProjectId);
        }
        try {
            let query = supabase
                .from('quick_messages')
                .select('*')
                .eq('project_id', currentProjectId);

            if (currentServiceId && currentServiceId !== 'default' && currentServiceId !== 'default_service') {
                query = query.eq('service_id', currentServiceId);
            }

            const { data, error } = await query.order('created_at', { ascending: false });
            if (error) throw error;
            return data || [];
        } catch (err: any) {
            console.error('[NotificationsService] Error en getQuickMessages:', err.message);
            return [];
        }
    }

    /**
     * Crea un nuevo mensaje rápido para el proyecto/servicio.
     */
    static async createQuickMessage(projectId: string, title: string, message: string, serviceId: string | null = null): Promise<any> {
        const currentProjectId = projectId || HistoryHandler.PROJECT_IDENTIFIER;
        const currentServiceId = serviceId || HistoryHandler.SERVICE_IDENTIFIER;
        if (process.env.STORAGE_MODE === "local") {
            return LocalHistoryStore.createQuickMessage(currentProjectId, title, message);
        }
        try {
            const insertData: any = {
                project_id: currentProjectId,
                title,
                message,
                created_at: new Date().toISOString()
            };
            if (currentServiceId && currentServiceId !== 'default' && currentServiceId !== 'default_service') {
                insertData.service_id = currentServiceId;
            }

            const { data, error } = await supabase
                .from('quick_messages')
                .insert(insertData)
                .select()
                .single();

            if (error) throw error;
            return data;
        } catch (err: any) {
            console.error('[NotificationsService] Error en createQuickMessage:', err.message);
            return null;
        }
    }

    /**
     * Elimina un mensaje rápido por su ID.
     */
    static async deleteQuickMessage(id: string, projectId: string, serviceId: string | null = null): Promise<boolean> {
        const currentProjectId = projectId || HistoryHandler.PROJECT_IDENTIFIER;
        const currentServiceId = serviceId || HistoryHandler.SERVICE_IDENTIFIER;
        if (process.env.STORAGE_MODE === "local") {
            return LocalHistoryStore.deleteQuickMessage(id, currentProjectId);
        }
        try {
            let query = supabase
                .from('quick_messages')
                .delete()
                .eq('id', id)
                .eq('project_id', currentProjectId);

            if (currentServiceId && currentServiceId !== 'default' && currentServiceId !== 'default_service') {
                query = query.eq('service_id', currentServiceId);
            }

            const { error } = await query;
            if (error) throw error;
            return true;
        } catch (err: any) {
            console.error('[NotificationsService] Error en deleteQuickMessage:', err.message);
            return false;
        }
    }

    /**
     * Registra una nueva notificación de sistema (ej. error de Meta).
     */
    static async createSystemNotification(
        projectId: string,
        serviceId: string | null,
        type: string,
        title: string,
        description: string,
        metadata: any = {}
    ): Promise<any> {
        const currentProjectId = projectId || HistoryHandler.PROJECT_IDENTIFIER;
        const currentServiceId = serviceId || HistoryHandler.SERVICE_IDENTIFIER;

        if (process.env.STORAGE_MODE === "local") {
            return LocalHistoryStore.createSystemNotification(currentProjectId, currentServiceId, type, title, description, metadata);
        }

        try {
            const insertData: any = {
                project_id: currentProjectId,
                service_id: currentServiceId,
                type,
                title,
                description,
                metadata,
                read: false,
                created_at: new Date().toISOString()
            };

            const { data, error } = await supabase
                .from('system_notifications')
                .insert(insertData)
                .select()
                .single();

            if (error) throw error;

            historyEvents.emit('notification_created', { projectId: currentProjectId, serviceId: currentServiceId, notification: data });
            return data;
        } catch (err: any) {
            console.error('[NotificationsService] Error en createSystemNotification:', err.message);
            return null;
        }
    }

    /**
     * Obtiene notificaciones de sistema paginadas filtrando por project_id y service_id.
     */
    static async getSystemNotifications(
        projectId: string,
        serviceId: string | null,
        limit = 20,
        offset = 0
    ): Promise<any[]> {
        const currentProjectId = projectId || HistoryHandler.PROJECT_IDENTIFIER;
        const currentServiceId = serviceId || HistoryHandler.SERVICE_IDENTIFIER;

        if (process.env.STORAGE_MODE === "local") {
            return LocalHistoryStore.getSystemNotifications(currentProjectId, currentServiceId, limit, offset);
        }

        try {
            let query = supabase
                .from('system_notifications')
                .select('*')
                .eq('project_id', currentProjectId);

            if (currentServiceId && currentServiceId !== 'default' && currentServiceId !== 'default_service') {
                query = query.eq('service_id', currentServiceId);
            }

            const { data, error } = await query
                .order('created_at', { ascending: false })
                .range(offset, offset + limit - 1);

            if (error) throw error;
            return data || [];
        } catch (err: any) {
            console.error('[NotificationsService] Error en getSystemNotifications:', err.message);
            return [];
        }
    }

    /**
     * Marca una o más notificaciones como leídas filtrando por project_id y service_id.
     */
    static async markNotificationsAsRead(
        projectId: string,
        serviceId: string | null,
        notificationIds: string[]
    ): Promise<boolean> {
        const currentProjectId = projectId || HistoryHandler.PROJECT_IDENTIFIER;
        const currentServiceId = serviceId || HistoryHandler.SERVICE_IDENTIFIER;

        if (process.env.STORAGE_MODE === "local") {
            return LocalHistoryStore.markNotificationsAsRead(currentProjectId, currentServiceId, notificationIds);
        }

        try {
            let query = supabase
                .from('system_notifications')
                .update({ read: true })
                .eq('project_id', currentProjectId)
                .in('id', notificationIds);

            if (currentServiceId && currentServiceId !== 'default' && currentServiceId !== 'default_service') {
                query = query.eq('service_id', currentServiceId);
            }

            const { error } = await query;
            if (error) throw error;

            historyEvents.emit('notifications_read', { projectId: currentProjectId, serviceId: currentServiceId, ids: notificationIds });
            return true;
        } catch (err: any) {
            console.error('[NotificationsService] Error en markNotificationsAsRead:', err.message);
            return false;
        }
    }

    /**
     * Obtiene la cantidad de notificaciones no leídas filtrando por project_id y service_id.
     */
    static async getUnreadNotificationsCount(
        projectId: string,
        serviceId: string | null
    ): Promise<number> {
        const currentProjectId = projectId || HistoryHandler.PROJECT_IDENTIFIER;
        const currentServiceId = serviceId || HistoryHandler.SERVICE_IDENTIFIER;

        if (process.env.STORAGE_MODE === "local") {
            return LocalHistoryStore.getUnreadNotificationsCount(currentProjectId, currentServiceId);
        }

        try {
            let query = supabase
                .from('system_notifications')
                .select('id', { count: 'exact', head: true })
                .eq('project_id', currentProjectId)
                .eq('read', false);

            if (currentServiceId && currentServiceId !== 'default' && currentServiceId !== 'default_service') {
                query = query.eq('service_id', currentServiceId);
            }

            const { count, error } = await query;
            if (error) throw error;
            return count || 0;
        } catch (err: any) {
            console.error('[NotificationsService] Error en getUnreadNotificationsCount:', err.message);
            return 0;
        }
    }

    /**
     * Activa las notificaciones para el proyecto.
     */
    static async activate(projectId: string): Promise<void> {
        await HistoryHandler.saveSetting('NOTIFICATIONS_ACTIVE', 'true', projectId);
    }

    /**
     * Desactiva las notificaciones y resetea los contadores no leídos del proyecto.
     */
    static async deactivate(projectId: string): Promise<void> {
        if (process.env.STORAGE_MODE === "local") {
            const chats = LocalHistoryStore.getChats(projectId);
            chats.forEach(c => c.unread_count = 0);
            LocalHistoryStore.saveChats(projectId, chats);
        } else {
            const { error: resetErr } = await supabase
                .from('chats')
                .update({ unread_count: 0 })
                .eq('project_id', projectId);
            if (resetErr) throw resetErr;
        }

        await HistoryHandler.saveSetting('NOTIFICATIONS_ACTIVE', 'false', projectId);
        historyEvents.emit('notifications_deactivated', { projectId });
    }

    /**
     * Obtiene el banner de alerta/novedades del sistema activo (específico del proyecto o global).
     */
    static async getSystemBanner(projectId: string | null = null): Promise<any | null> {
        try {
            // 1. Buscar si hay banner para este proyecto específico
            if (projectId && projectId !== 'global' && projectId !== 'default_project') {
                const projectSetting = await HistoryHandler.getSetting('SYSTEM_BANNER_ALERT', projectId);
                if (projectSetting) {
                    try {
                        const parsed = JSON.parse(projectSetting);
                        if (parsed && parsed.active) return parsed;
                    } catch (_) {}
                }
            }

            // 2. Buscar si hay banner global ('global')
            const globalSetting = await HistoryHandler.getSetting('SYSTEM_BANNER_ALERT', 'global');
            if (globalSetting) {
                try {
                    const parsed = JSON.parse(globalSetting);
                    if (parsed && parsed.active) return parsed;
                } catch (_) {}
            }

            return null;
        } catch (err: any) {
            console.error('[NotificationsService] Error en getSystemBanner:', err.message);
            return null;
        }
    }

    /**
     * Guarda o actualiza el banner del sistema y emite el evento de cambio.
     */
    static async setSystemBanner(bannerData: any, projectId: string = 'global'): Promise<boolean> {
        try {
            const val = typeof bannerData === 'string' ? bannerData : JSON.stringify(bannerData);
            await HistoryHandler.saveSetting('SYSTEM_BANNER_ALERT', val, projectId);
            historyEvents.emit('setting_changed', {
                key: 'SYSTEM_BANNER_ALERT',
                value: bannerData,
                projectId
            });
            return true;
        } catch (err: any) {
            console.error('[NotificationsService] Error en setSystemBanner:', err.message);
            return false;
        }
    }
}
