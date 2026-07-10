import "dotenv/config";
import { createClient } from "@supabase/supabase-js";

const supabaseUrl = process.env.SUPABASE_URL || "";
const supabaseKey = process.env.SUPABASE_KEY || "";

const supabase = createClient(supabaseUrl, supabaseKey);
const uuid = "9af203f5-805b-4277-a6bb-7c595c9d3d15";

async function run() {
  console.log(`📡 Buscando proyecto_id = ${uuid}...`);

  // 1. Contar chats de este proyecto
  const { count: chatCount, error: chatError } = await supabase
    .from("chats")
    .select("*", { count: "exact", head: true })
    .eq("project_id", uuid);

  if (chatError) {
    console.error("❌ Error contando chats:", chatError.message);
  } else {
    console.log(`📊 Chats en este proyecto: ${chatCount}`);
  }

  // 2. Contar mensajes de este proyecto
  const { count: msgCount, error: msgError } = await supabase
    .from("messages")
    .select("*", { count: "exact", head: true })
    .eq("project_id", uuid);

  if (msgError) {
    console.error("❌ Error contando mensajes:", msgError.message);
  } else {
    console.log(`📊 Mensajes en este proyecto: ${msgCount}`);
  }

  // 3. Si hay chats, listar los últimos 5
  if (chatCount && chatCount > 0) {
    const { data: chats } = await supabase
      .from("chats")
      .select("*")
      .eq("project_id", uuid)
      .limit(5);
    console.log("🟢 ÚLTIMOS CHATS:");
    console.log(JSON.stringify(chats, null, 2));
  }

  // 4. Si hay mensajes, listar los últimos 10 de tipo media o audio para ver si se están guardando
  if (msgCount && msgCount > 0) {
    const { data: messages } = await supabase
      .from("messages")
      .select("created_at, chat_id, role, content, type")
      .eq("project_id", uuid)
      .order("created_at", { ascending: false })
      .limit(10);
    console.log("🟢 ÚLTIMOS MENSAJES:");
    console.log(JSON.stringify(messages, null, 2));
  }
}

run().catch(console.error);
