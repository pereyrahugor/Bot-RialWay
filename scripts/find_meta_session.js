
import { createClient } from '@supabase/supabase-js';
import dotenv from 'dotenv';
dotenv.config();

const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_KEY);

async function findInSessions() {
    console.log("🔍 Buscando rastros de Meta en whatsapp_sessions...");
    const { data, error } = await supabase
        .from('whatsapp_sessions')
        .select('*')
        .ilike('key_id', '%meta%');

    if (error) {
        console.error("❌ Error en whatsapp_sessions:", error.message);
    } else {
        console.log("✅ Resultados encontrados:", JSON.stringify(data, null, 2));
    }
}

findInSessions();
