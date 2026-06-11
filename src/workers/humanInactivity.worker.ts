import { HistoryHandler, supabase } from "../db/historyHandler";

/**
 * Inicia un worker que verifica cada minuto los chats con intervención humana (bot desactivado).
 * Si no han recibido un mensaje humano en 15 minutos, reactiva el bot automáticamente.
 * Excluye contactos en lista negra (sin_bot o bloqueado_crm) que deben permanecer en atención humana.
 */
export const startHumanInactivityWorker = (timeoutMinutes = 15) => {
    console.log(`🤖 [Worker] Iniciando worker de inactividad humana (${timeoutMinutes} min)...`);

    setInterval(async () => {
        try {
            const now = new Date();
            const threshold = new Date(now.getTime() - timeoutMinutes * 60 * 1000);
            
            // Verificar si la lista negra está activa
            const blacklistActive = await HistoryHandler.getSetting('BLACKLIST_ACTIVE');

            // Obtener IDs de chats en lista negra (si está activa)
            let blacklistedIds: string[] = [];
            if (blacklistActive === 'true' && supabase) {
                const { data: blEntries } = await supabase
                    .from('blacklist')
                    .select('chat_id')
                    .eq('project_id', HistoryHandler.PROJECT_IDENTIFIER)
                    .or('sin_bot.eq.true,bloqueado_crm.eq.true');
                blacklistedIds = (blEntries || []).map((r: any) => r.chat_id);
            }
            
            const { data: inactiveChats, error } = await supabase
                .from('chats')
                .select('id, last_human_message_at')
                .eq('project_id', HistoryHandler.PROJECT_IDENTIFIER)
                .eq('bot_enabled', false)
                .or(`last_human_message_at.lte.${threshold.toISOString()},last_human_message_at.is.null`);

            if (error) throw error;

            for (const chat of (inactiveChats || [])) {
                // Excluir chats en lista negra
                if (blacklistedIds.includes(chat.id)) {
                    console.log(`[WORKER] ⛔ Skipping blacklisted chat ${chat.id} (sin auto-reset)`);
                    continue;
                }
                console.log(`[WORKER] [${new Date().toLocaleTimeString()}] Auto-activando bot para ${chat.id} (Inactividad > ${timeoutMinutes} min)`);
                await HistoryHandler.toggleBot(chat.id, true);
            }
        } catch (e) {
            console.error('[WORKER] Error checking human inactivity:', e);
        }
    }, 15 * 60 * 1000);
};
