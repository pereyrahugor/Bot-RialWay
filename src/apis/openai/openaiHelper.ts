import OpenAI from "openai";
import { getArgentinaDatetimeString } from "../../utils/ArgentinaTime";
import { executeDbQuery } from "../../db/dbHandler";

// Instancias perezosas para Hot-update
let _openai: OpenAI | null = null;
let _openaiVision: OpenAI | null = null;
let _lastKey: string | null = null;
let _lastVisionKey: string | null = null;

/**
 * Obtiene la instancia de OpenAI principal de forma dinámica.
 */
export async function getOpenAI(): Promise<OpenAI | null> {
    const { HistoryHandler } = await import("../../db/historyHandler");
    const key = await HistoryHandler.getConfig('OPENAI_API_KEY');
    if (!key) {
        console.warn(`📡 [OpenAI] ⚠️ No se pudo obtener OPENAI_API_KEY del config. getOpenAI() retornará null.`);
        return null;
    }
    if (key !== _lastKey) {
        console.log(`📡 [OpenAI] Inicializando nueva instancia con Hot-update Key: ${key.slice(0, 8)}...`);
        _openai = new OpenAI({ apiKey: key });
        _lastKey = key;
    }
    return _openai;
}

/**
 * Obtiene la instancia de OpenAI para visión/imágenes de forma dinámica.
 */
