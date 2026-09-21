import { supabase, HistoryHandler } from '../db/historyHandler';
import { LocalHistoryStore } from '../db/localHistoryStore';

export class TagsService {
    /**
     * Obtiene todas las etiquetas de un proyecto/servicio
     */
    static async getTags(projectId: string | null = null, serviceId: string | null = null) {
        const currentProjectId = projectId || HistoryHandler.PROJECT_IDENTIFIER;
        const currentServiceId = serviceId || HistoryHandler.SERVICE_IDENTIFIER;

        if (process.env.STORAGE_MODE === "local") {
            return LocalHistoryStore.getTags(currentProjectId);
        }
        if (!supabase) return [];

        try {
            let query = supabase
                .from('tags')
                .select('*')
                .eq('project_id', currentProjectId);

            if (currentServiceId && currentServiceId !== 'default' && currentServiceId !== 'default_service') {
                query = query.eq('service_id', currentServiceId);
            }

            const { data, error } = await query.order('name');
            if (error) throw error;
            return data || [];
        } catch (err) {
            console.error('[TagsService] Error en getTags:', err);
            return [];
        }
    }

    /**
     * Crea una nueva etiqueta
     */
    static async createTag(name: string, color: string = '#6366f1', projectId: string | null = null, serviceId: string | null = null) {
        const currentProjectId = projectId || HistoryHandler.PROJECT_IDENTIFIER;
        const currentServiceId = serviceId || HistoryHandler.SERVICE_IDENTIFIER;

        if (process.env.STORAGE_MODE === "local") {
            const tag = await LocalHistoryStore.createTag(name, color, currentProjectId);
            return { success: true, tag };
        }
        if (!supabase) return { success: false, error: 'Supabase not initialized' };

        try {
            const insertData: any = {
                name,
                color,
                project_id: currentProjectId,
                created_at: new Date().toISOString()
            };
            if (currentServiceId && currentServiceId !== 'default' && currentServiceId !== 'default_service') {
                insertData.service_id = currentServiceId;
            }

            const { data, error } = await supabase
                .from('tags')
                .insert(insertData)
                .select()
                .single();
            if (error) throw error;
            return { success: true, tag: data };
        } catch (err: any) {
            console.error('[TagsService] Error en createTag:', err);
            return { success: false, error: err.message };
        }
    }

    /**
     * Actualiza una etiqueta existente
     */
    static async updateTag(id: string, name: string, color: string, projectId: string | null = null, serviceId: string | null = null) {
        const currentProjectId = projectId || HistoryHandler.PROJECT_IDENTIFIER;
        const currentServiceId = serviceId || HistoryHandler.SERVICE_IDENTIFIER;

        if (process.env.STORAGE_MODE === "local") {
            const res = await LocalHistoryStore.updateTag(id, name, color, currentProjectId);
            return { success: res };
        }
        try {
            let query = supabase
                .from('tags')
                .update({ name, color })
                .eq('id', id)
                .eq('project_id', currentProjectId);

            if (currentServiceId && currentServiceId !== 'default' && currentServiceId !== 'default_service') {
                query = query.eq('service_id', currentServiceId);
            }

            const { error } = await query;
            if (error) throw error;
            return { success: true };
        } catch (err: any) {
            return { success: false, error: err.message };
        }
    }

    /**
     * Elimina una etiqueta
     */
    static async deleteTag(id: string, projectId: string | null = null, serviceId: string | null = null) {
        const currentProjectId = projectId || HistoryHandler.PROJECT_IDENTIFIER;
        const currentServiceId = serviceId || HistoryHandler.SERVICE_IDENTIFIER;

        if (process.env.STORAGE_MODE === "local") {
            const res = await LocalHistoryStore.deleteTag(id, currentProjectId);
            return { success: res };
        }
        try {
            let query = supabase
                .from('tags')
                .delete()
                .eq('id', id)
                .eq('project_id', currentProjectId);

            if (currentServiceId && currentServiceId !== 'default' && currentServiceId !== 'default_service') {
                query = query.eq('service_id', currentServiceId);
            }

            const { error } = await query;
            if (error) throw error;
            return { success: true };
        } catch (err: any) {
            return { success: false, error: err.message };
        }
    }

    /**
     * Asocia una etiqueta a un chat
     */
    static async addTagToChat(rawChatId: string, tagId: string, projectId: string | null = null, serviceId: string | null = null) {
        const chatId = HistoryHandler.normalizeId(rawChatId);
        const currentProjectId = projectId || HistoryHandler.PROJECT_IDENTIFIER;
        const currentServiceId = serviceId || HistoryHandler.SERVICE_IDENTIFIER;

        if (process.env.STORAGE_MODE === "local") {
            const res = await LocalHistoryStore.addTagToChat(chatId, tagId, currentProjectId);
            return { success: res };
        }
        try {
            HistoryHandler.invalidateChatCache(chatId, currentProjectId);

            await HistoryHandler.getOrCreateChat(chatId, 'whatsapp', null, null, currentProjectId, currentServiceId);

            const insertData: any = {
                chat_id: chatId,
                tag_id: tagId,
                project_id: currentProjectId
            };
            if (currentServiceId && currentServiceId !== 'default' && currentServiceId !== 'default_service') {
                insertData.service_id = currentServiceId;
            }

            const { error } = await supabase
                .from('chat_tags')
                .insert(insertData);

            if (error) {
                if (error.code === '23505') return { success: true }; // Ya existe
                throw error;
            }
            return { success: true };
        } catch (err: any) {
            console.error('[TagsService] Error en addTagToChat:', err);
            return { success: false, error: err.message };
        }
    }

    /**
     * Remueve una etiqueta de un chat
     */
    static async removeTagFromChat(rawChatId: string, tagId: string, projectId: string | null = null, serviceId: string | null = null) {
        const chatId = HistoryHandler.normalizeId(rawChatId);
        const currentProjectId = projectId || HistoryHandler.PROJECT_IDENTIFIER;
        const currentServiceId = serviceId || HistoryHandler.SERVICE_IDENTIFIER;

        if (process.env.STORAGE_MODE === "local") {
            const res = await LocalHistoryStore.removeTagFromChat(chatId, tagId, currentProjectId);
            return { success: res };
        }
        try {
            HistoryHandler.invalidateChatCache(chatId, currentProjectId);

            let query = supabase
                .from('chat_tags')
                .delete()
                .eq('chat_id', chatId)
                .eq('tag_id', tagId)
                .eq('project_id', currentProjectId);

            if (currentServiceId && currentServiceId !== 'default' && currentServiceId !== 'default_service') {
                query = query.eq('service_id', currentServiceId);
            }

            const { error } = await query;
            if (error) throw error;
            return { success: true };
        } catch (err: any) {
            console.error('[TagsService] Error en removeTagFromChat:', err);
            return { success: false, error: err.message };
        }
    }

    /**
     * Obtiene etiquetas de un chat específico
     */
    static async getChatTags(rawChatId: string) {
        try {
            const chat = await HistoryHandler.getChat(rawChatId);
            return chat && chat.tags ? chat.tags : [];
        } catch (err) {
            console.error('[TagsService] Error en getChatTags:', err);
            return [];
        }
    }
}
