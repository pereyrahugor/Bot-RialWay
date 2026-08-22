import { HistoryHandler, supabase } from "../db/historyHandler";

/**
 * Inicia un worker que verifica cada minuto los chats con intervención humana (bot desactivado).
 * Si no han recibido un mensaje humano en 30 minutos (o 24 horas si fue manual de la app), reactiva el bot automáticamente.
 * Excluye contactos en lista negra (sin_bot o bloqueado_crm) que deben permanecer en atención humana.
 */
export const startHumanInactivityWorker = (timeoutMinutes = 30) => {
    console.log(`🤖 [Worker] Iniciando worker de inactividad humana multitenant (${timeoutMinutes} min)...`);

    setInterval(async () => {
        try {
            if (!supabase) return;
            const now = new Date();
            const threshold = new Date(now.getTime() - timeoutMinutes * 60 * 1000);
            const minThreshold = new Date(now.getTime() - 48 * 60 * 60 * 1000); // Ventana extendida a 48 horas para contemplar desactivaciones de 24 horas
            
            // 1. Obtener chats con bot desactivado y actividad humana reciente (entre 48 horas y 15 minutos atrás)
            const { data: inactiveChats, error } = await supabase
                .from('chats')
                .select('id, project_id, service_id, last_human_message_at, metadata')
                .eq('bot_enabled', false)
                .not('last_human_message_at', 'is', null)
                .gte('last_human_message_at', minThreshold.toISOString())
                .lte('last_human_message_at', threshold.toISOString());

            if (error) throw error;
            if (!inactiveChats || inactiveChats.length === 0) return;

            // 2. Obtener lista negra en lotes pequeños (chunks) para evitar desbordar el límite de URL/Headers (16KB) en Supabase/PostgREST
            const allQueryIds = Array.from(new Set(
                inactiveChats.flatMap(c => HistoryHandler.getPossibleJids(c.id))
            ));
            const blacklistEntries: any[] = [];
            const CHUNK_SIZE = 50;

            for (let i = 0; i < allQueryIds.length; i += CHUNK_SIZE) {
                const chunk = allQueryIds.slice(i, i + CHUNK_SIZE);
                const { data: chunkEntries, error: blError } = await supabase
                    .from('blacklist')
                    .select('chat_id, project_id, service_id')
                    .in('chat_id', chunk)
                    .or('sin_bot.eq.true,bloqueado_crm.eq.true');

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

                console.log(`[WORKER] [${new Date().toLocaleTimeString()}] Auto-activando bot para chat ${chat.id} en proyecto ${projectId} (Inactividad > ${timeoutMinutes} min)`);
                await HistoryHandler.toggleBot(chat.id, true, projectId, chat.service_id);
            }
        } catch (e) {
            console.error('[WORKER] Error en check de inactividad humana:', e);
        }
    }, 60 * 1000); // Verificar cada minuto para alta precisión
};