export async function getOpenAIVision(): Promise<OpenAI | null> {
    const { HistoryHandler } = await import("../../db/historyHandler");
    const key = await HistoryHandler.getConfig('OPENAI_API_KEY_IMG');
    
    if (!key) return await getOpenAI(); // Fallback al principal
    if (key !== _lastVisionKey) {
        _openaiVision = new OpenAI({ apiKey: key });
        _lastVisionKey = key;
    }
    return _openaiVision;
}

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
    const openai = await getOpenAI();
    if (!openai || !assistantId) return false;

    try {
        const { HistoryHandler } = await import("../../db/historyHandler");
        let toolsJson = await HistoryHandler.getConfig('OPENAI_TOOLS_DEFINITION');

        if (!toolsJson) {
            console.log("[openaiHelper] No se detectó OPENAI_TOOLS_DEFINITION. Verificando DB_TABLES para autogeneración...");
            const dbTablesStr = await HistoryHandler.getConfig('DB_TABLES');
            
            if (dbTablesStr && dbTablesStr.trim() !== "") {
                try {
                    const { autoUpdateBotAbilities } = await import("./toolGenerator");
                    const tableNames = dbTablesStr.split(',').map(t => t.trim());
                    console.log(`[openaiHelper] 🤖 Intentando autogenerar tools para tablas: ${dbTablesStr}`);
                    await autoUpdateBotAbilities(tableNames);
                    
                    // Re-intentar obtener la definición recién generada
                    toolsJson = await HistoryHandler.getConfig('OPENAI_TOOLS_DEFINITION');
                } catch (genError: any) {
                    console.error("[openaiHelper] ❌ Error en autogeneración de tools:", genError.message);
                }
            }

            if (!toolsJson) {
                console.log("[openaiHelper] ⚠️ Sincronización de tools omitida: No hay definición ni tablas para generar.");
                return false;
            }
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

export const askWithFunctions = async (assistantId: string, message: string, state: any, userId: string = 'unknown', forceDb: boolean = false, projectId: string | null = null, directMode: boolean = true, agentName?: string): Promise<string> => {
    const openai = await getOpenAI();
    if (!openai) {
        console.warn("⚠️ OPENAI_API_KEY no detectada. El asistente de IA está desactivado.");
        return "";
    }

    try {
        const { HistoryHandler } = await import("../../db/historyHandler");
        
        // 1. Cargar Historial (Contexto)
        // Si el mensaje es una petición de resumen, traemos mucho más contexto (50 mensajes)
        const isSummaryRequest = /GET_RESUMEN/i.test(message);
        const historyLimit = isSummaryRequest ? 50 : 15;
        const history = await HistoryHandler.getMessages(userId, historyLimit, 0, projectId);
        console.log(`[openaiHelper] 📜 Historial recuperado para ${userId}: ${history.length} mensajes (Limit: ${historyLimit}) | Project: ${projectId}`);
        
        // Cargar datos del chat para obtener el último resultado de BD
        const chatData = await HistoryHandler.getChat(userId, projectId ?? undefined);
        const lastDbResult = chatData?.last_db_result;
        
        // 2. Preparar el prompt del sistema
        // Intentar obtener un prompt específico para este asistente usando su nombre lógico (asistente1, asistente2...)
        let promptKey = 'ASSISTANT_PROMPT';
        if (agentName && agentName !== 'asistente1') {
            const num = agentName.replace('asistente', '');
            promptKey = `ASSISTANT_PROMPT_${num}`;
        }

        let systemPrompt = await HistoryHandler.getSetting(promptKey, projectId);
        
        // Fallback: si no hay por nombre lógico, intentar por Assistant ID (legacy)
        if (!systemPrompt) {
            systemPrompt = await HistoryHandler.getSetting(`ASSISTANT_PROMPT_${assistantId}`, projectId);
        }

        // Segundo Fallback: usar el genérico 'ASSISTANT_PROMPT'
        if (!systemPrompt) {
            const dbPrompt = await HistoryHandler.getSetting('ASSISTANT_PROMPT', projectId);
            systemPrompt = dbPrompt || await HistoryHandler.getConfig('ASSISTANT_PROMPT') || "Eres un asistente servicial.";
        }
        
        // Filtrar mensajes válidos y formatear para OpenAI
        const formattedHistory = history
            .filter(m => m.role === 'user' || m.role === 'assistant')
            .filter(m => m.content && m.content.trim() !== "")
            .map(m => ({
                role: m.role as "user" | "assistant",
                content: m.content
            }));

        // 2.2 Evitar duplicar el mensaje actual si ya se guardó en el historial (común en este sistema)
        const lastMsg = formattedHistory.length > 0 ? formattedHistory[formattedHistory.length - 1] : null;
        const isAlreadyInHistory = lastMsg && lastMsg.role === 'user' && lastMsg.content.trim() === message.trim();

        const messages: any[] = [
            { role: "system", content: systemPrompt },
            ...formattedHistory
        ];

        // 2.5 Refuerzo para Resúmenes: Si es un resumen, inyectar una instrucción clara ANTES del comando
        if (isSummaryRequest) {
            console.log(`[openaiHelper] 📋 Solicitud de Resumen detectada. Historial disponible: ${formattedHistory.length} mensajes.`);
            messages.push({ 
                role: "system", 
                content: `INSTRUCCIÓN CRÍTICA DE RESUMEN:
                - Se te ha pasado un historial de ${formattedHistory.length} mensajes arriba.
                - Tu tarea ÚNICA es generar un resumen estructurado basado en esos mensajes.
                - Si el historial es corto, resume lo que hay (ej: 'Interacción inicial, solo saludos').
                - NUNCA respondas con frases de error como 'No tengo suficiente información' o similares.
                - Sigue la ESTRUCTURA definida en tu prompt (ej: 'Tipo: ...', 'Nombre: ...').
                - Si el prompt pide JSON, responde JSON. Si pide texto plano, responde texto plano.
                - Responde únicamente con la información solicitada en el bloque GET_RESUMEN.` 
            });
        }

        // Agregar el mensaje actual del usuario solo si NO está ya en el historial
        if (!isAlreadyInHistory) {
            messages.push({ role: "user", content: message });
        }

        // Inyectar fecha y hora actual en el system prompt o como mensaje adicional
        const currentDatetimeArg = getArgentinaDatetimeString();
        const contactNameInfo = chatData?.name ? `\nNombre de Contacto: ${chatData.name}` : '';
        messages[0].content += `\n\nFecha/Hora Actual (Argentina): ${currentDatetimeArg}\nID de Usuario: ${userId}${contactNameInfo}\nProject ID: ${projectId}`;
        
        // Inyectar el último resultado de base de datos si existe en la base de datos
        if (lastDbResult) {
            messages[0].content += `\n\n[ÚLTIMO RESULTADO DE BASE DE DATOS CACHEADO]:\n${lastDbResult}\n(Usa esta información de máquinas/preguntas anteriores si el usuario se refiere a ella o te pregunta al respecto, para responder de inmediato sin necesidad de volver a ejecutar la consulta query_database a menos que sea estrictamente necesario)`;
        }

        // 3. Preparar Herramientas (Tools)
        let tools: any[] = [];
        const toolsJson = await HistoryHandler.getConfig('OPENAI_TOOLS_DEFINITION');
        if (toolsJson) {

            try {
                const rawTools = safeParseJson(toolsJson);
                if (Array.isArray(rawTools)) {
                    tools = rawTools.map(tool => {
                        let processed = tool;
                        // 1. Envolver si falta el nivel superior
                        if (!processed.type && (processed.name || processed.parameters || processed.description)) {
                            processed = { type: "function", function: processed };
                        }
                        
                        // 2. Corregir esquema de parámetros si es inválido
                        if (processed.function && processed.function.parameters) {
                            if (!processed.function.parameters.type || processed.function.parameters.type === 'None') {
                                processed.function.parameters.type = 'object';
                            }
                            if (!processed.function.parameters.required) {
                                processed.function.parameters.required = ['tabla', 'dato'];
                            }
                        }
                        return processed;
                    });
                }

            } catch (e) {
                console.error("[openaiHelper] Error parseando o reparando tools:", e);
            }
        }


        // 4. Bucle de ejecución para Chat Completions con Function Calling
        let responseContent = "";
        let continueLoop = true;
        let attempts = 0;

        while (continueLoop && attempts < 10) {
            attempts++;
            const openaiModel = await HistoryHandler.getConfig('OPENAI_MODEL') || "gpt-4o-mini";
            const completion = await openai.chat.completions.create({
                model: openaiModel,
                messages: messages,
                tools: tools.length > 0 ? tools : undefined,
                tool_choice: tools.length > 0 ? "auto" : undefined,
            });

            const responseMessage = completion.choices[0].message;

            if (responseMessage.tool_calls && responseMessage.tool_calls.length > 0) {
                // Agregar la petición de la herramienta al historial del chat
                messages.push(responseMessage);

                // Procesar cada llamada a herramienta
                for (const toolCall of responseMessage.tool_calls) {
                    const funcName = toolCall.function.name;
                    const args = JSON.parse(toolCall.function.arguments || "{}");
                    
                    console.log(`[ChatCompletion] Tool Call: ${funcName}`, args);
                    
                    let toolResult = "";
                    if (funcName === "query_database") {
                        const { tabla, dato } = args as any;
                        const dbTablesStr = await HistoryHandler.getConfig('DB_TABLES') || "";
                        const allowedTables = dbTablesStr.split(',').map(t => t.trim());

                        if (!allowedTables.includes(tabla)) {
                            toolResult = JSON.stringify({ error: `Acceso denegado a la tabla ${tabla}.`, success: false });
                        } else {
                            const safeDato = dato.replace(/'/g, "''");
                            const sql = `SELECT * FROM "${tabla}" WHERE "${tabla}"::text ~* '${safeDato}' LIMIT 25;`;
                            toolResult = await executeDbQuery(sql);
                            
                            // Persistir el resultado para que esté disponible en futuros turnos del contexto
                            await HistoryHandler.updateLastDbResult(userId, toolResult, projectId ?? undefined);
                        }
                    } else {
                        toolResult = JSON.stringify({ error: `Function ${funcName} not implemented.` });
                    }

                    // Agregar el resultado de la herramienta al historial
                    messages.push({
                        tool_call_id: toolCall.id,
                        role: "tool",
                        name: funcName,
                        content: toolResult,
                    });
                }
                // El bucle continuará para que OpenAI procese los resultados de las herramientas
            } else {
                responseContent = responseMessage.content || "";
                continueLoop = false;
            }
        }

        return responseContent;

    } catch (error: any) {
        console.error("[openaiHelper] ❌ Error en Chat Completions:", error.message);
        throw error;
    }
};


/**
 * Petición Segura con Reintentos (safeToAsk)
 * Centraliza la lógica de comunicación con OpenAI Chat Completions.
 */
export const safeToAsk = async (
    assistantId: string,
    message: string,
    state: any,
    userId: string = 'unknown',
    errorReporter?: any,
    maxRetries = 3,
    forceDb = false,
    projectId: string | null = null,
    directMode: boolean = true,
    agentName?: string
) => {
    const SAFE_TIMEOUT = 120000;
    
    return Promise.race([
        (async () => {
            let attempt = 0;
            while (attempt < maxRetries) {
                try {
                    return await askWithFunctions(assistantId, message, state, userId, forceDb, projectId, directMode, agentName);
                } catch (err: any) {
                    attempt++;
                    console.error(`[openaiHelper] Intento ${attempt} fallido:`, err.message);
                    if (attempt >= maxRetries) throw err;
                    await new Promise(r => setTimeout(r, 2000 * attempt));
                }
            }
        })(),
        new Promise((_, reject) => setTimeout(() => reject(new Error('TIMEOUT_SAFE_TO_ASK')), SAFE_TIMEOUT))
    ]);
};

