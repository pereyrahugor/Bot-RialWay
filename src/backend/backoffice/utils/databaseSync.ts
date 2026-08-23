import { google } from "googleapis";
import { createGoogleAuth } from "../../apis/google/googleAuth.js";
import { HistoryHandler } from "../../db/historyHandler.js";
import { updateAllSheets } from "../../apis/google/updateSheet.js";
import fs from "fs";
import path from "path";

const getSheetsClient = () => {
    const auth = createGoogleAuth(["https://www.googleapis.com/auth/spreadsheets"]);
    return google.sheets({ version: "v4", auth });
};

const getDriveClient = () => {
    const auth = createGoogleAuth([
        "https://www.googleapis.com/auth/drive",
        "https://www.googleapis.com/auth/documents"
    ]);
    return google.drive({ version: "v3", auth });
};

const getDocsClient = () => {
    const auth = createGoogleAuth([
        "https://www.googleapis.com/auth/documents"
    ]);
    return google.docs({ version: "v1", auth });
};

// Sanitiza nombre de tabla de forma idéntica a updateSheet.ts
const sanitizeTableName = (name: string) => {
    return name.toLowerCase().replace(/[^a-z0-9_]/g, '_').replace(/^_+|_+$/g, '');
};

// Sanitiza nombre de columna
const sanitizeColumnName = (name: string) => {
    const sanitized = name.toLowerCase().replace(/[^a-z0-9_]/g, '_').replace(/^_+|_+$/g, '');
    let finalName = sanitized;
    if (finalName === 'id') finalName = 'id_';
    else if (finalName === 'created_at') finalName = 'created_at_';
    return finalName.substring(0, 63).replace(/_+$/, '');
};

export interface TableMeta {
    tableName: string;
    sheetId: string;
    sheetTitle: string;
    headers: string[];
    columnsMapping: Record<string, string>; // original -> sanitized
}

export async function getTablesMetadata(projectId: string, serviceId?: string): Promise<TableMeta[]> {
    const supabase = HistoryHandler.getSupabase();
    if (!supabase) return [];

    // 1. Obtener SHEET_ID_UPDATE desde settings
    let query = supabase.from("settings").select("value").eq("project_id", projectId).eq("key", "SHEET_ID_UPDATE");
    if (serviceId && serviceId !== 'default_service') {
        query = query.eq("service_id", serviceId);
    }
    const { data: settings } = await query;
    const sheetIdsStr = settings?.[0]?.value || process.env.SHEET_ID_UPDATE || "";
    const sheetIds = sheetIdsStr.split(",").map((id: string) => id.trim()).filter(Boolean);

    const tables: TableMeta[] = [];
    const sheets = getSheetsClient();

    for (const sheetId of sheetIds) {
        if (sheetId === "default" || sheetId === "PENDING" || sheetId.startsWith("default_")) continue;
        try {
            const meta = await sheets.spreadsheets.get({ spreadsheetId: sheetId });
            const sheetTitle = meta.data.sheets?.[0]?.properties?.title || "Sheet1";
            const tableName = sanitizeTableName(sheetTitle);

            // Obtener columnas iniciales desde el primer rango para mapear
            const response = await sheets.spreadsheets.values.get({
                spreadsheetId: sheetId,
                range: `${sheetTitle}!A1:ZZ1`,
            });
            const firstRow = response.data.values?.[0] || [];
            const headers = firstRow.map(h => (h || "").trim()).filter(Boolean);
            const columnsMapping: Record<string, string> = {};
            headers.forEach(h => {
                columnsMapping[h] = sanitizeColumnName(h);
            });

            tables.push({
                tableName,
                sheetId,
                sheetTitle,
                headers,
                columnsMapping
            });
        } catch (e) {
            console.error(`[DatabaseSync] Error resolviendo metadatos de sheet ${sheetId}:`, e);
        }
    }
    return tables;
}

