import fs from "fs";
import { google } from "googleapis";
import path from "path";
import dotenv from "dotenv";
import OpenAI from "openai";
import * as glob from "glob";
import { createClient } from "@supabase/supabase-js";

import { vault } from "../utils/vault";
import { autoUpdateBotAbilities } from "../utils/toolGenerator";

dotenv.config();

const supabaseUrl = process.env.SUPABASE_URL || vault.supabaseUrl;
const supabaseKey = process.env.SUPABASE_KEY || vault.supabaseKey;
const supabase = (supabaseUrl && supabaseKey) ? createClient(supabaseUrl, supabaseKey) : null;

// Permitir múltiples IDs separados por coma y espacios
const SHEET_IDS = (process.env.SHEET_ID_UPDATE || "")
    .split(",")
    .map(id => id.trim())
    .filter(Boolean);
const VECTOR_STORE_ID = process.env.VECTOR_STORE_ID || "";
let currentFileId: string | null = null;

import { createGoogleAuth } from "../utils/googleAuth";

// Construir credenciales usando la utilidad centralizada
const auth = createGoogleAuth(["https://www.googleapis.com/auth/spreadsheets"]);

const sheets = google.sheets({ version: "v4", auth });
const openai = process.env.OPENAI_API_KEY ? new OpenAI() : null;

// Función principal para procesar todos los sheets
export async function updateAllSheets(options: { forceRecreate?: boolean } = {}) {
    const tableNames: string[] = [];
    for (const SHEET_ID of SHEET_IDS) {
        const tableName = await processSheetById(SHEET_ID, options);
        if (tableName) {
            tableNames.push(tableName);
        }
    }

    // Al finalizar, actualizar automáticamente las habilidades del bot
    if (tableNames.length > 0) {
        await autoUpdateBotAbilities(tableNames);
    }
}

// Helper function to sanitize valid table name
const sanitizeTableName = (name: string) => {
    return name.toLowerCase().replace(/[^a-z0-9_]/g, '_').replace(/^_+|_+$/g, '');
};

// Helper function to sanitize column names
const sanitizeColumnName = (name: string) => {
    const sanitized = name.toLowerCase().replace(/[^a-z0-9_]/g, '_').replace(/^_+|_+$/g, '');
    if (sanitized === 'id') return 'id_';
    if (sanitized === 'created_at') return 'created_at_';
    return sanitized;
};

async function ensureTableExists(tableName: string, headers: string[]) {
    if (!supabase) return;
    
    // Check if table exists by selecting 1 row
    const check = await supabase.from(tableName).select('*').limit(1);
    
    if (check.error && (check.error.code === '42P01' || check.error.code === 'PGRST205')) { // undefined_table or cache miss (table likely missing)
        console.log(`⚠️ La tabla '${tableName}' no existe. Intentando crearla via RPC...`);
        
        // Construct Create Table SQL
        const columnsSql = headers.map(h => `${sanitizeColumnName(h)} TEXT`).join(', ');
        const createSql = `CREATE TABLE IF NOT EXISTS ${tableName} (id uuid DEFAULT gen_random_uuid() PRIMARY KEY, ${columnsSql}, created_at TIMESTAMPTZ DEFAULT NOW());`;
        
        const rpc = await supabase.rpc('exec_sql', { query: createSql });
        if (rpc.error) {
            console.error(`❌ Error al intentar crear la tabla '${tableName}'. Asegúrate de tener una función RPC 'exec_sql' en Supabase.`);
            console.error("RPC Error Details:", JSON.stringify(rpc.error, null, 2));
            console.error("Query intentada:", createSql);
            return false;
        }
        console.log(`✅ Tabla '${tableName}' creada exitosamente.`);
        
        // Esperar a que el caché del esquema se actualice (PostgREST puede tardar unos segundos)
        console.log(`⏳ Esperando a que Supabase refresque el caché del esquema para '${tableName}'...`);
        for (let i = 0; i < 10; i++) {
            await new Promise(r => setTimeout(r, 2000));
            const recheck = await supabase.from(tableName).select('*').limit(1);
            if (!recheck.error) {
                console.log(`✅ Tabla '${tableName}' verificada y visible para la API.`);
                return true;
            }
        }
        console.warn(`⚠️ La tabla '${tableName}' fue creada pero la API aún no la reconoce. La inserción podría fallar.`);
        return true;
    } else if (check.error) {
        console.error("Error verificando tabla:", check.error);
        return false;
    }
    return true; // Table exists
}

