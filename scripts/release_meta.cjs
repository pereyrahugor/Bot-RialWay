
const axios = require('axios');

const WABA_ID = "1429916385161257";
const TOKEN = process.argv[2];

if (!TOKEN) {
    console.error("❌ Error: Falta el Token.");
    process.exit(1);
}

async function run() {
    console.log("🚀 Iniciando liberación de WABA " + WABA_ID + "...");
    
    try {
        // Paso 1: Desvincular App
        console.log("🔄 Paso 1: Desvinculando App de Meta...");
        const res1 = await axios.delete('https://graph.facebook.com/v20.0/' + WABA_ID + '/subscribed_apps', {
            headers: { 'Authorization': 'Bearer ' + TOKEN }
        });
        console.log("✅ App desvinculada:", JSON.stringify(res1.data));

        // Paso 2: Diagnóstico
        console.log("🔍 Paso 2: Verificando propietario actual...");
        const res2 = await axios.get('https://graph.facebook.com/v20.0/' + WABA_ID + '?fields=owner_business_info,name,status', {
            headers: { 'Authorization': 'Bearer ' + TOKEN }
        });
        
        console.log("\n📊 DIAGNÓSTICO FINAL:");
        console.log("- Nombre WABA:", res2.data.name);
        console.log("- Status WABA:", res2.data.status);
        if (res2.data.owner_business_info) {
            console.log("- Dueño Actual (ID):", res2.data.owner_business_info.id);
            console.log("- Dueño Actual (Nombre):", res2.data.owner_business_info.name);
        } else {
            console.log("- Dueño Actual: LIBRE O SIN ASIGNAR.");
        }

    } catch (e) {
        console.error("❌ ERROR EN META:");
        if (e.response && e.response.data) {
            console.error(JSON.stringify(e.response.data, null, 2));
        } else {
            console.error(e.message);
        }
    }
}

run();
