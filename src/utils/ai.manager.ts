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
    public async getAssignedAssistantId(userId: string, forcedProjectId?: string): Promise<string> {
        const assigned = await HistoryHandler.getAssignedAgent(userId, forcedProjectId) || 'asistente1';
        return this.ASSISTANT_MAP[assigned] || this.assistantId;
    }

    public getAssistantResponse = async (assistantId: string, message: string, state: any, fallbackMessage: string | undefined, userId: string, thread_id: string | null = null, projectId: string | null = null) => {
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
            const targetProjectId = projectId || process.env.RAILWAY_PROJECT_ID;

            safeToAsk(assistantId, message, state, userId, this.errorReporter, 5, isWhatsApp, targetProjectId, false)
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
        // Regex robusto para detectar derivación exactas según prompt
        if (/(?:derivar|derivando)(?:\s+a)?\s+asistente\s*1\b/i.test(lower)) return 'asistente1';
        if (/(?:derivar|derivando)(?:\s+a)?\s+asistente\s*2\b/i.test(lower)) return 'asistente2';
        if (/(?:derivar|derivando)(?:\s+a)?\s+asistente\s*3\b/i.test(lower)) return 'asistente3';
        if (/(?:derivar|derivando)(?:\s+a)?\s+asistente\s*4\b/i.test(lower)) return 'asistente4';
        if (/(?:derivar|derivando)(?:\s+a)?\s+asistente\s*5\b/i.test(lower)) return 'asistente5';
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
        const botPhoneNumber = provider?.phoneNumber || (ctx.to ? ctx.to.replace(/\D/g, '') : null);
        const dynamicProjectId = await HistoryHandler.getProjectIdByRecipient(botPhoneNumber) || process.env.RAILWAY_PROJECT_ID;
        const assigned = await HistoryHandler.getAssignedAgent(ctx.from, dynamicProjectId);
        const assignedAssistantId = this.ASSISTANT_MAP[assigned] || this.assistantId;

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
            console.log(`[AiManager] ♻️ Reiniciando historial para ${chatId} (Local Only)`);
            return await flowDynamic("✅ Historial de conversación reiniciado localmente. El asistente ya no recordará los mensajes anteriores en la próxima consulta.");
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
            const currentAssistantId = this.ASSISTANT_MAP[assigned] || this.assistantId;

            const response = (await this.getAssistantResponse(currentAssistantId, ctx.body, state, undefined, ctx.from, ctx.thread_id, dynamicProjectId)) as string;

            if (!response) return state;

            // No necesitamos guardar threadId en Chat Completions

            const destino = this.analizarDestinoRecepcionista(response);
            const resumen = this.extraerResumenRecepcionista(response);
            
            if (destino && this.ASSISTANT_MAP[destino] && destino !== assigned) {
                console.log(`🚀 [MultiAgent] Handover: ${assigned} -> ${destino} (User: ${ctx.from})`);
                await HistoryHandler.setAssignedAgent(ctx.from, destino, dynamicProjectId);

                // 1. Procesar respuesta del agente saliente (limpieza interna en Processor)
                await AssistantResponseProcessor.analizarYProcesarRespuestaAsistente(
                    response, ctx, flowDynamic, state, provider, gotoFlow,
                    this.getAssistantResponse.bind(this), currentAssistantId, 0, dynamicProjectId
                );

                // 2. Transición inmediata: Consultar al nuevo agente con el resumen
                const nextAssistantId = await this.getAssignedAssistantId(ctx.from, dynamicProjectId);
                const nextResponseRaw = (await this.getAssistantResponse(nextAssistantId, resumen, state, undefined, ctx.from, ctx.thread_id, dynamicProjectId)) as string;
                
                if (nextResponseRaw) {
                    await AssistantResponseProcessor.analizarYProcesarRespuestaAsistente(
                        nextResponseRaw, ctx, flowDynamic, state, provider, gotoFlow,
                        this.getAssistantResponse.bind(this), nextAssistantId, 0, dynamicProjectId
                    );
                }
            } else {
                // Sin transferencia: flujo normal
                await AssistantResponseProcessor.analizarYProcesarRespuestaAsistente(
                    response, ctx, flowDynamic, state, provider, gotoFlow,
                    this.getAssistantResponse.bind(this), currentAssistantId, 0, dynamicProjectId
                );
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