// Procesa un sheet por ID, obtiene el nombre real y ejecuta la lógica
async function processSheetById(SHEET_ID: string, options: { forceRecreate?: boolean } = {}) {
    try {
        // Obtener metadatos para el nombre real de la hoja principal
        const meta = await sheets.spreadsheets.get({ spreadsheetId: SHEET_ID });
        const sheetTitle = meta.data.sheets?.[0]?.properties?.title || "Sheet1";
        const SHEET_NAME = sheetTitle;
        const tableName = sanitizeTableName(SHEET_NAME);
        const TXT_PATH = path.join("temp", `${SHEET_NAME}.json`);

        console.log(`📌 Obteniendo datos de Google Sheets: ${SHEET_ID} (${SHEET_NAME})`);

        // Paso 1: Obtener un rango grande para detectar la última fila y columna con datos
        const initialRange = `${SHEET_NAME}!A1:ZZ10000`;
        const response = await sheets.spreadsheets.values.get({
            spreadsheetId: SHEET_ID,
            range: initialRange,
        });

        const rows = response.data.values;
        if (!rows || rows.length === 0) {
            console.warn("⚠️ No se encontraron datos en la hoja de cálculo.");
            return null;
        }

        // Calcular última fila y columna con datos reales
        let lastRow = rows.length;
        let lastCol = 0;
        for (let i = 0; i < rows.length; i++) {
            const row = rows[i];
            if (!row || row.every(cell => (cell === undefined || cell === null || String(cell).trim() === ""))) {
                lastRow = i;
                break;
            }
            if (row.length > lastCol) lastCol = row.length;
        }
        if (lastCol === 0) lastCol = 1;

        // Convertir número de columna a letra
        const colToLetter = (col: number) => {
            let temp = "";
            let n = col;
            while (n > 0) {
                const rem = (n - 1) % 26;
                temp = String.fromCharCode(65 + rem) + temp;
                n = Math.floor((n - 1) / 26);
            }
            return temp;
        };
        const lastColLetter = colToLetter(lastCol);
        const dynamicRange = `${SHEET_NAME}!A1:${lastColLetter}${lastRow}`;

        // Volver a pedir los datos usando el rango exacto
        const fullResponse = await sheets.spreadsheets.values.get({
            spreadsheetId: SHEET_ID,
            range: dynamicRange,
        });
        const fullRows = fullResponse.data.values;
        if (!fullRows || fullRows.length === 0) {
            console.warn("⚠️ No se encontraron datos en el rango calculado.");
            return null;
        }
        // Validar headers
        const headers = fullRows[0].map((h: string) => (h || "").trim());
        const validHeaders = headers.filter(h => h.length > 0);
        if (validHeaders.length === 0) {
            console.warn("⚠️ La primera fila no contiene encabezados válidos.");
            return null;
        }

        // Formatear los datos obtenidos de forma flexible, convirtiendo valores numéricos
        const formattedData = fullRows.slice(1)
            .filter(row => row && row.length > 0 && row.some(cell => (cell || "").trim() !== ""))
            .map((row) => {
                const obj: Record<string, any> = {};
                headers.forEach((header, idx) => {
                    // Obtener valor crudo. Google Sheets ya devuelve números como números si el formato de celda es automático.
                    let cellValue = row[idx];
                    
                    if (cellValue === undefined || cellValue === null) {
                        cellValue = "";
                    }

                    // Si es string, solo hacemos trim.
                    if (typeof cellValue === "string") {
                         obj[header] = cellValue.trim();
                    } else {
                         // Si es número u otro tipo, lo guardamos tal cual
                         obj[header] = cellValue;
                    }
                });
                return obj;
            });

        // Verificar que la carpeta "temp" exista
        const dirPath = path.join("temp");
        if (!fs.existsSync(dirPath)) {
            fs.mkdirSync(dirPath, { recursive: true });
        }

        // Guardar los datos en un archivo de texto en formato JSON simple
        const jsonData = JSON.stringify(formattedData, null, 2);
        fs.writeFileSync(TXT_PATH, jsonData, "utf8");
        console.log(`📂 Datos guardados en archivo de texto: ${TXT_PATH}`);

        // --- SUPABASE INTEGRATION START ---
        if (supabase) {
            const headersSanitized = headers.map(h => sanitizeColumnName(h));
            
            if (options.forceRecreate) {
                console.log(`⚠️ Forzando recreación de tabla '${tableName}' (DROP TABLE)...`);
                const dropRes = await supabase.rpc('exec_sql', { query: `DROP TABLE IF EXISTS ${tableName}` });
                if (dropRes.error) {
                    console.error(`❌ Error al eliminar tabla '${tableName}':`, dropRes.error);
                } else {
                    console.log(`✅ Tabla '${tableName}' eliminada para recreación.`);
                }
            }

            // Ensure table exists
            const tableReady = await ensureTableExists(tableName, headersSanitized);
            
            if (tableReady) {
                // Map data to sanitized keys
                const supabaseData = formattedData.map(row => {
                    const newRow: any = {};
                    Object.keys(row).forEach(key => {
                        newRow[sanitizeColumnName(key)] = row[key];
                    });
                    return newRow;
                });
                
                // Limpieza previa: Truncar para reemplazo total
                const truncateRes = await supabase.rpc('exec_sql', { query: `TRUNCATE TABLE ${tableName}` });
                
                if (truncateRes.error) {
                     // Fallback a DELETE estándar si RPC falla (o no existe)
                     // console.warn(`[Supabase] Script exec_sql falló, usando DELETE ALL convencional...`);
                     const { error: delErr } = await supabase.from(tableName).delete().not('id', 'is', null);
                     if (delErr) console.error(`[Supabase] Error limpiando tabla:`, delErr.message);
                } else {
                     console.log(`[Supabase] 🧹 Tabla '${tableName}' truncada correctamente.`);
                }

                // Insertar nuevos datos (Insert es más rápido que Upsert en tabla vacía)
                const { error } = await supabase.from(tableName).insert(supabaseData);
                if (error) {
                    console.error(`❌ Error uploading to Supabase table '${tableName}':`, error.message);
                } else {
                    console.log(`✅ Datos cargados exitosamente en Supabase tabla '${tableName}'.`);
                }
            }
        } else {
             console.warn("⚠️ No se encontraron credenciales de Supabase (SUPABASE_URL, SUPABASE_KEY). Saltando integración.");
        }
        // --- SUPABASE INTEGRATION END ---

        // Enviar el archivo de texto al vector store
        const success = await uploadDataToAssistant(TXT_PATH, SHEET_ID);
        if (!success) {
            console.error("❌ Error al enviar los datos al vector store.");
        }

        return tableName;
    } catch (error) {
        console.error("❌ Error al obtener datos:", error.message);
        return null;
    }
}

