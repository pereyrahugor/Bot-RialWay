import { typing } from "./presence";
import { HistoryHandler } from "../db/historyHandler";
import { EVENTS } from "@builderbot/bot";
import { getArgentinaDatetimeString } from "../utils/ArgentinaTime";
import { safeToAsk } from "../apis/openai/openaiHelper";
import { AssistantResponseProcessor } from "../apis/openai/AssistantResponseProcessor";
import { stop, reset } from "./timeOut";
import { updateMain } from "../apis/google/updateMain";

export class AiManager {
    private userTimeouts = new Map<string, NodeJS.Timeout>();
    private readonly DEFAULT_TIMEOUT_MS = 60000;

    constructor(
        private openaiMain: any, // Objeto OpenAI (ahora dinámico vía openaiHelper)
        private assistantId: string, // Mantenemos por compatibilidad
        private errorReporter: any,
        private flows: any
    ) {}

    /**
     * Resuelve el ASSISTANT_MAP de forma dinámica para Hot-update.
     */
    public async getAssistantMap(projectId: string | null = null): Promise<Record<string, string | undefined>> {
        const assistant1 = await HistoryHandler.getConfig('ASSISTANT_1', projectId) || await HistoryHandler.getConfig('ASSISTANT_ID', projectId);
        const map = {
            asistente1: assistant1 || this.assistantId,
            asistente2: await HistoryHandler.getConfig('ASSISTANT_2', projectId) || undefined,
            asistente3: await HistoryHandler.getConfig('ASSISTANT_3', projectId) || undefined,
            asistente4: await HistoryHandler.getConfig('ASSISTANT_4', projectId) || undefined,
            asistente5: await HistoryHandler.getConfig('ASSISTANT_5', projectId) || undefined,
        };

        // Log de diagnóstico silencioso para debug interno si se necesita
        // console.log(`[AiManager] Assistant Map [${projectId || 'global'}]:`, Object.keys(map).filter(k => map[k]).join(', '));
        
        return map;
    }

    /**
     * Retorna el Assistant ID asignado al usuario
     */
    public async getAssignedAssistantId(userId: string, forcedProjectId?: string): Promise<string> {
        const assigned = await HistoryHandler.getAssignedAgent(userId, forcedProjectId) || 'asistente1';
        const map = await this.getAssistantMap(forcedProjectId || null);
        
        const assistantId = map[assigned];
        if (!assistantId) {
            console.warn(`⚠️ [AiManager] No se encontró Assistant ID para '${assigned}'. Reconvirtiendo a asistente1.`);
            return map['asistente1'] || this.assistantId;
        }
        return assistantId;
    }

    public getAssistantResponse = async (assistantId: string, message: string, state: any, fallbackMessage: string | undefined, userId: string, thread_id: string | null = null, projectId: string | null = null, agentName?: string) => {
        if (this.userTimeouts.has(userId)) {
            clearTimeout(this.userTimeouts.get(userId)!);
            this.userTimeouts.delete(userId);
        }

        return new Promise((resolve, reject) => {
            const timeoutId = setTimeout(() => {
                console.warn("⏱ Timeout de 60s alcanzado en la comunicación con OpenAI.");
            }, this.DEFAULT_TIMEOUT_MS);
            this.userTimeouts.set(userId, timeoutId);

            const isWhatsApp = !!(userId && userId.includes('@s.whatsapp.net'));
            const targetProjectId = projectId || HistoryHandler.PROJECT_IDENTIFIER;

            safeToAsk(assistantId, message, state, userId, this.errorReporter, 5, isWhatsApp, targetProjectId, false, agentName)
                .then(result => {
                    if (this.userTimeouts.has(userId)) {
                        clearTimeout(this.userTimeouts.get(userId)!);
                        this.userTimeouts.delete(userId);
                    }
                    resolve(result);
                })
                .catch(error => {
                    if (this.userTimeouts.has(userId)) {
                        clearTimeout(this.userTimeouts.get(userId)!);
                        this.userTimeouts.delete(userId);
                    }
                    if (error?.message === 'TIMEOUT_SAFE_TO_ASK') {
                        console.error(`[AiManager] Finalizando por timeout de seguridad para ${userId}`);
                        resolve(fallbackMessage || "Lo siento, estoy tardando un poco más de lo habitual. Por favor, reintenta en un momento.");
                    } else {
                        reject(error);
                    }
                });
        });
    };

