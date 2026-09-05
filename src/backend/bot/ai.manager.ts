import { typing } from "./presence";
import { HistoryHandler } from "../db/historyHandler";
import { EVENTS } from "@builderbot/bot";
import { getArgentinaDatetimeString } from "../utils/ArgentinaTime";
import { safeToAsk, syncAssistantTools } from "../apis/openai/openaiHelper";
import { AssistantResponseProcessor } from "../apis/openai/AssistantResponseProcessor";
import { stop, reset } from "./timeOut";
import { updateMain } from "../apis/google/updateMain";

export class AiManager {
    private userTimeouts = new Map<string, NodeJS.Timeout>();
    private readonly DEFAULT_TIMEOUT_MS = 60000;

    constructor(
        public openaiMain: any, // Objeto OpenAI (ahora dinámico vía openaiHelper)
        public assistantId: string, // Mantenemos por compatibilidad
        public errorReporter: any,
        public flows: any
    ) {}

    /**
     * Resuelve el ASSISTANT_MAP de forma dinámica para Hot-update.
     */
    public async getAssistantMap(projectId: string | null = null, serviceId: string | null = null): Promise<Record<string, string | undefined>> {
        const assistant1 = await HistoryHandler.getConfig('ASSISTANT_1', projectId, serviceId) || await HistoryHandler.getConfig('ASSISTANT_ID', projectId, serviceId);
        const map = {
            asistente1: assistant1 || this.assistantId,
            asistente2: await HistoryHandler.getConfig('ASSISTANT_2', projectId, serviceId) || undefined,
            asistente3: await HistoryHandler.getConfig('ASSISTANT_3', projectId, serviceId) || undefined,
            asistente4: await HistoryHandler.getConfig('ASSISTANT_4', projectId, serviceId) || undefined,
            asistente5: await HistoryHandler.getConfig('ASSISTANT_5', projectId, serviceId) || undefined,
        };

        // Log de diagnóstico silencioso para debug interno si se necesita
        // console.log(`[AiManager] Assistant Map [${projectId || 'global'}]:`, Object.keys(map).filter(k => map[k]).join(', '));
        
        return map;
    }

    /**
     * Retorna el Assistant ID asignado al usuario
     */
    public async getAssignedAssistantId(userId: string, forcedProjectId?: string, forcedServiceId?: string): Promise<string> {
        const assigned = await HistoryHandler.getAssignedAgent(userId, forcedProjectId, forcedServiceId) || 'asistente1';
        const map = await this.getAssistantMap(forcedProjectId || null, forcedServiceId || null);
        
        const assistantId = map[assigned];
        if (!assistantId) {
            console.warn(`⚠️ [AiManager] No se encontró Assistant ID para '${assigned}'. Reconvirtiendo a asistente1.`);
            return map['asistente1'] || this.assistantId;
        }
        return assistantId;
    }

