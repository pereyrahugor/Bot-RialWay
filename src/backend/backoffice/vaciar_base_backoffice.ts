import { createClient } from "@supabase/supabase-js";
import readline from "readline";
import { vault } from "../db/vault";

// Inicializar cliente de Supabase
const supabaseUrl = process.env.SUPABASE_URL || vault.supabaseUrl;
const supabaseKey = process.env.SUPABASE_KEY || vault.supabaseKey;
const supabase = createClient(supabaseUrl, supabaseKey);

// Capturar argumentos de la línea de comandos
const args = process.argv.slice(2);
const projectId = args[0];
const force = args.includes("--force") || args.includes("-f");

if (!projectId || projectId.startsWith("-")) {
    console.error("\n❌ Error: Falta el ID de Proyecto.");
    console.log("\n📖 Uso correcto:");
    console.log("  npx tsx src/backend/backoffice/vaciar_base_backoffice.ts <project_id> [--force]");
    console.log("Ejemplo:");
    console.log("  npx tsx src/backend/backoffice/vaciar_base_backoffice.ts 5fcdadff-e9c4-4bdd-b1f0-39b932db796f\n");
    process.exit(1);
}

const rl = readline.createInterface({
    input: process.stdin,
    output: process.stdout
});

async function main() {
    console.log(`\n🔍 [AUDITORÍA] Analizando datos en la base de datos para el Proyecto ID: ${projectId}...\n`);

    try {
        // 1. Realizar conteo de auditoría
        const [
            { count: chatTagsCount },
            { count: messagesCount },
            { count: ticketsCount },
            { count: chatsCount },
            { count: tagsCount }
        ] = await Promise.all([
            supabase.from("chat_tags").select("*", { count: "exact", head: true }).eq("project_id", projectId),
            supabase.from("messages").select("*", { count: "exact", head: true }).eq("project_id", projectId),
            supabase.from("tickets").select("*", { count: "exact", head: true }).eq("project_id", projectId),
            supabase.from("chats").select("*", { count: "exact", head: true }).eq("project_id", projectId),
            supabase.from("tags").select("*", { count: "exact", head: true }).eq("project_id", projectId)
        ]);

        const totalRows = (chatTagsCount || 0) + (messagesCount || 0) + (ticketsCount || 0) + (chatsCount || 0) + (tagsCount || 0);

        console.log("📊 Resumen de filas encontradas para este proyecto:");
        console.log(`  • chat_tags : ${chatTagsCount || 0} filas`);
        console.log(`  • messages  : ${messagesCount || 0} filas`);
        console.log(`  • tickets   : ${ticketsCount || 0} filas`);
        console.log(`  • chats     : ${chatsCount || 0} filas`);
        console.log(`  • tags      : ${tagsCount || 0} filas`);
        console.log(`-----------------------------------------`);
        console.log(`  💥 TOTAL DE FILAS A ELIMINAR: ${totalRows}\n`);

        if (totalRows === 0) {
            console.log("✅ No se encontraron registros de chats, tags ni dependencias para este ID de proyecto. Nada que limpiar.");
            rl.close();
            return;
        }

        // 2. Proceder con confirmación o force
        if (force) {
            await executeCleanup();
            rl.close();
        } else {
            rl.question(`⚠️  ¿Estás seguro de que deseas purgar permanentemente estos registros de la base de datos? (S/N): `, async (answer) => {
                const cleanAnswer = answer.trim().toLowerCase();
                if (cleanAnswer === "s" || cleanAnswer === "si" || cleanAnswer === "yes" || cleanAnswer === "y") {
                    await executeCleanup();
                } else {
                    console.log("\n❌ Operación cancelada por el usuario.\n");
                }
                rl.close();
            });
        }

    } catch (err: any) {
        console.error("❌ Error durante la auditoría de base de datos:", err.message || err);
        rl.close();
    }
}

async function executeCleanup() {
    console.log(`\n🚀 [LIMPIEZA] Iniciando eliminación secuencial segura para project_id: ${projectId}...`);
    try {
        // 1. Eliminar chat_tags
        console.log("🧹 1/5 Limpiando chat_tags...");
        const { error: errChatTags } = await supabase.from("chat_tags").delete().eq("project_id", projectId);
        if (errChatTags) throw errChatTags;

        // 2. Eliminar messages
        console.log("🧹 2/5 Limpiando messages...");
        const { error: errMessages } = await supabase.from("messages").delete().eq("project_id", projectId);
        if (errMessages) throw errMessages;

        // 3. Eliminar tickets
        console.log("🧹 3/5 Limpiando tickets...");
        const { error: errTickets } = await supabase.from("tickets").delete().eq("project_id", projectId);
        if (errTickets) throw errTickets;

        // 4. Eliminar chats
        console.log("🧹 4/5 Limpiando chats...");
        const { error: errChats } = await supabase.from("chats").delete().eq("project_id", projectId);
        if (errChats) throw errChats;

        // 5. Eliminar tags
        console.log("🧹 5/5 Limpiando tags...");
        const { error: errTags } = await supabase.from("tags").delete().eq("project_id", projectId);
        if (errTags) throw errTags;

        console.log(`\n🎉 ¡COMPLETADO! Todos los registros del proyecto ${projectId} fueron eliminados exitosamente.\n`);
    } catch (err: any) {
        console.error(`\n❌ Error crítico durante la eliminación de registros:`, err.message || err);
        process.exit(1);
    }
}

main().catch((err) => {
    console.error(err);
    rl.close();
});
