
import { createClient } from '@supabase/supabase-js';
import dotenv from 'dotenv';
dotenv.config();

const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_KEY);

async function getToken() {
    console.log("🔍 Buscando token de Meta en Supabase...");
    const { data, error } = await supabase
        .from('meta_onboarding')
        .select('access_token')
        .limit(1)
        .single();

    if (error) {
        console.error("❌ Error recuperando el token:", error.message);
        return null;
    }
    return data.access_token;
}

const token = await getToken();
if (token) {
    console.log("✅ Token encontrado. Iniciando liberación...");
    process.stdout.write(token); // Para que lo capture el siguiente paso
} else {
    process.exit(1);
}