    public getAssistantResponse = async (assistantId: string, message: string, state: any, fallbackMessage: string | undefined, userId: string, thread_id: string | null = null, projectId: string | null = null, agentName: string | undefined = undefined, serviceId: string | null = null) => {
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
            const stateServiceId = (typeof state?.get === 'function') ? state.get('dynamicServiceId') : state?.dynamicServiceId;
            const targetServiceId = serviceId || stateServiceId || HistoryHandler.SERVICE_IDENTIFIER;

            safeToAsk(assistantId, message, state, userId, this.errorReporter, 5, isWhatsApp, targetProjectId, false, agentName, targetServiceId)
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
        const dynamicServiceId = await HistoryHandler.getServiceIdByRecipient(botPhoneNumber) || HistoryHandler.SERVICE_IDENTIFIER;
        
        // Determinar el agente asignado. 
        // Si no hay agente en el 'state' (redeploy/reset), forzamos asistente1
        let assigned = state.get('assignedAgent');
        if (!assigned) {
            console.log(`[AiManager] 🔄 Sesión fresca o redeploy detectado para ${ctx.from}. Cargando agente asignado desde DB.`);
            assigned = await HistoryHandler.getAssignedAgent(ctx.from, dynamicProjectId, dynamicServiceId);
            await state.update({ assignedAgent: assigned });
        } else {
            // Si ya hay en state, verificar que coincida con DB (opcional, pero seguro)
            const dbAssigned = await HistoryHandler.getAssignedAgent(ctx.from, dynamicProjectId, dynamicServiceId);
            if (dbAssigned !== assigned) {
                assigned = dbAssigned;
                await state.update({ assignedAgent: dbAssigned });
            }
        }

        const assistantMap = await this.getAssistantMap(dynamicProjectId, dynamicServiceId);
        const assignedAssistantId = assistantMap[assigned] || this.assistantId;

        // Guardar contexto en el state para uso en flujos (como idleFlow o reconectionFlow)
        if (state && state.update) {
            await state.update({ 
                dynamicProjectId,
                dynamicServiceId,
                assignedAssistantId,
                botPhoneNumber
            });
        }

        console.log(`[AiManager] 📥 Procesando: ${ctx.from} | Proyecto: ${dynamicProjectId} | Agente: ${assigned}`);
        
        const rawBody = String(ctx.body || '').trim();
        const normalizedBody = rawBody.toUpperCase();
        const chatId = ctx.from;

        // --- COMANDOS DE SISTEMA (#xxxx# / #xxxx) ---

        // 1. Reset de Asistente y Memoria
        if (normalizedBody === '#RESET#' || normalizedBody === '#RESET') {
            console.log(`[AiManager] ♻️ Reiniciando historial y agente para ${chatId}`);
            await HistoryHandler.setAssignedAgent(chatId, 'asistente1', dynamicProjectId, dynamicServiceId);
            await HistoryHandler.saveThreadId(chatId, '', dynamicProjectId, dynamicServiceId);
            await state.update({ assignedAgent: 'asistente1', thread_id: null });
            return await flowDynamic("✅ Historial de conversación y asignación de asistente reiniciados.");
        }

        // 2. Hilo Nuevo (Borrar historial de mensajes y memoria)
        if (normalizedBody === '#HILO_NUEVO#' || normalizedBody === '#HILO_NUEVO') {
            console.log(`[AiManager] 🗑️ Borrando todo el historial de chat para el contacto ${chatId}`);
            await HistoryHandler.clearChatHistory(chatId, dynamicProjectId, dynamicServiceId);
            await HistoryHandler.setAssignedAgent(chatId, 'asistente1', dynamicProjectId, dynamicServiceId);
            await HistoryHandler.saveThreadId(chatId, '', dynamicProjectId, dynamicServiceId);
            await state.update({ assignedAgent: 'asistente1', thread_id: null });
            return await flowDynamic("✅ Se ha borrado todo el historial de conversación de este contacto y se ha iniciado un nuevo hilo de chat.");
        }

        // 3. Eliminar Contexto de Cliente
        if (normalizedBody === '#CLEAR_CONTEXT#' || normalizedBody === '#CLEAR_CONTEXT' || normalizedBody === '#ELIMINAR_CONTEXTO#' || normalizedBody === '#ELIMINAR_CONTEXTO') {
            console.log(`[AiManager] 🧹 Limpiando contexto de cliente y memoria para ${chatId}`);
            await HistoryHandler.clearClientContext(chatId, dynamicProjectId, dynamicServiceId);
            await HistoryHandler.saveThreadId(chatId, '', dynamicProjectId, dynamicServiceId);
            await state.update({ thread_id: null, datosClienteContext: null });
            return await flowDynamic("✅ Contexto de cliente y memoria de sesión eliminados.");
        }

        // 4. Activar Bot para este Chat
        if (normalizedBody === "#ON#" || normalizedBody === "#ON") {
            const isBlocked = await HistoryHandler.isContactBlacklisted(chatId, dynamicProjectId, dynamicServiceId);
            if (isBlocked) {
                const msg = "⛔ No se puede activar el bot: este contacto está en la LISTA NEGRA. Quítalo de la lista negra desde el panel para reactivarlo.";
                await flowDynamic([{ body: msg }]);
                return state;
            }
            await HistoryHandler.toggleBot(chatId, true, dynamicProjectId, dynamicServiceId);
            if (ctx.pushName) await HistoryHandler.getOrCreateChat(chatId, 'whatsapp', ctx.pushName, ctx.userId, dynamicProjectId, dynamicServiceId);
            const msg = "🤖 Bot activado para este chat.";
            await flowDynamic([{ body: msg }]);
            await HistoryHandler.saveMessage(chatId, 'assistant', msg, 'text', null, ctx.userId, null, ctx.platform, dynamicProjectId, dynamicServiceId);
            return state;
        }

        // 5. Desactivar Bot para este Chat
        if (normalizedBody === "#OFF#" || normalizedBody === "#OFF") {
            await HistoryHandler.toggleBot(chatId, false, dynamicProjectId, dynamicServiceId);
            if (ctx.pushName) await HistoryHandler.getOrCreateChat(chatId, 'whatsapp', ctx.pushName, ctx.userId, dynamicProjectId, dynamicServiceId);
            const msg = "🛑 Bot desactivado. (Intervención humana activa)";
            await flowDynamic([{ body: msg }]);
            await HistoryHandler.saveMessage(chatId, 'assistant', msg, 'text', null, ctx.userId, null, ctx.platform, dynamicProjectId, dynamicServiceId);
            return state;
        }

        // 6. Desactivar Bot Globalmente
        if (normalizedBody === "#FULL_OFF#" || normalizedBody === "#FULL_OFF") {
            await HistoryHandler.saveSetting('GLOBAL_BOT_ENABLED', 'false', dynamicProjectId, dynamicServiceId);
            const msg = "🛑 Bot desactivado GLOBALMENTE para todas las conversaciones.";
            await flowDynamic([{ body: msg }]);
            await HistoryHandler.saveMessage(chatId, 'assistant', msg, 'text', null, ctx.userId, null, ctx.platform, dynamicProjectId, dynamicServiceId);
            return state;
        }

        // 7. Activar Bot Globalmente
        if (normalizedBody === "#FULL_ON#" || normalizedBody === "#FULL_ON") {
            await HistoryHandler.saveSetting('GLOBAL_BOT_ENABLED', 'true', dynamicProjectId, dynamicServiceId);
            const msg = "🤖 Bot activado GLOBALMENTE para todas las conversaciones.";
            await flowDynamic([{ body: msg }]);
            await HistoryHandler.saveMessage(chatId, 'assistant', msg, 'text', null, ctx.userId, null, ctx.platform, dynamicProjectId, dynamicServiceId);
            return state;
        }

        // 8. Sincronización Global (Google Sheets, RAG y OpenAI Tools)
        if (normalizedBody === "#ACTUALIZAR#" || normalizedBody === "#ACTUALIZAR") {
            try {
                console.log(`📡 [SYNC] Sincronizando hojas de Google, base de datos RAG y herramientas para proyecto: ${dynamicProjectId}, servicio: ${dynamicServiceId}...`);
                await updateMain(dynamicProjectId, dynamicServiceId);
                
                const currentAssistantMap = await this.getAssistantMap(dynamicProjectId, dynamicServiceId);
                const currentAssistantId = currentAssistantMap[assigned] || this.assistantId;

                if (currentAssistantId) {
                    console.log(`📡 [SYNC] Sincronizando herramientas con el asistente de OpenAI (${currentAssistantId})...`);
                    await syncAssistantTools(currentAssistantId, dynamicProjectId, dynamicServiceId);
                }

                console.log('✅ [SYNC] Todo actualizado correctamente.');
                await flowDynamic([{ body: "🔄 Sincronización completada con éxito:\n1. Base de datos de Google Sheets actualizada.\n2. Documentos RAG re-indexados.\n3. Herramientas y funciones del asistente de OpenAI actualizadas." }]);
            } catch (err: any) {
                console.error("[AiManager] Error en #ACTUALIZAR#:", err.message);
                await flowDynamic([{ body: "❌ Error al actualizar los datos operativos y el RAG." }]);
            }
            return state;
        }

        try {
            // Filtro de Eco (Mejorado para BSUID)
            if (ctx.key?.fromMe) {
                stop(ctx);
                return;
            }

            // Filtro de Reacciones (no enviar a OpenAI)
            if (ctx.type === 'reaction' || ctx.body === '_event_reaction_' || String(ctx.body || '').startsWith('_event_reaction_')) {
                stop(ctx);
                return state;
            }

            stop(ctx);

            // --- FILTRO DE BOT GLOBAL ---
            const isGlobalBotEnabledSetting = await HistoryHandler.getSetting('GLOBAL_BOT_ENABLED', dynamicProjectId, dynamicServiceId);
            const isGlobalBotEnabled = isGlobalBotEnabledSetting !== 'false';
            const isBotActiveForUser = await HistoryHandler.isBotEnabled(ctx.from, dynamicProjectId, dynamicServiceId);
            const shouldApplyGlobalBotSwitch = ctx.type !== 'webchat';

            if ((shouldApplyGlobalBotSwitch && !isGlobalBotEnabled) || !isBotActiveForUser) {
                if (shouldApplyGlobalBotSwitch && !isGlobalBotEnabled) {
                    console.log(`[AiManager] Bot DESACTIVADO GLOBALMENTE para el proyecto ${dynamicProjectId}.`);
                }
                stop(ctx);
                // El webchat ignora el apagado global porque se usa para testear el bot.
                return state;
            }

            await typing(ctx, provider);

            // --- FILTRO DE LISTA NEGRA ---
            const isBlacklisted = await HistoryHandler.isContactBlacklisted(ctx.from, dynamicProjectId, dynamicServiceId);
            if (isBlacklisted) {
                console.log(`[AiManager] ⛔ Contacto ${ctx.from} en lista negra (Sin Bot / Bloqueado). Intervención humana asegurada.`);
                const currentBotState = await HistoryHandler.isBotEnabled(ctx.from, dynamicProjectId, dynamicServiceId);
                if (currentBotState) {
                    await HistoryHandler.toggleBot(ctx.from, false, dynamicProjectId, dynamicServiceId);
                }
                stop(ctx);
                return state;
            }

            // Filtro de Broadcast/Channel
            if (ctx.from) {
                if (/@broadcast$/.test(ctx.from) || /@newsletter$/.test(ctx.from) || /@channel$/.test(ctx.from)) return;
            }

            // --- LÓGICA MULTI-AGENTE ---
            const currentAssistantMap = await this.getAssistantMap(dynamicProjectId, dynamicServiceId);
            const currentAssistantId = currentAssistantMap[assigned] || this.assistantId;

            // --- DETECCIÓN Y CONTEXTUALIZACIÓN DE ANUNCIOS (CTWA - Facebook/Instagram) ---
            const referral = ctx.referral || ctx.payload?.referral || null;
            const externalAdReply = ctx.payload?.message?.extendedTextMessage?.contextInfo?.externalAdReply ||
                                    ctx.message?.contextInfo?.externalAdReply || 
                                    ctx.payload?.contextInfo?.externalAdReply || null;
            const adHeadline = referral?.headline || externalAdReply?.title || null;
            const adBody = referral?.body || externalAdReply?.body || null;

            let messageForAI = ctx.body;
            if (adBody || adHeadline) {
                const adContext = `[Contexto del Anuncio en Facebook/Instagram desde el que escribe el usuario: "${adHeadline || ''}" - "${adBody || ''}"]`;
                if (!messageForAI.includes(adBody)) {
                    messageForAI = `${adContext}\n\nMensaje del usuario: ${messageForAI}`;
                    console.log(`[AiManager] 🎯 Inyectado contexto de anuncio publicitario para ${ctx.from}: "${adHeadline || ''}"`);
                }
            }

            const response = (await this.getAssistantResponse(assignedAssistantId, messageForAI, state, undefined, ctx.from, ctx.thread_id, dynamicProjectId, assigned, dynamicServiceId)) as string;

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
                    dynamicProjectId,
                    dynamicServiceId
                );

            const timeoutCierreValue = await HistoryHandler.getConfig('timeOutCierre', dynamicProjectId, dynamicServiceId) || 5;
            const setTime = Number(timeoutCierreValue) * 60 * 1000;
            reset(ctx, gotoFlow, setTime);
            return state;

        } catch (error: any) {
            console.warn("⚠️ [AiManager] Comunicación con OpenAI fallida o no configurada. (Ignorando para permitir uso solo como CRM/Pasarela). Detalle:", error.message);
            return state;
        }
    };
}
