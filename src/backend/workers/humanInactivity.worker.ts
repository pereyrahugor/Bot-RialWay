import { HistoryHandler, supabase } from "../db/historyHandler";

/**
 * Inicia un worker que verifica cada 12 horas los chats con intervención humana (bot desactivado).
 * Si no han recibido un mensaje humano en 12 horas (o 24 horas si fue manual de la app), reactiva el bot automáticamente.
 * Excluye contactos en lista negra (sin_bot o bloqueado_crm) que deben permanecer en atención humana.
 */
export const startHumanInactivityWorker = (timeoutHours = 12, intervalHours = 12) => {
    console.log(`🤖 [Worker] Iniciando worker de inactividad humana multitenant (Revisión cada ${intervalHours}h | Inactividad > ${timeoutHours}h)...`);

    const checkInactivity = async () => {
        try {
            if (!supabase) return;
            const now = new Date();
            const threshold = new Date(now.getTime() - timeoutHours * 60 * 60 * 1000);
            const minThreshold = new Date(now.getTime() - 48 * 60 * 60 * 1000); // Ventana extendida a 48 horas para contemplar desactivaciones de 24 horas
            
            // 1. Obtener chats con bot desactivado y actividad humana reciente (filtrando por la instancia actual si no es master)
            let query = supabase
                .from('chats')
                .select('id, project_id, service_id, last_human_message_at, metadata')
                .eq('bot_enabled', false)
                .not('last_human_message_at', 'is', null)
                .gte('last_human_message_at', minThreshold.toISOString())
                .lte('last_human_message_at', threshold.toISOString());

            const currentProjectId = HistoryHandler.PROJECT_IDENTIFIER;
            const currentServiceId = HistoryHandler.SERVICE_IDENTIFIER;

            if (currentProjectId && !['default_project', 'default', 'test-hugo-local', 'local-dev'].includes(currentProjectId)) {
                query = query.eq('project_id', currentProjectId);
                if (currentServiceId && !['default_service', 'generic', 'null'].includes(currentServiceId)) {
                    query = query.eq('service_id', currentServiceId);
                }
            }

            const { data: inactiveChats, error } = await query;

            if (error) throw error;
            if (!inactiveChats || inactiveChats.length === 0) return;

            // 2. Obtener lista negra en lotes pequeños (chunks) filtrando por proyecto/servicio
            const allQueryIds = Array.from(new Set(
                inactiveChats.flatMap(c => HistoryHandler.getPossibleJids(c.id))
            ));
            const blacklistEntries: any[] = [];
            const CHUNK_SIZE = 50;

            for (let i = 0; i < allQueryIds.length; i += CHUNK_SIZE) {
                const chunk = allQueryIds.slice(i, i + CHUNK_SIZE);
                let blQuery = supabase
                    .from('blacklist')
                    .select('chat_id, project_id, service_id')
                    .in('chat_id', chunk)
                    .or('sin_bot.eq.true,bloqueado_crm.eq.true');

                if (currentProjectId && !['default_project', 'default', 'test-hugo-local', 'local-dev'].includes(currentProjectId)) {
                    blQuery = blQuery.eq('project_id', currentProjectId);
                    if (currentServiceId && !['default_service', 'generic', 'null'].includes(currentServiceId)) {
                        blQuery = blQuery.eq('service_id', currentServiceId);
                    }
                }

                const { data: chunkEntries, error: blError } = await blQuery;

                if (blError) {
                    console.error('[WORKER] Error consultando blacklist en lote (chunk):', blError);
                } else if (chunkEntries) {
                    blacklistEntries.push(...chunkEntries);
                }
            }

            const blockedKeys = new Set<string>();
            blacklistEntries.forEach(entry => {
                const normEntryId = HistoryHandler.normalizeId(entry.chat_id);
                const sId = entry.service_id || 'default';

                const variants = [entry.chat_id, normEntryId];
                if (normEntryId.startsWith('54')) {
                    if (normEntryId.startsWith('549')) {
                        variants.push('54' + normEntryId.slice(3));
                    } else {
                        variants.push('549' + normEntryId.slice(2));
                    }
                }

                variants.forEach(v => {
                    // Bloqueo a nivel de proyecto (cualquier service_id)
                    blockedKeys.add(`${entry.project_id}:${v}`);
                    // Bloqueo a nivel de proyecto + service_id
                    blockedKeys.add(`${entry.project_id}:${sId}:${v}`);
                });
            });

            // Caché en memoria durante este tick para no consultar la misma configuración del mismo proyecto/servicio varias veces
            const globalBotSettingsCache = new Map<string, boolean>();

            for (const chat of inactiveChats) {
                const projectId = chat.project_id;
                const serviceId = chat.service_id || 'default';
                const settingKey = `${projectId}:${serviceId}`;

                // 3. Obtener estado del bot global usando caché en memoria
                let isGlobalBotEnabled = globalBotSettingsCache.get(settingKey);
                if (isGlobalBotEnabled === undefined) {
                    const settingValue = await HistoryHandler.getSetting('GLOBAL_BOT_ENABLED', projectId, chat.service_id);
                    isGlobalBotEnabled = settingValue !== 'false';
                    globalBotSettingsCache.set(settingKey, isGlobalBotEnabled);
                }

                if (!isGlobalBotEnabled) {
                    continue; // Saltar si el bot está desactivado globalmente para este inquilino/servicio
                }

                // 4. Filtrar lista negra usando el Set en memoria
                const normChatId = HistoryHandler.normalizeId(chat.id);
                const isBlocked = blockedKeys.has(`${projectId}:${normChatId}`) ||
                    blockedKeys.has(`${projectId}:${chat.id}`) ||
                    blockedKeys.has(`${projectId}:${serviceId}:${normChatId}`) ||
                    blockedKeys.has(`${projectId}:${serviceId}:${chat.id}`);

                if (isBlocked) {
                    continue; // Saltar si está en lista negra
                }

                // 5. Si fue una intervención manual desde la app móvil, el bot debe permanecer desactivado por 24 horas.
                if ((chat.metadata as any)?.manual_app_interacted) {
                    const manualThreshold = new Date(now.getTime() - 24 * 60 * 60 * 1000); // 24 horas de inactividad requeridas
                    const lastHuman = new Date(chat.last_human_message_at);
                    if (lastHuman > manualThreshold) {
                        continue; // No reactivar aún porque no ha pasado la ventana de 24 horas
                    }
                }

                console.log(`[WORKER] [${new Date().toLocaleTimeString()}] Auto-activando bot para chat ${chat.id} en proyecto ${projectId} (Inactividad > ${timeoutHours}h)`);
                await HistoryHandler.toggleBot(chat.id, true, projectId, chat.service_id);
            }
        } catch (e) {
            console.error('[WORKER] Error en check de inactividad humana:', e);
        }
    };

    // Ejecución inicial y luego periódica cada 12 horas
    setTimeout(checkInactivity, 60 * 1000); // 1 minuto después del arranque para no saturar el inicio
    setInterval(checkInactivity, intervalHours * 60 * 60 * 1000);
};
