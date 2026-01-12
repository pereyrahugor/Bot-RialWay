import { Client } from 'pg';
import fs from 'fs';
import path from 'path';
import dotenv from 'dotenv';

dotenv.config();

const { SUPABASE_URL, SUPABASE_KEY } = process.env;

if (!SUPABASE_URL || !SUPABASE_KEY) {
  console.error('❌ Faltan credenciales de Supabase en .env');
  process.exit(1);
}

// Extraer datos de conexión de la URL de Supabase
function parseSupabaseUrl(url: string) {
  const match = url.match(/^https:\/\/(.+)\.(.+)\.supabase\.co/);
  if (!match) throw new Error('URL de Supabase inválida');
  return {
    host: `${match[1]}.${match[2]}.supabase.co`,
    database: 'postgres',
    port: 5432,
    user: 'postgres',
    password: SUPABASE_KEY,
  };
}

const config = parseSupabaseUrl(SUPABASE_URL);

const client = new Client({
  host: config.host,
  database: config.database,
  port: config.port,
  user: config.user,
  password: config.password,
  ssl: { rejectUnauthorized: false },
});

async function functionExists(functionName: string) {
  const res = await client.query(
    `SELECT proname FROM pg_proc WHERE proname = $1 AND pg_function_is_visible(oid)`,
    [functionName]
  );
  return res.rows.length > 0;
}

async function runSqlFromFile(filePath: string, functionName: string) {
  if (await functionExists(functionName)) {
    console.log(`✅ La función ${functionName} ya existe.`);
    return;
  }
  const sql = fs.readFileSync(filePath, 'utf8');
  await client.query(sql);
  console.log(`🚀 Función ${functionName} creada.`);
}

async function main() {
  try {
    await client.connect();
    // Ajusta los paths y nombres según tus scripts
    await runSqlFromFile(path.join(__dirname, 'create_session_table.sql'), 'get_whatsapp_session');
    await runSqlFromFile(path.join(__dirname, 'create_session_table.sql'), 'exec_sql');
    // Agrega más funciones si lo necesitas
  } catch (err) {
    console.error('❌ Error:', err);
  } finally {
    await client.end();
  }
}

main();
