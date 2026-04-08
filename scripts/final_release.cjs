
const axios = require('axios');

const WABA_ID = "1429916385161257";
const BUSINESS_ID = "2176681862420155";
const TOKEN = "EAAVOfFTMb0YBRMce70WOoTF6ezfJ7ZCa4sf35FMlRVki4EhoimvlNWjhjbxJHPXN9cZC5NIvQZCJmmq66X57GQplmGcLPdAZCF1LRc3BnxZBpR4b6PsxbVCDFHfXPZCM8svryz1eBuiabUZAeuZCmhC2KTC4FoQVPoaVYcZADJNybApkiPsp1kBIYxTqc4LV0NrW6PgZDZD";

async function finalRelease() {
    console.log("🛠️ Inciando Misión de Liberación Final con Token de HUGO (WABA " + WABA_ID + ")...");

    try {
        // 1. Ver qué números hay vinculados
        console.log("🔍 [1/3] Listando números de teléfono registrados...");
        const resPhones = await axios.get('https://graph.facebook.com/v20.0/' + WABA_ID + '/phone_numbers', {
            headers: { 'Authorization': 'Bearer ' + TOKEN }
        });

        const phones = resPhones.data.data || [];
        console.log("✅ Se encontraron " + phones.length + " números.");

        // 2. Desregistrar números
        for (const phone of phones) {
            console.log("🔄 Desvinculando número: " + phone.display_phone_number + " (ID: " + phone.id + ")...");
            try {
                await axios.post('https://graph.facebook.com/v20.0/' + phone.id + '/deregister', {}, {
                    headers: { 'Authorization': 'Bearer ' + TOKEN }
                });
                console.log("✅ Número desregistrado.");
            } catch (e) {
                console.warn("⚠️ Ya desregistrado o error menor:", e.response?.data?.error?.message || e.message);
            }
        }

        // 3. BORRAR LA WABA DEL BUSINESS MANAGER
        console.log("🔥 [2/3] Intentando borrar la WABA del Business Manager de Marketing...");
        const resDel = await axios.delete('https://graph.facebook.com/v20.0/' + BUSINESS_ID + '/whatsapp_business_accounts', {
            params: { id: WABA_ID },
            headers: { 'Authorization': 'Bearer ' + TOKEN }
        });
        console.log("✅ WABA BORRADA DEL BM:", JSON.stringify(resDel.data));

        console.log("\n🎉 [3/3] ¡PROCESO FINALIZADO CON ÉXITO! La WABA debería haber desaparecido.");

    } catch (e) {
        console.error("❌ ERROR CRÍTICO EN LA LIBERACIÓN:");
        if (e.response && e.response.data) {
            console.error(JSON.stringify(e.response.data, null, 2));
        } else {
            console.error(e.message);
        }
    }
}

finalRelease();