    public analizarDestinoRecepcionista(respuesta: string): string | null {
        if (!respuesta || typeof respuesta !== 'string') return null;
        const lower = respuesta.toLowerCase();
        
        // Regex robusto: (derivar|derivando|derivo) [a|al|el|a la] asistente [1-5]
        // Soporta puntos, comas o fin de línea tras el número.
        const matchAsistente = lower.match(/(?:derivar|derivando|derivo)(?:\s+(?:a|al|el|a\s+la))?\s+asistente\s*([1-5])(?:\.|\b|$)/i);
        if (matchAsistente) {
            const num = matchAsistente[1];
            console.log(`[AiManager] 🎯 Comando de derivación detectado: asistente${num}`);
            return `asistente${num}`;
        }

        if (/(?:derivar|derivando|derivo)(?:\s+(?:a|al|el|a\s+la))?\s+(?:asesor|agente|humano|atencion|soporte)\s+humano\b/i.test(lower)) {
            console.log(`[AiManager] 🎯 Comando de derivación detectado: asesor humano`);
            return 'asistente_humano';
        }

        return null;
    }

    /**
     * Extrae el bloque de resumen para el siguiente asistente.
     */
    private extraerResumenRecepcionista(respuesta: string): string {
        const match = respuesta.match(/GET_RESUMEN[\s\S]+/i);
        return match ? match[0].trim() : "Continúa con la atención del cliente.";
    }

