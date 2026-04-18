import { typing } from "./presence";
import { HistoryHandler } from "./historyHandler";
import { EVENTS } from "@builderbot/bot";
import { getArgentinaDatetimeString } from "./ArgentinaTime";
import { safeToAsk } from "./openaiHelper";
import { AssistantResponseProcessor } from "./AssistantResponseProcessor";
import { stop, reset } from "./timeOut";
import { updateMain } from "../addModule/updateMain";

export class AiManager {
    private userTimeouts = new Map<string, NodeJS.Timeout>();
    private readonly TIMEOUT_MS = 60000;
    private userAssignedAssistant = new Map<string, string>(); // userId -> 'asistente1', 'asistente2', etc.

    // IDs genéricos de asistentes desde variables de entorno
    public readonly ASSISTANT_MAP: Record<string, string | undefined> = {
        asistente1: process.env.ASSISTANT_1 || process.env.ASSISTANT_ID, 
        asistente2: process.env.ASSISTANT_2,
        asistente3: process.env.ASSISTANT_3,
        asistente4: process.env.ASSISTANT_4,
        asistente5: process.env.ASSISTANT_5,
    };

    constructor(
        private openaiMain: any,
        private assistantId: string, // Mantenemos por compatibilidad, pero usaremos ASSISTANT_MAP
        private errorReporter: any,
        private flows: any // Objeto con welcomeFlowTxt, welcomeFlowVoice, etc.
    ) {}

    /**
     * Retorna el Assistant ID asignado al usuario
     */
    public getAssignedAssistantId(userId: string): string {
        const assigned = this.userAssignedAssistant.get(userId) || 'asistente1';
        return this.ASSISTANT_MAP[assigned] || this.assistantId;
    }

