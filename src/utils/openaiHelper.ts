import OpenAI from "openai";
// Borramos importación estática circular: import { HistoryHandler } from "./historyHandler";
import { getArgentinaDatetimeString } from "./ArgentinaTime";
import { executeDbQuery } from "./dbHandler";

export const openai = process.env.OPENAI_API_KEY ? new OpenAI({ apiKey: process.env.OPENAI_API_KEY }) : null;

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

    try {
        const { HistoryHandler } = await import("./historyHandler");
        
        // 1. Cargar Historial (Contexto)
        const history = await HistoryHandler.getMessages(userId, 15, 0, projectId); // Traemos un poco más de contexto
        
        // 2. Preparar el prompt del sistema
        const dbPrompt = await HistoryHandler.getSetting('ASSISTANT_PROMPT', projectId);
        const systemPrompt = dbPrompt || process.env.ASSISTANT_PROMPT || "Eres un asistente servicial.";
        
        const messages: any[] = [
            { role: "system", content: systemPrompt },
            ...history
                .filter(m => m.role === 'user' || m.role === 'assistant')
                .filter(m => m.content && m.content.trim() !== "")
                .map(m => ({
                    role: m.role as "user" | "assistant",
                    content: m.content
                })),
            { role: "user", content: message }
        ];

        // Inyectar fecha y hora actual en el system prompt o como mensaje adicional
        const currentDatetimeArg = getArgentinaDatetimeString();
        messages[0].content += `\n\nFecha/Hora Actual (Argentina): ${currentDatetimeArg}\nID de Usuario: ${userId}`;

        // 3. Preparar Herramientas (Tools)
        let tools: any[] = [];
        const toolsJson = process.env.OPENAI_TOOLS_DEFINITION;
        if (toolsJson) {
            try {
                tools = safeParseJson(toolsJson);
            } catch (e) {
                console.error("[openaiHelper] Error parseando tools:", e);
            }
        }

        // 4. Bucle de ejecución para Chat Completions con Function Calling
        let responseContent = "";
        let continueLoop = true;
        let attempts = 0;

        while (continueLoop && attempts < 10) {
            attempts++;
            const completion = await openai.chat.completions.create({
                model: process.env.OPENAI_MODEL || "gpt-4o",
                messages: messages,
                tools: tools.length > 0 ? tools : undefined,
                tool_choice: "auto",
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
                        const allowedTables = (process.env.DB_TABLES || "").split(',').map(t => t.trim());

                        if (!allowedTables.includes(tabla)) {
                            toolResult = JSON.stringify({ error: `Acceso denegado a la tabla ${tabla}.`, success: false });
                        } else {
                            const safeDato = dato.replace(/'/g, "''");
                            const sql = `SELECT * FROM "${tabla}" WHERE "${tabla}"::text ~* '${safeDato}' LIMIT 10;`;
                            toolResult = await executeDbQuery(sql);
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
    directMode: boolean = true
) => {
    const SAFE_TIMEOUT = 120000;
    
    return Promise.race([
        (async () => {
            let attempt = 0;
            while (attempt < maxRetries) {
                try {
                    return await askWithFunctions(assistantId, message, state, userId, forceDb, projectId, directMode);
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