    public processUserMessage = async (ctx: any, { flowDynamic, state, provider, gotoFlow }: any) => {
        // Ruteo Multitenant Dinámico
        const botPhoneNumber = provider?.globalVendorArgs?.phone_number_id || (ctx.to ? ctx.to.replace(/\D/g, '') : null);
        const dynamicProjectId = await HistoryHandler.getProjectIdByRecipient(botPhoneNumber) || HistoryHandler.PROJECT_IDENTIFIER;
        
        // Determinar el agente asignado. 
        // Si no hay agente en el 'state' (redeploy/reset), forzamos asistente1
        let assigned = state.get('assignedAgent');
        if (!assigned) {
            console.log(`[AiManager] 🔄 Sesión fresca o redeploy detectado para ${ctx.from}. Forzando asistente1.`);
            assigned = 'asistente1';
            await HistoryHandler.setAssignedAgent(ctx.from, 'asistente1', dynamicProjectId);
            await state.update({ assignedAgent: 'asistente1' });
        } else {
            // Si ya hay en state, verificar que coincida con DB (opcional, pero seguro)
            const dbAssigned = await HistoryHandler.getAssignedAgent(ctx.from, dynamicProjectId);
            if (dbAssigned !== assigned) {
                assigned = dbAssigned;
                await state.update({ assignedAgent: dbAssigned });
            }
        }

        const assistantMap = await this.getAssistantMap(dynamicProjectId);
        const assignedAssistantId = assistantMap[assigned] || this.assistantId;

        // Guardar contexto en el state para uso en flujos (como idleFlow o reconectionFlow)
        if (state && state.update) {
            await state.update({ 
                dynamicProjectId,
                assignedAssistantId,
                botPhoneNumber
            });
        }

        console.log(`[AiManager] 📥 Procesando: ${ctx.from} | Proyecto: ${dynamicProjectId} | Agente: ${assigned}`);
        
        // --- COMANDO DE REINICIO ---
        if (ctx.body && ctx.body.trim().toUpperCase() === '#RESET#') {
            const chatId = ctx.from;
            console.log(`[AiManager] ♻️ Reiniciando historial y agente para ${chatId}`);
            await HistoryHandler.setAssignedAgent(chatId, 'asistente1', dynamicProjectId);
            await state.update({ assignedAgent: 'asistente1' });
            return await flowDynamic("✅ Historial de conversación y asignación de asistente reiniciados.");
        }
        
        await typing(ctx, provider);
        try {
            const body = ctx.body && ctx.body.trim();

            // COMANDOS DE CONTROL (WhatsApp Admin)
            if (body === "#ON#") {
                await HistoryHandler.toggleBot(ctx.from, true);
                if (ctx.pushName) await HistoryHandler.getOrCreateChat(ctx.from, 'whatsapp', ctx.pushName, ctx.userId);
                const msg = "🤖 Bot activado para este chat.";
                await flowDynamic([{ body: msg }]);
                await HistoryHandler.saveMessage(ctx.from, 'assistant', msg, 'text', null, ctx.userId, null, ctx.platform);
                return state;
            }

            if (body === "#OFF#") {
                await HistoryHandler.toggleBot(ctx.from, false);
                if (ctx.pushName) await HistoryHandler.getOrCreateChat(ctx.from, 'whatsapp', ctx.pushName, ctx.userId);
                const msg = "🛑 Bot desactivado. (Intervención humana activa)";
                await flowDynamic([{ body: msg }]);
                await HistoryHandler.saveMessage(ctx.from, 'assistant', msg, 'text', null, ctx.userId, null, ctx.platform);
                return state;
            }

            // Filtro de Eco (Mejorado para BSUID)
            if (ctx.key?.fromMe) {
                stop(ctx);
                return;
            }

            stop(ctx);

            // ELIMINADO: Duplicado con provider.manager.ts
            // await HistoryHandler.saveMessage( ... );

            // --- FILTRO DE BOT GLOBAL ---
            const isGlobalBotEnabledSetting = await HistoryHandler.getSetting('GLOBAL_BOT_ENABLED', dynamicProjectId);
            const isGlobalBotEnabled = isGlobalBotEnabledSetting !== 'false';
            const isBotActiveForUser = await HistoryHandler.isBotEnabled(ctx.from);

            if (!isGlobalBotEnabled || !isBotActiveForUser) {
                if (!isGlobalBotEnabled) {
                    console.log(`[AiManager] 🛑 Bot DESACTIVADO GLOBALMENTE para el proyecto ${dynamicProjectId}.`);
                }
                // No necesitamos sincronizar con Threads de OpenAI en Chat Completions
                return state;
            }

            // --- FILTRO DE LISTA NEGRA ---
            const blacklistActive = await HistoryHandler.getSetting('BLACKLIST_ACTIVE', dynamicProjectId);
            if (blacklistActive === 'true') {
                const { supabase: supa } = await import('../db/historyHandler');
                if (supa) {
                    const { data: blEntry } = await supa
                        .from('blacklist')
                        .select('sin_bot, bloqueado_crm')
                        .eq('chat_id', ctx.from)
                        .eq('project_id', dynamicProjectId)
                        .maybeSingle();
                    if (blEntry && (blEntry.sin_bot || blEntry.bloqueado_crm)) {
                        console.log(`[AiManager] ⛔ Contacto ${ctx.from} en lista negra (sin_bot=${blEntry.sin_bot}, bloqueado_crm=${blEntry.bloqueado_crm}). Activando intervención humana permanente.`);
                        // Asegurar que el chat esté en modo intervención humana (bot_enabled=false)
                        // El worker de inactividad lo excluye, por lo que permanecerá así indefinidamente.
                        const currentBotState = await HistoryHandler.isBotEnabled(ctx.from);
                        if (currentBotState) {
                            await HistoryHandler.toggleBot(ctx.from, false);
                        }
                        return state;
                    }
                }
            }


            // Comandos Globales y Sheet Update
            if (body === "#ACTUALIZAR#") {
                try {
                    console.log('📡 [SYNC] Sincronizando datos de Google y Prompt de OpenAI...');
                    await updateMain();
                    
                    // Sincronización del Prompt del asistente (Desde DB/Local)
                    console.log('✅ [SYNC] Datos actualizados. El prompt se cargará desde la base de datos en la próxima consulta.');

                    await flowDynamic([{ body: "🔄 Datos actualizados desde Google y Assistant Prompt sincronizado (Hot-update)." }]);
                } catch (err: any) {
                    console.error("[AiManager] Error en #ACTUALIZAR#:", err.message);
                    await flowDynamic([{ body: "❌ Error al actualizar datos operativos." }]);
                }
                return state;
            }

            // Filtro de Broadcast/Channel
            if (ctx.from) {
                if (/@broadcast$/.test(ctx.from) || /@newsletter$/.test(ctx.from) || /@channel$/.test(ctx.from)) return;
            }

            // --- LÓGICA MULTI-AGENTE ---
            const currentAssistantMap = await this.getAssistantMap(dynamicProjectId);
            const currentAssistantId = currentAssistantMap[assigned] || this.assistantId;

            const response = (await this.getAssistantResponse(assignedAssistantId, ctx.body, state, undefined, ctx.from, ctx.thread_id, dynamicProjectId, assigned)) as string;

            if (!response) return state;

            // No necesitamos guardar threadId en Chat Completions

                // --- PROCESAR DERIVACIÓN Y TRANSICIÓN (HANDOVER COMPARTIDO) ---
                await AssistantResponseProcessor.procesarHandoverYDerivacion(
                    response,
                    ctx,
                    flowDynamic,
                    state,
                    provider,
                    gotoFlow,
                    this.getAssistantResponse.bind(this),
                    assignedAssistantId,
                    assigned,
                    currentAssistantMap,
                    dynamicProjectId
                );

            const timeoutCierreValue = await HistoryHandler.getConfig('timeOutCierre') || 5;
            const setTime = Number(timeoutCierreValue) * 60 * 1000;
            reset(ctx, gotoFlow, setTime);
            return state;

        } catch (error: any) {
            console.warn("⚠️ [AiManager] Comunicación con OpenAI fallida o no configurada. (Ignorando para permitir uso solo como CRM/Pasarela). Detalle:", error.message);
            return state;
        }
    };
}
