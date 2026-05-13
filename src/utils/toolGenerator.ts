import OpenAI from "openai";
import { createClient } from "@supabase/supabase-js";
import { HistoryHandler } from "./historyHandler";
import { syncAssistantTools } from "./openaiHelper";

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
        const supabaseUrl = process.env.SUPABASE_URL;
        const supabaseKey = process.env.SUPABASE_KEY;
        
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

**Reglas críticas:**
1. El nombre de la función DEBE ser 'query_database'.
2. Debe tener exactamente dos parámetros: 'tabla' (string) y 'dato' (string).
3. En la descripción del parámetro 'tabla', enumera las tablas disponibles: ${tableNames.join(', ')}.
4. En la descripción del parámetro 'dato', explica qué tipo de información se puede buscar (nombres, categorías, etc.) basándote en los nombres de las columnas proporcionadas.
5. Responde ÚNICAMENTE con el objeto JSON dentro de un array [], sin texto adicional ni bloques de código markdown.`;

        const response = await openai.chat.completions.create({
            model: "gpt-4o-mini",
            messages: [{ role: "system", content: prompt }],
            temperature: 0,
        });

        let toolsJson = response.choices[0].message?.content || "";
        
        // Limpiar posible markdown si la IA no obedeció el "únicamente JSON"
        toolsJson = toolsJson.replace(/```json/g, "").replace(/```/g, "").trim();

        if (toolsJson) {
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
