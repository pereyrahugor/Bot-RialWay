import OpenAI from "openai";
import { createClient } from "@supabase/supabase-js";
import { HistoryHandler } from "../../db/historyHandler";
import { syncAssistantTools } from "./openaiHelper";
import { vault } from "../../db/vault";

/**
 * Genera automáticamente la definición de herramientas (Tools) y actualiza la configuración del bot
 * basándose en las tablas disponibles en la base de datos.
 */
export async function autoUpdateBotAbilities(tableNames: string[]) {
    console.log("🤖 [ToolGenerator] Iniciando actualización automática de habilidades...");

    if (!tableNames || tableNames.length === 0) {
        console.warn("⚠️ [ToolGenerator] No se proporcionaron nombres de tablas. Saltando.");
        return;
    }

    try {
        const supabaseUrl = process.env.SUPABASE_URL || vault.supabaseUrl;
        const supabaseKey = process.env.SUPABASE_KEY || vault.supabaseKey;
        
        // Intentar obtener la clave específica para el generador, fallback a la principal
        const openaiKey = await HistoryHandler.getConfig('OPENAI_API_KEY_TOOLS') || await HistoryHandler.getConfig('OPENAI_API_KEY');

        if (!supabaseUrl || !supabaseKey || !openaiKey) {
            console.error("❌ [ToolGenerator] Faltan credenciales (Supabase u OpenAI).");
            return;
        }

        const supabase = createClient(supabaseUrl, supabaseKey);
        const openai = new OpenAI({ apiKey: openaiKey });

        // 1. Actualizar DB_TABLES en la configuración
        const dbTablesStr = tableNames.join(',');
        await HistoryHandler.saveSetting('DB_TABLES', dbTablesStr);
        console.log(`✅ [ToolGenerator] DB_TABLES actualizada: ${dbTablesStr}`);

        // 2. Obtener esquema de las tablas (columnas)
        const tablesSchema: any[] = [];
        for (const table of tableNames) {
            // Intentamos obtener una fila de ejemplo para ver las columnas
            const { data, error } = await supabase.from(table).select('*').limit(1);
            if (!error && data && data.length >= 0) {
                // Si la tabla está vacía, data será [], pero podemos intentar sacar columnas de otra forma si es necesario.
                // Sin embargo, en este sistema, las tablas se acaban de llenar.
                const columns = data.length > 0 ? Object.keys(data[0]) : [];
                tablesSchema.push({ table, columns });
            }
        }

        if (tablesSchema.length === 0) {
            console.warn("⚠️ [ToolGenerator] No se pudo obtener el esquema de ninguna tabla.");
            return;
        }

        // 3. Generar el JSON de Tools con GPT-4o-mini
        const prompt = `Eres un experto en configuración de OpenAI Tools. Tu tarea es generar un JSON de definición de herramienta para la función 'query_database'.
Esta función se usa para consultar una base de datos Postgres.

Aquí están las tablas disponibles y sus columnas:
${JSON.stringify(tablesSchema, null, 2)}

**Reglas críticas de formato (OpenAI Specification):**
1. El resultado DEBE ser un array conteniendo un objeto con esta estructura EXACTA:
[
  {
    "type": "function",
    "function": {
      "name": "query_database",
      "description": "Breve descripción de qué datos hay en las tablas...",
      "parameters": {
        "type": "object",
        "properties": {
          "tabla": { "type": "string", "description": "Nombre de la tabla: ${tableNames.join(', ')}" },
          "dato": { "type": "string", "description": "Valor a buscar..." }
        },
        "required": ["tabla", "dato"]
      }
    }
  }
]
2. Responde ÚNICAMENTE con el array JSON, sin texto adicional ni bloques de código markdown.`;



        const response = await openai.chat.completions.create({
            model: "gpt-4o-mini",
            messages: [{ role: "system", content: prompt }],
            temperature: 0,
        });

        let toolsJson = response.choices[0].message?.content || "";
        
        // Limpiar posible markdown si la IA no obedeció el "únicamente JSON"
        toolsJson = toolsJson.replace(/```json/g, "").replace(/```/g, "").trim();

        if (toolsJson) {
            // Validación estructural: Asegurar que cada tool tenga el wrapper 'type' y 'function'
            try {
                const tools = JSON.parse(toolsJson);

                if (Array.isArray(tools)) {
                    const processedTools = tools.map(tool => {
                        // 1. Asegurar wrapper 'type' y 'function'
                        let processed = tool;
                        if (!processed.type && (processed.name || processed.parameters)) {
                            processed = { type: 'function', function: processed };
                        }

                        // 2. Asegurar que 'parameters' tenga 'type: object'
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
                    toolsJson = JSON.stringify(processedTools);
                }


            } catch (e: any) {
                console.error("⚠️ [ToolGenerator] Error validando estructura JSON:", e.message);
            }

            // 4. Guardar en la base de datos
            await HistoryHandler.saveSetting('OPENAI_TOOLS_DEFINITION', toolsJson);
            console.log("✅ [ToolGenerator] OPENAI_TOOLS_DEFINITION actualizada exitosamente.");


            // 5. Sincronizar con el Asistente
            const assistantId = await HistoryHandler.getConfig('ASSISTANT_ID');
            if (assistantId) {
                await syncAssistantTools(assistantId);
                console.log("📡 [ToolGenerator] Herramientas sincronizadas con el Asistente de OpenAI.");
            }
        }

    } catch (error: any) {
        console.error("❌ [ToolGenerator] Error durante la generación automática:", error.message);
    }
}
