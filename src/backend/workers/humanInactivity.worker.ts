import { HistoryHandler, supabase } from "../db/historyHandler";

/**
 * Inicia un worker que verifica cada minuto los chats con intervención humana (bot desactivado).
 * Si no han recibido un mensaje humano en 15 minutos, reactiva el bot automáticamente.
 * Excluye contactos en lista negra (sin_bot o bloqueado_crm) que deben permanecer en atención humana.
 */
export const startHumanInactivityWorker = (timeoutMinutes = 15) => {
    console.log(`🤖 [Worker] Iniciando worker de inactividad humana multitenant (${timeoutMinutes} min)...`);

    setInterval(async () => {
        try {
            if (!supabase) return;
            const now = new Date();
            const threshold = new Date(now.getTime() - timeoutMinutes * 60 * 1000);
            
            // 1. Obtener todos los chats con bot desactivado en cualquier proyecto
            const { data: inactiveChats, error } = await supabase
                .from('chats')
                .select('id, project_id, last_human_message_at')
                .eq('bot_enabled', false)
                .or(`last_human_message_at.lte.${threshold.toISOString()},last_human_message_at.is.null`);

            if (error) throw error;

            for (const chat of (inactiveChats || [])) {
                const projectId = chat.project_id;

                // 2. Si el bot está desactivado globalmente para este proyecto, no auto-activar
                const isGlobalBotEnabledSetting = await HistoryHandler.getSetting('GLOBAL_BOT_ENABLED', projectId);
                if (isGlobalBotEnabledSetting === 'false') {
                    continue;
                }

                // 3. Excluir chats en lista negra (marcados como sin_bot o bloqueado_crm)
                const { data: blEntry, error: blError } = await supabase
                    .from('blacklist')
                    .select('id')
                    .eq('chat_id', chat.id)
                    .eq('project_id', projectId)
                    .or('sin_bot.eq.true,bloqueado_crm.eq.true')
                    .maybeSingle();

                if (blError) {
                    console.error(`[WORKER] Error consultando blacklist para chat ${chat.id}:`, blError);
                    continue;
                }

                if (blEntry) {
                    // Chat en lista negra, debe permanecer en intervención humana
                    console.log(`[WORKER] ⛔ Manteniendo en atención humana a ${chat.id} (marcado en lista negra)`);
                    continue;
                }

                console.log(`[WORKER] [${new Date().toLocaleTimeString()}] Auto-activando bot para chat ${chat.id} en proyecto ${projectId} (Inactividad > ${timeoutMinutes} min)`);
                await HistoryHandler.toggleBot(chat.id, true, projectId);
            }
        } catch (e) {
            console.error('[WORKER] Error en check de inactividad humana:', e);
        }
    }, 60 * 1000); // Verificar cada minuto para alta precisión
};
