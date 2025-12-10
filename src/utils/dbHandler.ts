import { createClient } from "@supabase/supabase-js";
import dotenv from "dotenv";

dotenv.config();

const supabaseUrl = process.env.SUPABASE_URL;
const supabaseKey = process.env.SUPABASE_KEY;

if (!supabaseUrl || !supabaseKey) {
    console.warn("⚠️ Supabase credentials missing during dbHandler init.");
}

const supabase = (supabaseUrl && supabaseKey) ? createClient(supabaseUrl, supabaseKey) : null;

export async function executeDbQuery(sqlQuery: string): Promise<string> {
    if (!supabase) return "Error: Base de datos no configurada.";

    console.log(`📡 Ejecutando Query SQL: ${sqlQuery}`);

    try {
        const { data, error } = await supabase.rpc('exec_sql_read', { query: sqlQuery });
        console.log("🐛 [dbHandler] RPC Response Raw Data:", JSON.stringify(data));
        console.log("🐛 [dbHandler] RPC Response Error:", error);

        if (error) {
            console.error("❌ Error en RPC exec_sql:", error);
            return `Error en la consulta: ${error.message}`;
        }

        if (!data || !Array.isArray(data) || data.length === 0) {
            return "No se encontraron resultados.";
        }

        // Ordenar por created_at descendente (más reciente primero) y limitar a 10
        const sortedData = data.sort((a: any, b: any) => {
            const dateA = new Date(a.created_at || 0).getTime();
            const dateB = new Date(b.created_at || 0).getTime();
            return dateB - dateA;
        }).slice(0, 10);

        return JSON.stringify(sortedData, null, 2);

    } catch (err) {
        console.error("❌ Excepción en executeDbQuery:", err);
        return `Error procesando la consulta: ${err.message}`;
    }
}
