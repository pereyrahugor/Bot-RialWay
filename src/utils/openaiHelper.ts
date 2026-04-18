import OpenAI from "openai";
import { HistoryHandler } from "./historyHandler";
import { getArgentinaDatetimeString } from "./ArgentinaTime";
import { executeDbQuery } from "./dbHandler";

const openai = process.env.OPENAI_API_KEY ? new OpenAI({ apiKey: process.env.OPENAI_API_KEY }) : null;

/**
 * Limpia y parsea un string JSON que puede venir envuelto en comillas literales (común en variables de entorno).
 */
function safeParseJson(jsonStr: string | undefined): any {
    if (!jsonStr) return null;
    let clean = jsonStr.trim();
    // Eliminar comillas simples o dobles envolventes si existen
    if ((clean.startsWith("'") && clean.endsWith("'")) || (clean.startsWith('"') && clean.endsWith('"'))) {
        clean = clean.slice(1, -1);
    }
    return JSON.parse(clean);
}

/**
 * Sincroniza las herramientas (tools) definidas en las variables de entorno con el asistente de OpenAI.
 * Esto evita tener que configurar manualmente el Dashboard.
 */
export async function syncAssistantTools(assistantId: string): Promise<boolean> {
    if (!openai || !assistantId) return false;

    try {
        const toolsJson = process.env.OPENAI_TOOLS_DEFINITION;
        if (!toolsJson) {
            console.log("[openaiHelper] No se detectó OPENAI_TOOLS_DEFINITION. Omitiendo sincronización de tools.");
            return false;
        }

        const tools = safeParseJson(toolsJson);
        console.log(`[openaiHelper] 🔄 Sincronizando ${tools.length} herramientas con el asistente ${assistantId}...`);

        await openai.beta.assistants.update(assistantId, {
            tools: tools
        });

        console.log("[openaiHelper] ✅ Herramientas sincronizadas correctamente.");
        return true;
    } catch (error: any) {
        console.error("[openaiHelper] ❌ Error sincronizando herramientas:", error.message);
        return false;
    }
}

