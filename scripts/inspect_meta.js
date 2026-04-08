
import { createClient } from '@supabase/supabase-js';
import dotenv from 'dotenv';
dotenv.config();

const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_KEY);

async function inspectTables() {
    console.log("🕵️ Misión de Reconocimiento iniciada...");

    // 1. Ver qué hay en whatsapp_onboarding (si existe)
    console.log("\n--- Inspeccionando meta_onboarding ---");
    const { data: metaData, error: metaError } = await supabase.from('meta_onboarding').select('*');
    if (metaError) console.error("❌ Error en meta_onboarding:", metaError.message);
    else console.log("✅ Contenido de meta_onboarding:", JSON.stringify(metaData, null, 2));

    // 2. Ver qué hay en settings (a veces los tokens se guardan como settings)
    console.log("\n--- Inspeccionando settings (Meta-related) ---");
    const { data: settingsData, error: settingsError } = await supabase
        .from('settings')
        .select('*')
        .ilike('key', '%META%');
    if (settingsError) console.error("❌ Error en settings:", settingsError.message);
    else console.log("✅ Contenido de settings:", JSON.stringify(settingsData, null, 2));
}

inspectTables();
