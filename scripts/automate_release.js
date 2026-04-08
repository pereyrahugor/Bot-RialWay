
import { createClient } from '@supabase/supabase-js';
import axios from 'axios';
import dotenv from 'dotenv';
dotenv.config();

const WABA_ID = "1429916385161257";
const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_KEY);

async function runProcess() {
    try {
        console.log("🔍 [1/3] Buscando token de Meta en Supabase...");
        const { data, error } = await supabase
            .from('meta_onboarding')
            .select('access_token')
            .limit(1)
            .single();

        if (error || !data?.access_token) {
            throw new Error("No se pudo recuperar el token de la base de datos.");
        }

        const TOKEN = data.access_token;
        console.log("✅ [2/3] Token obtenido. Iniciando liberación forzada...");

        // Paso A: Desvincular App
        const resA = await axios.delete(`https://graph.facebook.com/v20.0/${WABA_ID}/subscribed_apps`, {
            headers: { 'Authorization': `Bearer ${TOKEN}` }
        });
        console.log("✅ App desvinculada:", resA.data);

        // Paso B: Diagnóstico
        const resB = await axios.get(`https://graph.facebook.com/v20.0/${WABA_ID}?fields=owner_business_info,name,status`, {
            headers: { 'Authorization': `Bearer ${TOKEN}` }
        });
        
        console.log("\n📊 [3/3] Diagnóstico de Titularidad:");
        console.log(`- Nombre: ${resB.data.name}`);
        console.log(`- Status: ${resB.data.status}`);
        if (resB.data.owner_business_info) {
            console.log(`- Dueño Legal (ID): ${resB.data.owner_business_info.id}`);
            console.log(`- Dueño Legal (Nombre): ${resB.data.owner_business_info.name}`);
        } else {
            console.log("- Dueño Legal: Sin asignar o libre para reclamar.");
        }

    } catch (e) {
        console.error("❌ Error en la automatización:");
        console.error(e.response?.data || e.message);
    }
}

runProcess();