export async function syncTableToGoogleSheet(tableName: string, sheetId: string, sheetTitle: string, headers: string[], projectId: string, serviceId?: string) {
    const supabase = HistoryHandler.getSupabase();
    if (!supabase) return;

    // 1. Obtener todas las filas de la tabla de Supabase
    const { data: rows, error } = await supabase
        .from(tableName)
        .select('*')
        .order('created_at', { ascending: true });

    if (error) {
        console.error(`[DatabaseSync] Error leyendo datos de '${tableName}':`, error.message);
        throw error;
    }

    // 2. Mapear filas a formato matriz para Google Sheets
    const columnsMapping = headers.map(h => ({
        original: h,
        sanitized: sanitizeColumnName(h)
    }));

    const rowsAsArrays = (rows || []).map(row => {
        return columnsMapping.map(col => {
            const val = row[col.sanitized];
            return val !== undefined && val !== null ? String(val) : "";
        });
    });

    const sheets = getSheetsClient();
    
    // 3. Limpiar la hoja de cálculo para evitar filas residuales
    try {
        await sheets.spreadsheets.values.clear({
            spreadsheetId: sheetId,
            range: `${sheetTitle}!A1:ZZ10000`
        });
    } catch (clearErr) {
        console.warn(`[DatabaseSync] Error limpiando hoja ${sheetId}:`, clearErr);
    }

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
    const lastColLetter = colToLetter(headers.length || 1);
    const range = `${sheetTitle}!A1:${lastColLetter}${rowsAsArrays.length + 1}`;

    // 4. Escribir nuevos encabezados y filas
    await sheets.spreadsheets.values.update({
        spreadsheetId: sheetId,
        range: range,
        valueInputOption: "RAW",
        requestBody: {
            values: [headers, ...rowsAsArrays]
        }
    });

    console.log(`[DatabaseSync] Sincronización exitosa con Google Sheets para la tabla '${tableName}'`);

    // 5. Opcional: Re-cargar en el vector store del Asistente de OpenAI para que esté sincronizado en el chat
    // Trigger update in background to generate json and upload
    setTimeout(async () => {
        try {
            await updateAllSheets({ projectId, serviceId, skipDb: true });
        } catch (err) {
            console.error('[DatabaseSync] Error actualizando vector store post-sync:', err);
        }
    }, 1000);
}

export interface RagDocMeta {
    docId: string;
    docName: string;
}

export async function getRagDocsMetadata(projectId: string, serviceId?: string): Promise<RagDocMeta[]> {
    const supabase = HistoryHandler.getSupabase();
    if (!supabase) return [];

    let query = supabase.from("settings").select("value").eq("project_id", projectId).eq("key", "DOCX_ID_UPDATE");
    if (serviceId && serviceId !== 'default_service') {
        query = query.eq("service_id", serviceId);
    }
    const { data: settings } = await query;
    const docIdsStr = settings?.[0]?.value || process.env.DOCX_ID_UPDATE || "";
    const docIds = docIdsStr.split(",").map((id: string) => id.trim()).filter(Boolean);

    const docsList: RagDocMeta[] = [];
    const drive = getDriveClient();

    for (const docId of docIds) {
        if (docId === "default" || docId === "PENDING" || docId.startsWith("default_")) continue;
        try {
            const meta = await drive.files.get({ fileId: docId, fields: "name" });
            docsList.push({
                docId,
                docName: meta.data.name || `Documento_${docId}`
            });
        } catch (e) {
            console.error(`[DatabaseSync] Error leyendo doc Drive ${docId}:`, e);
        }
    }
    return docsList;
}

