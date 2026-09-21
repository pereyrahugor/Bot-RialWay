import { supabase, HistoryHandler } from '../db/historyHandler';

export const isScopedServiceId = (serviceId?: string | null): boolean => {
    return !!serviceId && serviceId !== 'default' && serviceId !== 'default_service';
};

export interface BlacklistEntry {
    chat_id: string;
    sin_bot?: boolean;
    bloqueado_crm?: boolean;
    notes?: string;
    updated_at?: string;
    name?: string;
}

export class BlacklistService {
    /**
     * Verifica si un contacto está en lista negra (sin_bot o bloqueado_crm)
     */
    static async isContactBlacklisted(rawChatId: string, projectId?: string | null, serviceId?: string | null): Promise<boolean> {
        if (!supabase) return false;
        try {
            const currentProjectId = projectId || HistoryHandler.PROJECT_IDENTIFIER;
            const currentServiceId = serviceId || HistoryHandler.SERVICE_IDENTIFIER;

            const possibleIds = HistoryHandler.getPossibleJids(rawChatId);

            let query = supabase
                .from('blacklist')
                .select('sin_bot, bloqueado_crm')
                .in('chat_id', possibleIds)
                .eq('project_id', currentProjectId)
                .or('sin_bot.eq.true,bloqueado_crm.eq.true');

            if (isScopedServiceId(currentServiceId)) {
                query = query.or(`service_id.eq.${currentServiceId},service_id.is.null,service_id.eq.default,service_id.eq.default_service`);
            }

            const { data, error } = await query.limit(1);
            if (error) {
                console.warn('[BlacklistService] Error consultando isContactBlacklisted:', error.message);
                return false;
            }

            return !!(data && data.length > 0);
        } catch (err: any) {
            console.warn('[BlacklistService] Excepción en isContactBlacklisted:', err?.message || err);
            return false;
        }
    }

    /**
     * Consulta si la lista negra está activa para un proyecto/servicio
     */
    static async getStatus(projectId: string, serviceId?: string | null): Promise<boolean> {
        const active = await HistoryHandler.getSetting('BLACKLIST_ACTIVE', projectId, serviceId);
        return active === 'true';
    }

    /**
     * Activa la lista negra para el proyecto/servicio
     */
    static async activate(projectId: string, serviceId?: string | null): Promise<void> {
        const scopedService = isScopedServiceId(serviceId) ? serviceId : null;
        await HistoryHandler.saveSetting('BLACKLIST_ACTIVE', 'true', projectId, scopedService);
    }

    /**
     * Desactiva la lista negra y elimina todos los registros del proyecto/servicio
     */
    static async deactivate(projectId: string, serviceId?: string | null): Promise<void> {
        let blQuery = supabase
            .from('blacklist')
            .delete()
            .eq('project_id', projectId);

        if (isScopedServiceId(serviceId)) {
            blQuery = blQuery.eq('service_id', serviceId);
        }

        const { error: delErr } = await blQuery;
        if (delErr) throw delErr;

        const scopedService = isScopedServiceId(serviceId) ? serviceId : null;
        await HistoryHandler.saveSetting('BLACKLIST_ACTIVE', 'false', projectId, scopedService);
    }