// Función para subir datos al vector store de OpenAI
export async function uploadDataToAssistant(filePath: string, stateId: string) {
    if (!openai) {
        console.warn("⚠️ IA Desactivada: Saltando subida al vector store.");
        return true; // Continuar aunque no haya IA configurada
    }
    try {
        if (currentFileId && stateId === currentFileId) {
            console.log("📂 Utilizando archivo existente con ID:", currentFileId);
            return true;
        }
        await deleteOldFiles(filePath);
        console.log("🚀 Subiendo archivo al vector store...");
        const fileStream = fs.createReadStream(filePath);
        const response = await openai.files.create({
            file: fileStream,
            purpose: "assistants"
        });
        currentFileId = response.id;
        console.log(`📂 Archivo subido con ID: ${currentFileId}`);
        const success = await attachFileToVectorStore(currentFileId);
        if (!success) {
            return false;
        }
        deleteTemporaryFiles(filePath);
        console.log("✅ Datos actualizados en el vector store.");
        await new Promise(resolve => setTimeout(resolve, 2000));
        return true;
    } catch (error) {
        console.error("❌ Error al subir el archivo al vector store:", error.message);
        return false;
    }
}

async function attachFileToVectorStore(fileId: string) {
    if (!openai) return true;
    try {
        if (!VECTOR_STORE_ID || VECTOR_STORE_ID === "vs_" || VECTOR_STORE_ID.trim() === "") {
            console.warn("⚠️ Salteando adjuntar archivo: VECTOR_STORE_ID no definido o inválido.");
            return true;
        }

        console.log(`📡 Adjuntando archivo al vector store: ${fileId}`);
        const response = await openai.vectorStores.fileBatches.createAndPoll(VECTOR_STORE_ID, {
            file_ids: [fileId]
        });
        if (response && response.status === "completed") {
            console.log("✅ Confirmación recibida: Archivo adjuntado correctamente al vector store.");
            return true;
        } else {
            console.warn("⚠️ No se recibió una confirmación clara de OpenAI.");
            return false;
        }
    } catch (error) {
        console.error("❌ Error al adjuntar el archivo al vector store:", error.message);
        return false;
    }
}

async function deleteOldFiles(filePath: string) {
    if (!openai) return;
    try {
        const fileName = path.basename(filePath);
        console.log(`🗑️ Eliminando archivo anterior del vector store relacionado con ${fileName}...`);
        const files = await openai.files.list();
        for (const file of files.data) {
            if (file.filename === fileName) {
                await openai.files.del(file.id);
                console.log(`🗑️ Archivo eliminado: ${file.id}`);
            }
        }
    } catch (error) {
        console.error("❌ Error al eliminar archivo anterior del vector store:", error.message);
    }
}

function deleteTemporaryFiles(filePath: string) {
    try {
        const fileName = path.basename(filePath);
        console.log("🗑️ Eliminando archivos temporales...");
        const files = glob.sync(path.join("temp", fileName));
        for (const file of files) {
            fs.unlinkSync(file);
            console.log(`🗑️ Archivo temporal eliminado: ${file}`);
        }
    } catch (error) {
        console.error("❌ Error al eliminar archivos temporales:", error.message);
    }
}