export async function getDriveDocText(docId: string): Promise<string> {
    const drive = getDriveClient();
    
    // 1. Obtener tipo de documento y nombre
    const meta = await drive.files.get({ fileId: docId, fields: "name, mimeType" });
    const mimeType = meta.data.mimeType;
    const name = meta.data.name || "";

    // 2. Si es Google Doc nativo, exportar como texto plano
    if (mimeType === "application/vnd.google-apps.document") {
        const res = await drive.files.export({
            fileId: docId,
            mimeType: "text/plain"
        });
        return typeof res.data === "string" ? res.data : JSON.stringify(res.data);
    } else if (name.toLowerCase().endsWith('.docx') || name.toLowerCase().endsWith('.doc')) {
        // Es un archivo docx binario en Drive.
        // Descargarlo a un archivo temporal en "temp" y parsearlo con mammoth
        if (!fs.existsSync("temp")) {
            fs.mkdirSync("temp", { recursive: true });
        }
        const tempPath = path.join("temp", `temp_rag_${docId}.docx`);
        const dest = fs.createWriteStream(tempPath);
        const res = await drive.files.get(
            { fileId: docId, alt: "media" },
            { responseType: "stream" }
        );
        await new Promise((resolve, reject) => {
            res.data
                .on("end", resolve)
                .on("error", reject)
                .pipe(dest);
        });
        
        const mammoth = await import("mammoth");
        const buffer = fs.readFileSync(tempPath);
        const result = await mammoth.extractRawText({ buffer });
        
        try { fs.unlinkSync(tempPath); } catch (e) { /* ignore */ }
        return result.value || "";
    } else {
        // Archivo plano en Drive (como un .txt)
        const res = await drive.files.get({
            fileId: docId,
            alt: "media"
        });
        return typeof res.data === "string" ? res.data : JSON.stringify(res.data);
    }
}

export async function saveDriveDocText(docId: string, newText: string, projectId: string, serviceId?: string) {
    const drive = getDriveClient();
    const meta = await drive.files.get({ fileId: docId, fields: "name, mimeType" });
    const mimeType = meta.data.mimeType;
    const name = meta.data.name || "";

    if (mimeType === "application/vnd.google-apps.document") {
        const docs = getDocsClient();
        const doc = await docs.documents.get({ documentId: docId });
        const bodyContent = doc.data.body?.content || [];
        const endIndex = bodyContent[bodyContent.length - 1]?.endIndex || 1;

        const requests = [];
        if (endIndex > 2) {
            requests.push({
                deleteContentRange: {
                    range: {
                        startIndex: 1,
                        endIndex: endIndex - 1
                    }
                }
            });
        }
        requests.push({
            insertText: {
                text: newText,
                location: {
                    index: 1
                }
            }
        });

        await docs.documents.batchUpdate({
            documentId: docId,
            requestBody: {
                requests
            }
        });
    } else if (name.toLowerCase().endsWith('.docx') || name.toLowerCase().endsWith('.doc')) {
        // Es un archivo docx binario. Dado que guardamos texto plano, lo convertimos a un archivo .txt en Drive 
        // para que sea compatible y no se corrompa el binario original.
        const newName = name.replace(/\.docx?$/i, '.txt');
        await drive.files.update({
            fileId: docId,
            requestBody: { name: newName, mimeType: "text/plain" },
            media: {
                mimeType: "text/plain",
                body: newText
            }
        });
    } else {
        // Actualizar directamente como texto en drive
        await drive.files.update({
            fileId: docId,
            media: {
                mimeType: "text/plain",
                body: newText
            }
        });
    }

    // 3. Re-indexar documento para RAG automáticamente en Supabase
    setTimeout(async () => {
        try {
            const { updateAllDocs } = await import("../../apis/google/updateDoc.js");
            await updateAllDocs(projectId, serviceId);
            console.log(`[DatabaseSync] RAG re-indexado correctamente para el documento ${docId}`);
        } catch (err) {
            console.error('[DatabaseSync] Error re-indexando RAG post-guardado:', err);
        }
    }, 1000);
}

export async function getVisibleServiceIds(projectId: string, currentServiceId: string): Promise<string[]> {
    const isSuperAdmin = await HistoryHandler.getSetting('SUPER_ADMIN_MODE', projectId, currentServiceId, true);
    if (isSuperAdmin !== 'true') {
        return [currentServiceId];
    }
    const visibleStr = await HistoryHandler.getSetting('SUPER_ADMIN_VISIBLE_SERVICES', projectId, currentServiceId, true);
    if (visibleStr && visibleStr.trim() !== '') {
        const list = visibleStr.split(',').map(s => s.trim()).filter(Boolean);
        // Garantizar que incluya al menos el suyo propio
        if (!list.includes(currentServiceId)) {
            list.push(currentServiceId);
        }
        return list;
    }
    // Si no tiene filtros cargados, por defecto ve todos
    return HistoryHandler.getAllProjectServices(projectId);
}