export const askWithFunctions = async (assistantId: string, message: string, state: any, userId: string = 'unknown', forceDb: boolean = false, projectId: string | null = null, directMode: boolean = true): Promise<string> => {
    if (!openai) {
        console.warn("⚠️ OPENAI_API_KEY no detectada. El asistente de IA está desactivado.");
        return "Lo siento, el asistente de IA no está configurado actualmente.";
    }
    let threadId = state && typeof state.get === 'function' ? state.get('thread_id') : null;
    
    // 1. Obtiene o crea el Thread
    if (!threadId) {
        const thread = await openai.beta.threads.create();
        threadId = thread.id;
        if (state && typeof state.update === 'function') {
            await state.update({ thread_id: threadId });
        }
    }

    // 2. Envía el mensaje del usuario al Thread
    await openai.beta.threads.messages.create(threadId, {
        role: "user",
        content: message
    });

    // Función recursiva que evalúa el estado de la comunicación iterativamente
    const handleRunStatus = async (run: OpenAI.Beta.Threads.Runs.Run): Promise<string> => {
        // A) OpenAI completó la respuesta generativa en modo "Respuesta de Texto"
        if (run.status === 'completed') {
            const messages = await openai.beta.threads.messages.list(run.thread_id);
            const latestMessage = messages.data.filter(m => m.role === 'assistant')[0];
            if (!latestMessage) return '';
            
            // Concatenate all text parts (new API v2 can have multiple content parts)
            return latestMessage.content
                .filter(c => c.type === 'text')
                .map((c: any) => c.text.value)
                .join('\n\n');
        } 
        
        // B) OpenAI entró en modo Tool Call (Function Calling) y necesita que procesemos la lógica localmente
        else if (run.status === 'requires_action') {
            const toolCalls = run.required_action?.submit_tool_outputs?.tool_calls;
            if (!toolCalls) return '';

            // Ejecutar en paralelo todas las funciones que nos pidió la IA
            const toolOutputs = await Promise.all(toolCalls.map(async (toolCall: any) => {
                const funcName = toolCall.function.name;
                let args = {};
                try {
                    args = JSON.parse(toolCall.function.arguments || "{}");
                } catch (e) {
                     console.error(`[FunctionCall] Error parseando argumentos para ${funcName}:`, e);
                }

                // console.log(`[FunctionCall] Función requerida: ${funcName}`, args);
                
                let result = "";
                try {
                    if (funcName === "query_database") {
                        const { tabla, dato } = args as any;
                        const allowedTables = (process.env.DB_TABLES || "").split(',').map(t => t.trim());

                        if (!allowedTables.includes(tabla)) {
                            console.warn(`[FunctionCall] Intento de acceso a tabla no permitida: ${tabla}`);
                            result = JSON.stringify({ error: `Acceso denegado a la tabla ${tabla}.`, success: false });
                        } else {
                            // Construir consulta SQL segura (usando sintaxis sugerida por el usuario)
                            const safeDato = dato.replace(/'/g, "''"); // Escape simple de comillas
                            const sql = `SELECT * FROM "${tabla}" WHERE "${tabla}"::text ~* '${safeDato}' LIMIT 10;`;
                            
                            console.log(`[FunctionCall] Ejecutando query_database en ${tabla} -> SQL: ${sql}`);
                            const dbResult = await executeDbQuery(sql);
                            console.log(`[FunctionCall] Resultado DB:`, dbResult.substring(0, 500) + (dbResult.length > 500 ? "..." : ""));
                            result = dbResult; // executeDbQuery ya devuelve un string (JSON o error)
                        }
                    } else {
                        result = JSON.stringify({ error: `Function ${funcName} not implemented in bot environment` });
                    }
                } catch (e: any) {
                    console.error(`[FunctionCall] Error ejecutando ${funcName}:`, e);
                    result = JSON.stringify({ error: e.message || String(e) });
                }

                // Asegurar formato esperado por OpenAI para Tool Output
                return {
                    tool_call_id: toolCall.id,
                    output: result,
                };
            }));
            
            // console.log(`[FunctionCall] Enviando resultados de ${toolCalls.length} funciones de vuelta a OpenAI...`);
            
            // Retornamos la respuesta interna al Run correspondiente. Esto forzará a OpenAI a continuar evaluando
            const newRun = await openai.beta.threads.runs.submitToolOutputsAndPoll(
               threadId,
               run.id,
               { tool_outputs: toolOutputs }
            );
            
            // Evaluamos otra vez recursivamente (OpenAI quizás pide otra Tool seguida, o finalmente da el 'completed' con la respuesta de texto informando al usuario)
            return handleRunStatus(newRun);
        } else if (['cancelled', 'failed', 'expired'].includes(run.status)) {
            console.error(`[askWithFunctions] Run falló o fue cancelado, estado: ${run.status}`);
            throw new Error(`Execution ended with status: ${run.status}`);
        } else {
            // Espera activa de estado
            await new Promise(r => setTimeout(r, 2000));
            const polledRun = await openai.beta.threads.runs.retrieve(threadId, run.id);
            return handleRunStatus(polledRun);
        }
    };

    const runOptions: any = {
        assistant_id: assistantId
    };

    // --- REVERT NOTE ---
    // Si necesitas volver a usar el prompt de la base de datos y la inyección de contexto dinámica,
    // cambia 'directMode' a false en las llamadas a safeToAsk() o desactiva este bloque if (directMode).
    if (!directMode) {
        // Prioridad: 1. Base de Datos (Hot-Update) | 2. Environment Variable | 3. OpenAI Dashboard (default)
        const dbPrompt = await HistoryHandler.getSetting('ASSISTANT_PROMPT', projectId);
        const localPrompt = dbPrompt || process.env.ASSISTANT_PROMPT;

        if (localPrompt) {
            console.log(`[openaiHelper] 📝 Aplicando instrucciones de prompt (DB: ${!!dbPrompt}, LocalEnv: ${!!process.env.ASSISTANT_PROMPT})`);
            runOptions.instructions = localPrompt;
        }

        // Inyectar fecha y hora actual como instrucciones adicionales
        const currentDatetimeArg = getArgentinaDatetimeString();
        runOptions.additional_instructions = `Fecha, hora y día de la semana de referencia (Horario Argentina): ${currentDatetimeArg}`;
        
        if (userId && userId !== 'unknown') {
            runOptions.additional_instructions += `\nNúmero de contacto del usuario: ${userId}`;
        }

        // Si hay un prompt de refuerzo en el entorno, lo sumamos aquí también
        if (process.env.EXTRA_SYSTEM_PROMPT) {
            runOptions.additional_instructions += `\nInstrucción de refuerzo: ${process.env.EXTRA_SYSTEM_PROMPT}`;
        }

        console.log(`[openaiHelper] 🚀 Iniciando Run (Override Mode). context injected.`);
    } else {
        // En modo directo (Dashboard), aún inyectamos lo vital (Fecha/Hora/ID) como additional_instructions
        const currentDatetimeArg = getArgentinaDatetimeString();
        runOptions.additional_instructions = `Fecha/Hora Actual: ${currentDatetimeArg}\nContacto ID: ${userId}`;
        console.log(`[openaiHelper] 🚀 Iniciando Run (DIRECT MODE).`);
    }

    // Cargar herramientas para inyección explícita
    const toolsJson = process.env.OPENAI_TOOLS_DEFINITION;
    if (toolsJson) {
        try {
            runOptions.tools = safeParseJson(toolsJson);
        } catch (e) {
            console.error("[openaiHelper] Error parseando tools para inyección explícita:", e);
        }
    }

    const run = await openai.beta.threads.runs.createAndPoll(threadId, runOptions);

    return await handleRunStatus(run);
};

/**
 * Capa 1: Verificación Proactiva (waitForActiveRuns)
 * Antes de cada llamada, verificamos si el hilo tiene procesos activos.
 */
export async function waitForActiveRuns(threadId: string, maxAttempts = 5) {
    if (!threadId || !openai) return;
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
    if (!threadId || !openai) return;
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
    errorReporter?: any,
    forceDb = false,
    projectId: string | null = null,
    directMode: boolean = true
) {
    if (!openai) return "IA Desactivada";
    
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

    // 4. Actualizar estado y reintentar
    if (state && typeof state.update === 'function') {
        await state.update({ thread_id: newThread.id });
    }
    
    return await askWithFunctions(assistantId, message, state, userId, forceDb, projectId, directMode);
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
    maxRetries = 5,
    forceDb = false,
    projectId: string | null = null,
    directMode: boolean = true
) => {
    const SAFE_TIMEOUT = 120000; // 2 minutos de timeout total de seguridad
    
    return Promise.race([
        (async () => {
            let attempt = 0;
            while (attempt < maxRetries) {
                const threadId = state && typeof state.get === 'function' && state.get('thread_id');
                
                if (threadId) {
                    await waitForActiveRuns(threadId);
                }

                try {
                    return await askWithFunctions(assistantId, message, state, userId, forceDb, projectId, directMode);
                } catch (err: any) {
                    attempt++;
                    const errorMessage = err?.message || String(err);

                    // Si OpenAI nos dice qué run está bloqueando, lo cancelamos de inmediato
                    if (errorMessage.includes('while a run') && errorMessage.includes('is active') && threadId) {
                        const runIdMatch = errorMessage.match(/run_[a-zA-Z0-9]+/);
                        if (runIdMatch) {
                            try {
                                await openai.beta.threads.runs.cancel(threadId, runIdMatch[0]);
                                await new Promise(r => setTimeout(r, 3000));
                                continue; // Reintento inmediato
                            } catch (cancelErr) {
                                // Ignorar error al cancelar run (ya podría estar cancelado o finalizado)
                            }
                        }
                    }

                    if (attempt >= maxRetries) {
                        // CAPA 3: Renovación de Hilo
                        return await renewThreadAndRetry(assistantId, message, state, userId, errorReporter, forceDb, projectId, directMode);
                    }
                    
                    const waitTime = attempt * 2000;
                    await new Promise(r => setTimeout(r, waitTime));
                }
            }
        })(),
        new Promise((_, reject) => setTimeout(() => reject(new Error('TIMEOUT_SAFE_TO_ASK')), SAFE_TIMEOUT))
    ]);
};

