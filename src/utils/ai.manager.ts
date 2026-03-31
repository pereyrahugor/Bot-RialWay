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

    public getAssistantResponse = async (assistantId: string, message: string, state: any, fallbackMessage: string | undefined, userId: string, thread_id: string | null = null) => {
        const currentDatetimeArg = getArgentinaDatetimeString();
        let systemPrompt = `Fecha, hora y día de la semana de referencia: ${currentDatetimeArg}`;
        
        if (process.env.EXTRA_SYSTEM_PROMPT) {
            systemPrompt += `\nInstrucción de refuerzo: ${process.env.EXTRA_SYSTEM_PROMPT}`;
        }

        if (fallbackMessage) systemPrompt += `\n${fallbackMessage}`;
        if (userId) systemPrompt += `\nNúmero de contacto: ${userId}`;
        
        const finalMessage = systemPrompt + "\n" + message;

        if (this.userTimeouts.has(userId)) {
            clearTimeout(this.userTimeouts.get(userId)!);
            this.userTimeouts.delete(userId);
        }

        return new Promise((resolve, reject) => {
            const timeoutId = setTimeout(() => {
                console.warn("⏱ Timeout de 60s alcanzado en la comunicación con OpenAI.");
            }, this.TIMEOUT_MS);
            this.userTimeouts.set(userId, timeoutId);

            safeToAsk(assistantId, finalMessage, state, userId, this.errorReporter)
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
        await typing(ctx, provider);
        try {
            const body = ctx.body && ctx.body.trim();

            // COMANDOS DE CONTROL (WhatsApp Admin)
            if (body === "#ON#") {
                await HistoryHandler.toggleBot(ctx.from, true);
                if (ctx.pushName) await HistoryHandler.getOrCreateChat(ctx.from, 'whatsapp', ctx.pushName, ctx.userId);
                const msg = "🤖 Bot activado para este chat.";
                await flowDynamic([{ body: msg }]);
                await HistoryHandler.saveMessage(ctx.from, 'assistant', msg, 'text', null, ctx.userId);
                return state;
            }

            if (body === "#OFF#") {
                await HistoryHandler.toggleBot(ctx.from, false);
                if (ctx.pushName) await HistoryHandler.getOrCreateChat(ctx.from, 'whatsapp', ctx.pushName, ctx.userId);
                const msg = "🛑 Bot desactivado. (Intervención humana activa)";
                await flowDynamic([{ body: msg }]);
                await HistoryHandler.saveMessage(ctx.from, 'assistant', msg, 'text', null, ctx.userId);
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

            await HistoryHandler.saveMessage(
                ctx.from, 
                'user', 
                body || (ctx.type === EVENTS.VOICE_NOTE ? "[Audio]" : "[Media]"), 
                ctx.type,
                ctx.pushName || null,
                ctx.userId
            );

            const isBotActiveForUser = await HistoryHandler.isBotEnabled(ctx.from);
            if (!isBotActiveForUser) {
                try {
                    const threadId = await HistoryHandler.getThreadId(ctx.from);
                    if (threadId) {
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
                    const assistant = await this.openaiMain.beta.assistants.retrieve(this.assistantId);
                    if (assistant && assistant.instructions) {
                        await HistoryHandler.saveSetting('ASSISTANT_PROMPT', assistant.instructions);
                        console.log('✅ [SYNC] Prompt del asistente sincronizado en base de datos.');
                    }

                    await flowDynamic([{ body: "🔄 Datos actualizados desde Google y Assistant Prompt sincronizado (Hot-update)." }]);
                } catch (err: any) {
                    console.error("[AiManager] Error en #ACTUALIZAR#:", err.message);
                    await flowDynamic([{ body: "❌ Error al actualizar datos operativos." }]);
                }
                return state;
            }

            // Filtro de Broadcast/Channel/Lid
            if (ctx.from) {
                if (/@broadcast$/.test(ctx.from) || /@newsletter$/.test(ctx.from) || /@channel$/.test(ctx.from)) return;
                if (/@lid$/.test(ctx.from)) {
                    if (provider && typeof provider.sendMessage === 'function') {
                        await provider.sendMessage('+5491130792789', `⚠️ @lid contacto: ${ctx.from}`);
                    }
                    return;
                }
            }

            // --- LÓGICA MULTI-AGENTE ---
            let assigned = this.userAssignedAssistant.get(ctx.from) || 'asistente1';
            let currentAssistantId = this.ASSISTANT_MAP[assigned] || this.assistantId;

            const response = (await this.getAssistantResponse(currentAssistantId, ctx.body, state, undefined, ctx.from, ctx.thread_id)) as string;

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
            let cleanResponse = String(response)
                .replace(/GET_RESUMEN[\s\S]+/i, '')
                .replace(/^[ \t]*derivar(?:ndo)? a (asistente\s*[1-5]|asesor humano)\.?\s*$/gim, '')
                .replace(/\[Enviando.*$/gim, '')
                .replace(/^[ \t]*\n/gm, '')
                .trim();

            if (destino && this.ASSISTANT_MAP[destino] && destino !== assigned) {
                console.log(`🚀 [MultiAgent] Derivando de ${assigned} a ${destino} para ${ctx.from}`);
                this.userAssignedAssistant.set(ctx.from, destino);

                // Enviar respuesta parcial si existe (sin bloques técnicos)
                if (cleanResponse && cleanResponse.length > 0) {
                    await AssistantResponseProcessor.analizarYProcesarRespuestaAsistente(
                        cleanResponse, ctx, flowDynamic, state, provider, gotoFlow,
                        this.getAssistantResponse, currentAssistantId
                    );
                    await HistoryHandler.saveMessage(ctx.from, 'assistant', cleanResponse, 'text', null, ctx.userId);
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

                    if (nextClean) {
                        await AssistantResponseProcessor.analizarYProcesarRespuestaAsistente(
                           nextClean, ctx, flowDynamic, state, provider, gotoFlow,
                           this.getAssistantResponse, nextAssistantId
                        );
                        await HistoryHandler.saveMessage(ctx.from, 'assistant', nextClean, 'text', null, ctx.userId);
                    }
                }
            } else {
                // Sin derivación o derivación redundante
                if (cleanResponse) {
                    await AssistantResponseProcessor.analizarYProcesarRespuestaAsistente(
                        cleanResponse, ctx, flowDynamic, state, provider, gotoFlow,
                        this.getAssistantResponse, currentAssistantId
                    );
                    await HistoryHandler.saveMessage(ctx.from, 'assistant', cleanResponse, 'text', null, ctx.userId);
                }
            }

            const setTime = Number(process.env.timeOutCierre || 5) * 60 * 1000;
            reset(ctx, gotoFlow, setTime);
            return state;

        } catch (error: any) {
            await this.errorReporter.reportError(error, ctx.from, `https://wa.me/${ctx.from}`);

            if (ctx.type === EVENTS.VOICE_NOTE) return gotoFlow(this.flows.welcomeFlowVoice);
            if (ctx.type === EVENTS.ACTION) return gotoFlow(this.flows.welcomeFlowButton);
            return gotoFlow(this.flows.welcomeFlowTxt);
        }
    };
}
