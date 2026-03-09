import OpenAI from "openai";
import { toAsk } from "@builderbot-plugins/openai-assistants";
import { HistoryHandler } from "./historyHandler";

const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });

/**
 * Capa 1: Verificación Proactiva (waitForActiveRuns)
 * Antes de cada llamada, verificamos si el hilo tiene procesos activos.
 */
export async function waitForActiveRuns(threadId: string, maxAttempts = 5) {
    if (!threadId) return;
    try {
        let attempt = 0;
        while (attempt < maxAttempts) {
            const runs = await openai.beta.threads.runs.list(threadId, { limit: 5 });
            const activeRun = runs.data.find(r => 
                ['in_progress', 'queued', 'requires_action'].includes(r.status)
            );

            if (activeRun) {
                // console.log(`[Reconexión] Run activo detectado (${activeRun.status}): ${activeRun.id}`);
                // Si está estancado en requires_action, lo cancelamos proactivamente
                if (activeRun.status === 'requires_action' && attempt >= 2) {
                    // console.warn(`[Reconexión] Run ${activeRun.id} estancado en requires_action. Cancelando...`);
                    await openai.beta.threads.runs.cancel(threadId, activeRun.id);
                    return;
                }
                await new Promise(resolve => setTimeout(resolve, 2000));
                attempt++;
            } else {
                return;
            }
        }
        
        // Si llegamos al límite, forzamos cancelación de cualquier cosa que quede
        await cancelActiveRuns(threadId);
    } catch (error) {
        // console.error(`Error verificando runs:`, error);
    }
}

/**
 * Cancela todos los runs activos encontrados en un thread
 */
export async function cancelActiveRuns(threadId: string) {
    if (!threadId) return;
    try {
        const runs = await openai.beta.threads.runs.list(threadId, { limit: 10 });
        for (const run of runs.data) {
            if (['in_progress', 'queued', 'requires_action'].includes(run.status)) {
                // console.log(`[Reconexión] Cancelando run residual ${run.id} (${run.status})`);
                try {
                    await openai.beta.threads.runs.cancel(threadId, run.id);
                    await new Promise(r => setTimeout(r, 1000));
                } catch (e) {
                    // console.error(`Error cancelando run ${run.id}:`, e.message);
                }
            }
        }
    } catch (error) {
        // console.error(`Error en cancelActiveRuns:`, error);
    }
}

/**
 * Capa 3: Renovación Automática de Hilo
 * Crea un nuevo hilo con el contexto reciente si el actual está bloqueado.
 */
export async function renewThreadAndRetry(
    assistantId: string, 
    message: string, 
    state: any, 
    userId: string, 
    errorReporter?: any
) {
    try {
        // console.warn(`[ThreadRenewal] Renovando hilo para ${userId} debido a errores persistentes.`);
        
        // 1. Notificar al desarrollador (si hay reporter)
        if (errorReporter && typeof errorReporter.reportError === 'function') {
            await errorReporter.reportError(new Error("Hilo bloqueado. Renovando automáticamente..."), userId, `https://wa.me/${userId.replace(/[^0-9]/g, '')}`);
        }

        // 2. Traer el historial reciente (últimos 10 mensajes)
        const history = await HistoryHandler.getMessages(userId, 10);
        
        // 3. Crear nuevo hilo en OpenAI con ese contexto
        const threadOptions: any = {};
        if (history && history.length > 0) {
            threadOptions.messages = history
                .filter(m => m.content && m.content.trim() !== '')
                .map(m => ({ 
                    role: m.role === 'assistant' ? 'assistant' : 'user', 
                    content: m.content 
                }));
        }

        const newThread = await openai.beta.threads.create(threadOptions);
        // console.log(`[ThreadRenewal] Nuevo hilo creado: ${newThread.id}`);

        // 4. Actualizar estado y reintentar
        if (state && typeof state.update === 'function') {
            await state.update({ thread_id: newThread.id });
        }
        
        return await toAsk(assistantId, message, state);
    } catch (error) {
        // console.error('[ThreadRenewal] Error fatal renovando hilo:', error);
        throw error;
    }
}

/**
 * Capa 2: Petición Segura con Reintentos (safeToAsk)
 * Centraliza la lógica de comunicación con OpenAI Assistants.
 */
export const safeToAsk = async (
    assistantId: string,
    message: string,
    state: any,
    userId: string = 'unknown',
    errorReporter?: any,
    maxRetries = 5
) => {
    let attempt = 0;
    while (attempt < maxRetries) {
        let threadId = state && typeof state.get === 'function' && state.get('thread_id');
        
        if (threadId) {
            await waitForActiveRuns(threadId);
        }

        try {
            return await toAsk(assistantId, message, state);
        } catch (err: any) {
            attempt++;
            const errorMessage = err?.message || String(err);
            // console.error(`[safeToAsk] Error (Intento ${attempt}/${maxRetries}):`, errorMessage);

            // Si OpenAI nos dice qué run está bloqueando, lo cancelamos de inmediato
            if (errorMessage.includes('while a run') && errorMessage.includes('is active') && threadId) {
                const runIdMatch = errorMessage.match(/run_[a-zA-Z0-9]+/);
                if (runIdMatch) {
                    // console.log(`[safeToAsk] Cancelando run bloqueante detectado: ${runIdMatch[0]}`);
                    try {
                        await openai.beta.threads.runs.cancel(threadId, runIdMatch[0]);
                        await new Promise(r => setTimeout(r, 3000));
                        continue; // Reintento inmediato
                    } catch (cancelErr) {
                        // console.error(`[safeToAsk] Error cancelando ${runIdMatch[0]}:`, cancelErr);
                    }
                }
            }

            if (attempt >= maxRetries) {
                // CAPA 3: Renovación de Hilo
                return await renewThreadAndRetry(assistantId, message, state, userId, errorReporter);
            }
            
            const waitTime = attempt * 2000;
            // console.log(`[safeToAsk] Esperando ${waitTime/1000}s para reintentar...`);
            await new Promise(r => setTimeout(r, waitTime));
        }
    }
};
