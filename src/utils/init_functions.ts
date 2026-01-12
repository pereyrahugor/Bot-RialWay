import { Client } from 'pg';
import fs from 'fs';
import path from 'path';
import dotenv from 'dotenv';
import { fileURLToPath } from 'url';

dotenv.config();

// Fix __dirname for ES modules if needed (though this file seems to be processed as CommonJS or TS)
// If you are using "type": "module" in package.json, you might need the following lines.
// If valid TS environment, __dirname usually works if config allows, but let's be safe or keep standard.
// The original used __dirname, so we keep it or adapt if it's ESM.
// Given the original file used `import`, but `__dirname` suggests CommonJS transpilation target or ts-node.
// We will stick to the standard imports but use DATABASE_URL.

const { DATABASE_URL } = process.env;

if (!DATABASE_URL) {
  console.error('❌ Error: DATABASE_URL no encontrada en .env');
  console.error('   Para que el script de inicialización funcione, necesitas la string de conexión directa a Hasura/Postgres.');
  console.error('   En Supabase: Settings -> Database -> Connection String -> URI');
  // En producción (Railway), asegúrate de tener la variable DATABASE_URL configurada.
  process.exit(1);
}

const client = new Client({
  connectionString: DATABASE_URL,
  ssl: { rejectUnauthorized: false }, // Necesario para Supabase (esto ignora errores de certificado self-signed)
});

async function functionExists(functionName: string) {
  try {
    const res = await client.query(
      `SELECT proname FROM pg_proc WHERE proname = $1`,
      [functionName]
    );
    return res.rows.length > 0;
  } catch (err) {
    console.warn(`⚠️ Error al verificar función ${functionName}:`, err);
    return false;
  }
}

async function runSqlFromFile(filePath: string, functionName: string) {
  console.log(`🔍 Verificando existencia de función: ${functionName}...`);
  if (await functionExists(functionName)) {
    console.log(`✅ La función ${functionName} ya existe. Saltando creación.`);
    return;
  }

  try {
    console.log(`📝 Leyendo script SQL desde: ${filePath}`);
    const sql = fs.readFileSync(filePath, 'utf8');

    console.log(`🚀 Ejecutando SQL para crear ${functionName}...`);
    await client.query(sql);
    console.log(`✅ Función ${functionName} (y tablas relacionadas) creadas exitosamente.`);
  } catch (error) {
    console.error(`❌ Error ejecutando SQL de ${filePath}:`, error);
    throw error;
  }
}

async function main() {
  try {
    console.log('🔌 Conectando a Base de Datos para inicialización...');
    await client.connect();
    console.log('✅ Conectado.');

    const sqlFilePath = path.join(__dirname, '../../scripts/create_session_table.sql');

    // Ejecutamos la verificación para las funciones principales
    // El script tiene "CREATE OR REPLACE", por lo que correrlo no daña nada,
    // pero verificamos para no hacer queries redundantes en cada inicio.
    await runSqlFromFile(sqlFilePath, 'get_whatsapp_session');

    // Verificamos exec_sql también por si acaso
    await runSqlFromFile(sqlFilePath, 'exec_sql');

  } catch (err) {
    console.error('❌ Error crítico en script de inicialización:', err);
    // No hacemos exit(1) aquí para no tumbar la app entera si falla la DB momentáneamente,
    // pero dependerá de qué tan crítico sea para ti.
  } finally {
    await client.end();
    console.log('🔌 Conexión cerrada (Init Script).');
  }
}

main();