    public getAssistantResponse = async (assistantId: string, message: string, state: any, fallbackMessage: string | undefined, userId: string, thread_id: string | null = null, forcedProjectId?: string) => {
        if (this.userTimeouts.has(userId)) {
            clearTimeout(this.userTimeouts.get(userId)!);
            this.userTimeouts.delete(userId);
        }

        return new Promise((resolve, reject) => {
            const timeoutId = setTimeout(() => {
                console.warn("⏱ Timeout de 60s alcanzado en la comunicación con OpenAI.");
            }, this.TIMEOUT_MS);
            this.userTimeouts.set(userId, timeoutId);

            const isWhatsApp = userId && userId.includes('@s.whatsapp.net');
            const currentProjectId = forcedProjectId || process.env.RAILWAY_PROJECT_ID;

            safeToAsk(assistantId, message, state, userId, this.errorReporter, 5, isWhatsApp, currentProjectId, false)
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

    /**
     * Analiza la respuesta para determinar si hay una derivación a otro asistente.
     */
    public analizarDestinoRecepcionista(respuesta: string): string | null {
        if (!respuesta || typeof respuesta !== 'string') return null;
        const lower = respuesta.toLowerCase();
        if (/derivar(?:ndo)?\s+a\s+asistente\s*1\b/.test(lower)) return 'asistente1';
        if (/derivar(?:ndo)?\s+a\s+asistente\s*2\b/.test(lower)) return 'asistente2';
        if (/derivar(?:ndo)?\s+a\s+asistente\s*3\b/.test(lower)) return 'asistente3';
        if (/derivar(?:ndo)?\s+a\s+asistente\s*4\b/.test(lower)) return 'asistente4';
        if (/derivar(?:ndo)?\s+a\s+asistente\s*5\b/.test(lower)) return 'asistente5';
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
        // Resolución dinámica del Project ID
        const recipientId = ctx.phoneNumberId || null;
        const dynamicProjectId = await HistoryHandler.getProjectIdByRecipient(recipientId);
        
        const assigned = this.userAssignedAssistant.get(ctx.from) || 'asistente1';
        console.log(`[AiManager] 📥 Procesando mensaje de ${ctx.from}. ProjectID: ${dynamicProjectId}. Asistente: ${assigned}. Mensaje: ${ctx.body}`);
        
        // --- COMANDO DE REINICIO ---
        if (ctx.body && ctx.body.trim().toUpperCase() === '#RESET#') {
            const chatId = ctx.from;
            console.log(`[AiManager] ♻️ Reiniciando historial para ${chatId}`);
            await HistoryHandler.saveThreadId(chatId, null as any); // null as any para evitar problemas de tipos si thread_id espera string
            if (state && typeof state.update === 'function') {
                await state.update({ thread_id: null });
            }
            return await flowDynamic("✅ Historial de conversación reiniciado. El asistente ya no recordará los mensajes anteriores.");
        }
        
        await typing(ctx, provider);
        try {
            const body = ctx.body && ctx.body.trim();

            // COMANDOS DE CONTROL (WhatsApp Admin)
            if (body === "#ON#") {
                await HistoryHandler.toggleBot(ctx.from, true);
                if (ctx.pushName) await HistoryHandler.getOrCreateChat(ctx.from, 'whatsapp', ctx.pushName, ctx.userId, dynamicProjectId);
                const msg = "🤖 Bot activado para este chat.";
                await flowDynamic([{ body: msg }]);
                await HistoryHandler.saveMessage(ctx.from, 'assistant', msg, 'text', null, ctx.userId, null, ctx.platform, dynamicProjectId);
                return state;
            }

            if (body === "#OFF#") {
                await HistoryHandler.toggleBot(ctx.from, false);
                if (ctx.pushName) await HistoryHandler.getOrCreateChat(ctx.from, 'whatsapp', ctx.pushName, ctx.userId, dynamicProjectId);
                const msg = "🛑 Bot desactivado. (Intervención humana activa)";
                await flowDynamic([{ body: msg }]);
                await HistoryHandler.saveMessage(ctx.from, 'assistant', msg, 'text', null, ctx.userId, null, ctx.platform, dynamicProjectId);
                return state;
            }

            // Filtro de Eco (Mejorado para BSUID)
            const botNumber = (process.env.YCLOUD_WABA_NUMBER || '').replace(/\D/g, '');
            const senderNumber = (ctx.from || '').replace(/\D/g, '');
            // Si el botNumber coincide con el sender o con el userId, lo ignoramos
            if (ctx.key?.fromMe || (botNumber && (senderNumber === botNumber || ctx.userId === botNumber))) {
                stop(ctx);
                return;
            }

            stop(ctx);

            // ELIMINADO: Duplicado con provider.manager.ts
            // await HistoryHandler.saveMessage( ... );

            const isBotActiveForUser = await HistoryHandler.isBotEnabled(ctx.from);
            if (!isBotActiveForUser) {
                try {
                    const threadId = await HistoryHandler.getThreadId(ctx.from);
                    if (threadId && this.openaiMain) {
                        await this.openaiMain.beta.threads.messages.create(threadId, {
                            role: 'user',
                            content: body || '[Media]'
                        });
                    }
                } catch (e: any) {
                    console.error("[AiManager] Error guardando threadId:", e.message);
                }
                return state;
            }

            // Comandos Globales y Sheet Update
            if (body === "#ACTUALIZAR#") {
                try {
                    console.log('📡 [SYNC] Sincronizando datos de Google y Prompt de OpenAI...');
                    await updateMain();
                    
                    // Sincronización del Prompt del asistente (Hot-update)
                    if (this.openaiMain) {
                        const assistant = await this.openaiMain.beta.assistants.retrieve(this.assistantId);
                        if (assistant && assistant.instructions) {
                            await HistoryHandler.saveSetting('ASSISTANT_PROMPT', assistant.instructions);
                            console.log('✅ [SYNC] Prompt del asistente sincronizado en base de datos.');
                        }
                    } else {
                        console.warn('⚠️ [SYNC] Saltando sincronización de prompt: OpenAI no configurado.');
                    }

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
            const assigned = this.userAssignedAssistant.get(ctx.from) || 'asistente1';
            const currentAssistantId = this.ASSISTANT_MAP[assigned] || this.assistantId;

            const response = (await this.getAssistantResponse(currentAssistantId, ctx.body, state, undefined, ctx.from, ctx.thread_id, dynamicProjectId)) as string;

            if (!response) return state;

            try {
                const currentThreadId = state && typeof state.get === 'function' ? state.get('thread_id') : null;
                if (currentThreadId && ctx.from) {
                    await HistoryHandler.saveThreadId(ctx.from, currentThreadId);
                }
            } catch (e: any) {
                console.error("[AiManager] Error guardando threadId:", e.message);
            }

            const destino = this.analizarDestinoRecepcionista(response);
            const resumen = this.extraerResumenRecepcionista(response);
            
            // Limpiar la respuesta para el usuario (remover bloques técnicos)
            const cleanResponse = String(response)
                .replace(/GET_RESUMEN[\s\S]+/i, '')
                .replace(/^[ \t]*derivar(?:ndo)? a (asistente\s*[1-5]|asesor humano)\.?\s*$/gim, '')
                .replace(/\[Enviando.*$/gim, '')
                .replace(/^[ \t]*\n/gm, '')
                .trim();

            if (destino && this.ASSISTANT_MAP[destino] && destino !== assigned) {
                console.log(`🚀 [MultiAgent] Derivando de ${assigned} a ${destino} para ${ctx.from}`);
                this.userAssignedAssistant.set(ctx.from, destino);

                // Enviar respuesta parcial si existe (sin bloques técnicos)
                if (response && response.trim().length > 0) {
                    await AssistantResponseProcessor.analizarYProcesarRespuestaAsistente(
                        response, ctx, flowDynamic, state, provider, gotoFlow,
                        this.getAssistantResponse, currentAssistantId, 0, dynamicProjectId
                    );
                }

                // Consultar inmediatamente al siguiente asistente
                const nextAssistantId = this.ASSISTANT_MAP[destino]!;
                const nextResponseRaw = (await this.getAssistantResponse(nextAssistantId, resumen, state, undefined, ctx.from, ctx.thread_id)) as string;
                
                if (nextResponseRaw) {
                    const nextClean = String(nextResponseRaw)
                        .replace(/GET_RESUMEN[\s\S]+/i, '')
                        .replace(/^[ \t]*derivar(?:ndo)? a (asistente\s*[1-5]|asesor humano)\.?\s*$/gim, '')
                        .replace(/\[Enviando.*$/gim, '')
                        .replace(/^[ \t]*\n/gm, '')
                        .trim();

                    if (nextResponseRaw && nextResponseRaw.trim().length > 0) {
                        await AssistantResponseProcessor.analizarYProcesarRespuestaAsistente(
                           nextResponseRaw, ctx, flowDynamic, state, provider, gotoFlow,
                           this.getAssistantResponse, nextAssistantId, 0, dynamicProjectId
                        );
                    }
                }
            } else {
                // Sin derivación o derivación redundante
                if (response && response.trim().length > 0) {
                    await AssistantResponseProcessor.analizarYProcesarRespuestaAsistente(
                        response, ctx, flowDynamic, state, provider, gotoFlow,
                        this.getAssistantResponse, currentAssistantId, 0, dynamicProjectId
                    );
                }
            }

            const setTime = Number(process.env.timeOutCierre || 5) * 60 * 1000;
            reset(ctx, gotoFlow, setTime);
            return state;

        } catch (error: any) {
            console.warn("⚠️ [AiManager] Comunicación con OpenAI fallida o no configurada. (Ignorando para permitir uso solo como CRM/Pasarela). Detalle:", error.message);
            return state;
        }
    };
}
