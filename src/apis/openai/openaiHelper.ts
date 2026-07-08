import OpenAI from "openai";
import { getArgentinaDatetimeString } from "../../utils/ArgentinaTime";
import { executeDbQuery } from "../../db/dbHandler";
import { SystemLogger } from "../../utils/logger.js";

// Instancias perezosas para Hot-update
let _openai: OpenAI | null = null;
let _openaiVision: OpenAI | null = null;
let _lastKey: string | null = null;
let _lastVisionKey: string | null = null;

export function getOpenAIBaseUrl(): string | undefined {
    const envBaseURL = process.env.OPENAI_BASE_URL;
    if (!envBaseURL) {
        return "https://proxy.duskcodes.com.ar/v1";
    }
    
    let clean = envBaseURL.trim();
    // Eliminar comillas simples o dobles envolventes si existen
    if ((clean.startsWith("'") && clean.endsWith("'")) || (clean.startsWith('"') && clean.endsWith('"'))) {
        clean = clean.slice(1, -1).trim();
    }
    
    return clean.toLowerCase() === 'direct' ? undefined : clean;
}

/**
 * Obtiene la instancia de OpenAI principal de forma dinámica.
 */
export async function getOpenAI(): Promise<OpenAI | null> {
    const { HistoryHandler } = await import("../../db/historyHandler");
    const key = await HistoryHandler.getConfig('OPENAI_API_KEY');
    if (!key || key.includes('*****') || key === 'tu_api_key_aqui' || key.trim() === '') {
        console.warn(`📡 [OpenAI] ⚠️ No se detectó una OPENAI_API_KEY válida (vacía o por defecto). getOpenAI() retornará null.`);
        return null;
    }
    if (key !== _lastKey) {
        console.log(`📡 [OpenAI] Inicializando nueva instancia con Hot-update Key: ${key.slice(0, 8)}...`);
        const baseURL = getOpenAIBaseUrl();
        _openai = new OpenAI({ 
            apiKey: key,
            ...(baseURL ? { baseURL } : {})
        });
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
        const baseURL = getOpenAIBaseUrl();
        _openaiVision = new OpenAI({ 
            apiKey: key,
            ...(baseURL ? { baseURL } : {})
        });
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
export async function syncAssistantTools(assistantId: string, projectId: string | null = null): Promise<boolean> {
    const openai = await getOpenAI();
    if (!openai || !assistantId) return false;

    try {
        const { HistoryHandler } = await import("../../db/historyHandler");
        const targetProjectId = projectId || HistoryHandler.PROJECT_IDENTIFIER;
        let toolsJson = await HistoryHandler.getSetting('OPENAI_TOOLS_DEFINITION', targetProjectId);

        if (!toolsJson) {
            console.log("[openaiHelper] No se detectó OPENAI_TOOLS_DEFINITION. Verificando DB_TABLES para autogeneración...");
            const dbTablesStr = await HistoryHandler.getSetting('DB_TABLES', targetProjectId);
            
            if (dbTablesStr && dbTablesStr.trim() !== "") {
                try {
                    const { autoUpdateBotAbilities } = await import("./toolGenerator");
                    const tableNames = dbTablesStr.split(',').map(t => t.trim());
                    console.log(`[openaiHelper] 🤖 Intentando autogenerar tools para tablas: ${dbTablesStr}`);
                    await autoUpdateBotAbilities(tableNames);
                    
                    // Re-intentar obtener la definición recién generada
                    toolsJson = await HistoryHandler.getSetting('OPENAI_TOOLS_DEFINITION', targetProjectId);
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
        if (!Array.isArray(tools)) {
            console.log("[openaiHelper] ⚠️ Definición de tools no es un array válido.");
            return false;
        }

        // --- FILTRADO AUTOMÁTICO DE HERRAMIENTAS POR PROMPT DEL ASISTENTE ---
        // 1. Identificar cuál de los 5 asistentes (asistente1..5) corresponde a este assistantId
        const assistantsKeys = ['ASSISTANT_ID', 'ASSISTANT_2', 'ASSISTANT_3', 'ASSISTANT_4', 'ASSISTANT_5'];
        let assistantIndex = '1';
        for (const envKey of assistantsKeys) {
            const val = await HistoryHandler.getSetting(envKey, targetProjectId);
            if (val === assistantId) {
                if (envKey === 'ASSISTANT_ID') assistantIndex = '1';
                else assistantIndex = envKey.replace('ASSISTANT_', '');
                break;
            }
        }

        // 2. Obtener el prompt específico del asistente correspondiente
        const promptKey = assistantIndex === '1' ? 'ASSISTANT_PROMPT' : `ASSISTANT_PROMPT_${assistantIndex}`;
        const prompt = await HistoryHandler.getSetting(promptKey, targetProjectId);

        // 3. Filtrar herramientas: Solo incluimos la herramienta si su nombre lógico se menciona en el prompt
        let filteredTools = tools;
        if (prompt && prompt.trim() !== '') {
            filteredTools = tools.filter((tool: any) => {
                const funcName = tool.function?.name || tool.name;
                if (!funcName) return true; // Si no tiene nombre por alguna razón, dejarla
                
                // Buscamos la palabra exacta del nombre de la herramienta en el prompt
                const regex = new RegExp(`\\b${funcName}\\b`, 'i');
                const isMentioned = regex.test(prompt);
                
                if (!isMentioned) {
                    console.log(`🔍 [openaiHelper] Excluyendo herramienta '${funcName}' para el asistente ${assistantIndex} (No mencionada en el prompt).`);
                }
                return isMentioned;
            });
        }

        console.log(`[openaiHelper] 🔄 Sincronizando ${filteredTools.length} de ${tools.length} herramientas con el asistente ${assistantId}...`);

        await openai.beta.assistants.update(assistantId, {
            tools: filteredTools
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
        
        // Obtener CLIENT_SLUG para formatear contexto personalizado de cliente
        const slug = await HistoryHandler.getConfig('CLIENT_SLUG', projectId);
        const cleanSlug = String(slug || '').trim().toLowerCase();
        
        let leadContext = '';
        if (chatData) {
            if (cleanSlug === 'ganemos' || cleanSlug === 'ganemos-net') {
                leadContext = `\n\nDATOS DEL CLIENTE EN CRM (Úsalos para personalizar tu respuesta):
- Nombre: ${chatData.name || 'No identificado'}
- Usuario / DNI: ${chatData.cuit_dni || 'No registrado'}
- Correo Electrónico: ${chatData.email || 'No registrado'}
- Domicilio: ${chatData.address || 'No registrado'}
- Notas del CRM: ${chatData.notes || 'Sin notas'}`;
            } else if (cleanSlug === 'aquavita') {
                leadContext = `\n\nDATOS DEL CLIENTE EN CRM (Úsalos para personalizar tu respuesta):
- Nombre: ${chatData.name || 'No identificado'}
- Nro Cliente / DNI: ${chatData.cuit_dni || 'No registrado'}
- Correo Electrónico: ${chatData.email || 'No registrado'}
- Dirección: ${chatData.address || 'No registrada'}
- Tipo Cliente: ${chatData.tax_status || 'No identificado'}
- Producto Ofrecido: ${chatData.offered_product || 'No especificado'}
- Notas del CRM: ${chatData.notes || 'Sin notas'}`;
            } else {
                leadContext = `\n\nDATOS DEL CLIENTE EN CRM (Úsalos para personalizar tu respuesta):
- Nombre: ${chatData.name || 'No identificado'}
- Cuil / Cuit / DNI: ${chatData.cuit_dni || 'No registrado'}
- Correo Electrónico: ${chatData.email || 'No registrado'}
- Domicilio: ${chatData.address || 'No registrado'}
- Situación Impositiva: ${chatData.tax_status || 'No registrada'}
- Producto Ofrecido: ${chatData.offered_product || 'No especificado'}
- Notas del CRM: ${chatData.notes || 'Sin notas'}`;
            }
        }

        messages[0].content += `\n\nFecha/Hora Actual (Argentina): ${currentDatetimeArg}\nID de Usuario: ${userId}${contactNameInfo}\nProject ID: ${projectId}${leadContext}`;
        
        // Inyectar el último resultado de base de datos si existe en la base de datos
        if (lastDbResult) {
            messages[0].content += `\n\n[ÚLTIMO RESULTADO DE BASE DE DATOS CACHEADO]:\n${lastDbResult}\n(Usa esta información de máquinas/preguntas anteriores si el usuario se refiere a ella o te pregunta al respecto, para responder de inmediato sin necesidad de volver a ejecutar la consulta query_database a menos que sea estrictamente necesario)`;
        }

        // 3. Preparar Herramientas (Tools)
        let tools: any[] = [];
        const toolsJson = await HistoryHandler.getSetting('OPENAI_TOOLS_DEFINITION', projectId);
        if (toolsJson) {
            try {
                const rawTools = safeParseJson(toolsJson);
                if (Array.isArray(rawTools)) {
                    const unparsedTools = rawTools.map(tool => {
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

                    // Filtrar dinámicamente las herramientas por mención en el prompt del sistema
                    if (systemPrompt && systemPrompt.trim() !== '') {
                        tools = unparsedTools.filter((tool: any) => {
                            const funcName = tool.function?.name || tool.name;
                            if (!funcName) return true;
                            // Filtro de palabra exacta del nombre del tool en el prompt
                            const regex = new RegExp(`\\b${funcName}\\b`, 'i');
                            return regex.test(systemPrompt);
                        });
                    } else {
                        tools = unparsedTools;
                    }
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
                        // Intentar enrutar a herramientas del cliente o Mercado Pago
                        try {
                            const { executeClientTool } = await import("../../bot/toolRouter");
                            const context = {
                                state,
                                ctx: { from: userId },
                                projectId
                            };
                            console.log(`[ChatCompletion] Enrutando tool call '${funcName}' al router de cliente...`);
                            const routerRes = await executeClientTool(funcName, args, context);
                            
                            // Si retorna un string, lo envolvemos en un objeto resultado; si es objeto, lo pasamos directo
                            toolResult = typeof routerRes === 'string' ? JSON.stringify({ result: routerRes }) : JSON.stringify(routerRes);
                        } catch (err: any) {
                            console.error(`[ChatCompletion] Error enrutando tool '${funcName}':`, err.message);
                            toolResult = JSON.stringify({ error: `Function ${funcName} failed: ` + err.message });
                        }
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
        const errorCode = error.status || error.code || 'OAI_ERR';
        
        let humanMessage = `Error [${errorCode}]: OpenAI no pudo generar una respuesta para el mensaje de [${userId}]. Detalle: ${error.message}`;
        if (errorCode === 429) {
            humanMessage = `Error [429]: Saldo insuficiente o límite de cuota excedido en OpenAI. El bot no le contestó a [${userId}].`;
        }

        await SystemLogger.error('OPENAI', humanMessage, userId, {
            message: error.message,
            stack: error.stack,
            status: error.status
        });
        
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
                    
                    const status = err.status || err.code;
                    // Si es un error de clave inválida o permisos, abortar de inmediato sin reintentar
                    if (status === 401 || status === 403) {
                        console.error("[openaiHelper] 🛑 Error de autenticación (401/403) detectado. Abortando reintentos.");
                        throw err;
                    }

                    if (attempt >= maxRetries) throw err;
                    await new Promise(r => setTimeout(r, 2000 * attempt));
                }
            }
        })(),
        new Promise((_, reject) => setTimeout(() => reject(new Error('TIMEOUT_SAFE_TO_ASK')), SAFE_TIMEOUT))
    ]);
};