    /**
     * Lista todas las entradas del proyecto/servicio enriquecidas con el nombre del contacto
     */
    static async listEntries(projectId: string, serviceId?: string | null): Promise<BlacklistEntry[]> {
        let blQuery = supabase
            .from('blacklist')
            .select('chat_id, sin_bot, bloqueado_crm, notes, updated_at')
            .eq('project_id', projectId);

        if (isScopedServiceId(serviceId)) {
            blQuery = blQuery.eq('service_id', serviceId);
        }

        const { data, error } = await blQuery.order('updated_at', { ascending: false });
        if (error) throw error;

        // Enriquecer con nombre del contacto desde chats
        const chatIds = (data || []).map((r: any) => r.chat_id);
        const chatNames: Record<string, string> = {};
        if (chatIds.length > 0) {
            const extendedChatIds = new Set<string>();
            chatIds.forEach((id: string) => {
                const norm = HistoryHandler.normalizeId(id);
                extendedChatIds.add(id);
                extendedChatIds.add(norm);
                if (norm.startsWith('54')) {
                    if (norm.startsWith('549')) {
                        extendedChatIds.add('54' + norm.slice(3));
                    } else {
                        extendedChatIds.add('549' + norm.slice(2));
                    }
                }
            });

            let chatQuery = supabase
                .from('chats')
                .select('id, name')
                .in('id', Array.from(extendedChatIds))
                .eq('project_id', projectId);

            if (isScopedServiceId(serviceId)) {
                chatQuery = chatQuery.eq('service_id', serviceId);
            }

            const { data: chatRows } = await chatQuery;
            (chatRows || []).forEach((c: any) => {
                const normCId = HistoryHandler.normalizeId(c.id);
                chatNames[c.id] = c.name || c.id;
                chatNames[normCId] = c.name || c.id;
                if (normCId.startsWith('54')) {
                    if (normCId.startsWith('549')) {
                        chatNames['54' + normCId.slice(3)] = c.name || c.id;
                    } else {
                        chatNames['549' + normCId.slice(2)] = c.name || c.id;
                    }
                }
            });
        }

        return (data || []).map((r: any) => {
            const normRId = HistoryHandler.normalizeId(r.chat_id);
            return {
                ...r,
                name: chatNames[r.chat_id] || chatNames[normRId] || r.chat_id
            };
        });
    }

    /**
     * Upsert de una entrada en la lista negra
     */
    static async upsertEntry(
        entry: { chat_id: string; sin_bot?: boolean; bloqueado_crm?: boolean; notes?: string },
        projectId: string,
        serviceId?: string | null
    ): Promise<void> {
        const { chat_id, sin_bot, bloqueado_crm, notes } = entry;
        const upsertData: any = {
            chat_id,
            project_id: projectId,
            sin_bot: !!sin_bot,
            bloqueado_crm: !!bloqueado_crm,
            notes: notes || '',
            updated_at: new Date().toISOString()
        };
        if (isScopedServiceId(serviceId)) {
            upsertData.service_id = serviceId;
        }

        const { error } = await supabase
            .from('blacklist')
            .upsert(upsertData, { onConflict: 'chat_id,project_id' });
        if (error) throw error;

        if (sin_bot || bloqueado_crm) {
            await HistoryHandler.toggleBot(chat_id, false, projectId, serviceId);
        }
    }

    /**
     * Elimina una entrada de la lista negra por chatId
     */
    static async deleteEntry(chatId: string, projectId: string, serviceId?: string | null): Promise<void> {
        const possibleIds = HistoryHandler.getPossibleJids(chatId);

        let query = supabase
            .from('blacklist')
            .delete()
            .in('chat_id', possibleIds)
            .eq('project_id', projectId);

        if (isScopedServiceId(serviceId)) {
            query = query.eq('service_id', serviceId);
        }

        const { error } = await query;
        if (error) throw error;
    }

    /**
     * Toggle rápido de lista negra
     */
    static async toggleEntry(chatId: string, inBlacklist: boolean, projectId: string, serviceId?: string | null): Promise<void> {
        if (inBlacklist) {
            const upsertData: any = {
                chat_id: chatId,
                project_id: projectId,
                sin_bot: true,
                bloqueado_crm: false,
                notes: '',
                updated_at: new Date().toISOString()
            };
            if (isScopedServiceId(serviceId)) {
                upsertData.service_id = serviceId;
            }

            const { error } = await supabase
                .from('blacklist')
                .upsert(upsertData, { onConflict: 'chat_id,project_id' });
            if (error) throw error;

            await HistoryHandler.toggleBot(chatId, false, projectId, serviceId);
        } else {
            await this.deleteEntry(chatId, projectId, serviceId);
        }
    }
}
