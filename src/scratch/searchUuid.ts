import "dotenv/config";
import { createClient } from "@supabase/supabase-js";

const supabaseUrl = process.env.SUPABASE_URL || "";
const supabaseKey = process.env.SUPABASE_KEY || "";

if (!supabaseUrl || !supabaseKey) {
  console.error("❌ Faltan credenciales de Supabase en el entorno.");
  process.exit(1);
}

const supabase = createClient(supabaseUrl, supabaseKey);
const uuid = "9af203f5-805b-4277-a6bb-7c595c9d3d15";

async function run() {
  console.log(`📡 Buscando UUID ${uuid} en base de datos...`);

  // 1. Buscar en Chats
  const { data: chatData, error: chatError } = await supabase
    .from("chats")
    .select("*")
    .eq("id", uuid);

  if (chatError) {
    console.error("❌ Error consultando chats:", chatError.message);
  } else if (chatData && chatData.length > 0) {
    console.log("🟢 COINCIDENCIA EN CHATS:");
    console.log(JSON.stringify(chatData, null, 2));
  } else {
    console.log("ℹ️ No se encontró coincidencia en la tabla chats.");
  }

  // 2. Buscar en Mensajes (ID o External ID)
  const { data: msgData, error: msgError } = await supabase
    .from("messages")
    .select("*")
    .or(`id.eq.${uuid},external_id.eq.${uuid}`);

  if (msgError) {
    console.error("❌ Error consultando mensajes:", msgError.message);
  } else if (msgData && msgData.length > 0) {
    console.log("🟢 COINCIDENCIA EN MENSAJES:");
    console.log(JSON.stringify(msgData, null, 2));
    
    // Obtener los últimos 15 mensajes del mismo chat para ver el contexto
    const chatId = msgData[0].chat_id;
    console.log(`\n📡 Recuperando últimos 15 mensajes para el chat ${chatId} de contexto...`);
    const { data: contextData } = await supabase
      .from("messages")
      .select("created_at, role, content, type")
      .eq("chat_id", chatId)
      .order("created_at", { ascending: true })
      .limit(15);
      
    console.log(JSON.stringify(contextData, null, 2));
  } else {
    console.log("ℹ️ No se encontró coincidencia directa en la tabla mensajes.");
    
    // 3. Buscar mensajes por chat_id = uuid si por casualidad el uuid era un número de teléfono/id
    const { data: chatMsgs } = await supabase
      .from("messages")
      .select("created_at, role, content, type")
      .eq("chat_id", uuid)
      .order("created_at", { ascending: true })
      .limit(15);
      
    if (chatMsgs && chatMsgs.length > 0) {
      console.log(`🟢 COINCIDENCIA DE MENSAJES PERTENECIENTES AL CHAT_ID ${uuid}:`);
      console.log(JSON.stringify(chatMsgs, null, 2));
    }
  }
}

run().catch(console.error);
