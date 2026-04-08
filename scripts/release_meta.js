
import axios from 'axios';

const WABA_ID = "1429916385161257";
const TOKEN = process.argv[2]; // Pásalo por parámetro: node release_meta.js TU_TOKEN

if (!TOKEN) {
    console.error("❌ Error: Necesitas pasar el Access Token como parámetro.");
    process.exit(1);
}

async function releaseWaba() {
    console.log(`📡 Iniciando proceso de liberación para WABA: ${WABA_ID}...`);

    try {
        // 1. Desvincular App (Quitar Webhooks y suscripciones)
        console.log("🔄 Paso 1: Desvinculando App de Meta...");
        const res1 = await axios.delete(`https://graph.facebook.com/v20.0/${WABA_ID}/subscribed_apps`, {
            headers: { 'Authorization': `Bearer ${TOKEN}` }
        });
        console.log("✅ App desvinculada:", res1.data);

        // 2. Comprobar quién es el dueño actual
        console.log("🔍 Paso 2: Verificando propietario actual...");
        const res2 = await axios.get(`https://graph.facebook.com/v20.0/${WABA_ID}?fields=owner_business_info,name`, {
            headers: { 'Authorization': `Bearer ${TOKEN}` }
        });
        console.log("📊 Datos de la WABA:", JSON.stringify(res2.data, null, 2));

        console.log("\n🚀 ¡Si el Paso 1 fue exitoso, ahora intenta mover la cuenta desde el Business Manager de Meta!");
        console.log("Si el 'owner_business_info' sigue siendo Marketing, debes eliminarla desde su portafolio manualmente.");

    } catch (e) {
        console.error("❌ Error en el proceso:");
        console.error(e.response?.data || e.message);
    }
}

releaseWaba();
