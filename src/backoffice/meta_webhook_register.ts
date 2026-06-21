import { createClient } from "@supabase/supabase-js";
import axios from "axios";
import { vault } from "../db/vault";

// Inicializar cliente de Supabase
const supabaseUrl = process.env.SUPABASE_URL || vault.supabaseUrl;
const supabaseKey = process.env.SUPABASE_KEY || vault.supabaseKey;
const supabase = createClient(supabaseUrl, supabaseKey);

// Capturar argumentos de la línea de comandos
const args = process.argv.slice(2);
const projectId = args[0];

if (!projectId || projectId.startsWith("-")) {
    console.error("\n❌ Error: Falta el ID de Proyecto.");
    console.log("\n📖 Uso correcto:");
    console.log("  npx tsx src/backoffice/meta_webhook_register.ts <project_id>");
    console.log("Ejemplo:");
    console.log("  npx tsx src/backoffice/meta_webhook_register.ts 5678d0d0-7256-496e-ac1c-d0dd2c41db07\n");
    process.exit(1);
}

async function main() {
    console.log(`\n📡 [REGISTRO] Buscando credenciales de Meta para el Proyecto: ${projectId}...\n`);

    try {
        // 1. Obtener onboarding de Supabase
        const { data: onboarding, error: onboardErr } = await supabase
            .from("meta_onboarding")
            .select("*")
            .eq("project_id", projectId)
            .maybeSingle();

        if (onboardErr) throw onboardErr;

        if (!onboarding) {
            console.error(`❌ Error: No se encontraron credenciales en 'meta_onboarding' para el proyecto: ${projectId}.`);
            console.log("Por favor, asegúrate de que el proyecto haya completado la fase de onboarding en el Backoffice.\n");
            return;
        }

        const { waba_id: wabaId, phone_number_id: phoneId, access_token: token } = onboarding;

        if (!wabaId || !phoneId) {
            console.error("❌ Error: Faltan identificadores críticos (WABA ID o Phone ID) en el registro de onboarding.");
            return;
        }

        console.log(`✅ Credenciales encontradas:`);
        console.log(`   • WABA ID   : ${wabaId}`);
        console.log(`   • Phone ID  : ${phoneId}`);
        console.log(`   • Token     : ${token ? "Cargado (Oculto)" : "Faltante"}\n`);

        if (!token || token === "PENDING") {
            console.error("❌ Error: El token de acceso está en estado PENDING o vacío. No se puede interactuar con Meta.");
            return;
        }

        // 2. Determinar la URL del bot para el ruteo de webhooks
        let projectUrl = "https://bot-rialway-monoagente-production-1287.up.railway.app"; // Fallback por defecto
        
        console.log("📡 Consultando la base de datos para obtener la URL pública de este proyecto...");
        const { data: settingUrl } = await supabase
            .from("settings")
            .select("value")
            .eq("project_id", projectId)
            .eq("key", "PROJECT_URL")
            .maybeSingle();

        if (settingUrl?.value && settingUrl.value !== "PENDING") {
            projectUrl = settingUrl.value;
            console.log(`   👉 PROJECT_URL detectado: ${projectUrl}`);
        } else {
            const { data: domainUrl } = await supabase
                .from("settings")
                .select("value")
                .eq("project_id", projectId)
                .eq("key", "RAILWAY_PUBLIC_DOMAIN")
                .maybeSingle();

            if (domainUrl?.value && domainUrl.value !== "PENDING") {
                const domain = domainUrl.value;
                projectUrl = domain.startsWith("http") ? domain : `https://${domain}`;
                console.log(`   👉 RAILWAY_PUBLIC_DOMAIN detectado: ${projectUrl}`);
            } else {
                console.log(`   ⚠️ Sin URL en settings. Usando URL fallback: ${projectUrl}`);
            }
        }

        // Limpiar slash final para mantener consistencia
        if (projectUrl.endsWith("/")) {
            projectUrl = projectUrl.slice(0, -1);
        }

        // 3. Sincronizar la routing_table para el enrutador central de webhooks
        console.log(`\n📡 [MIGRACIÓN] Sincronizando enrutador 'routing_table'...`);
        const { error: routeErr } = await supabase
            .from("routing_table")
            .upsert({
                phone_number_id: phoneId,
                waba_id: wabaId,
                project_id: projectId,
                project_url: projectUrl,
                updated_at: new Date().toISOString()
            }, { onConflict: "phone_number_id" });

        if (routeErr) throw routeErr;
        console.log("✅ Enrutador de routing_table actualizado con éxito.");

        // 4. Registrar la suscripción a la WABA en la API de Meta Graph
        console.log(`\n📡 [META] Suscribiendo la aplicación a los webhooks de la WABA ${wabaId} en Meta...`);
        const response = await axios.post(`https://graph.facebook.com/v22.0/${wabaId}/subscribed_apps`, 
            {}, 
            { 
                headers: { 'Authorization': `Bearer ${token}` },
                params: { subscribed_fields: 'messages,smb_message_echoes' }
            }
        );

        if (response.data && response.data.success) {
            console.log("✅ Conexión de webhook confirmada de forma exitosa.");
            console.log("\n🎉 ¡EL PROCESO FINALIZÓ CON ÉXITO! El número está listo para recibir y procesar mensajes.\n");
        } else {
            console.warn("⚠️ Meta respondió con éxito, pero la estructura de respuesta es inusual:", response.data);
        }

    } catch (err: any) {
        console.error("\n❌ Error crítico durante el registro del webhook:");
        if (err.response?.data) {
            console.error(JSON.stringify(err.response.data, null, 2));
        } else {
            console.error(err.message || err);
        }
        console.log("");
    }
}

main().catch(console.error);
