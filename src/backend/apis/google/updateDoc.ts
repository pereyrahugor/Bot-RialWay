import fs from "fs";
import path from "path";
import { google } from "googleapis";
import dotenv from "dotenv";
import { createGoogleAuth } from "./googleAuth.js";
import { HistoryHandler } from "../../db/historyHandler.js";
import { indexDocumentForRAG } from "../../rag/ragService.js";

dotenv.config();

const getDriveClient = () => {
    const auth = createGoogleAuth(["https://www.googleapis.com/auth/drive.readonly"]);
    return google.drive({ version: "v3", auth });
};

export async function updateAllDocs() {
    const supabase = HistoryHandler.getSupabase();
    if (!supabase) {
        console.log("⚠️ [GoogleDocs] Supabase no disponible para actualizar documentos.");
        return;
    }

    try {
        const currentProjectId = process.env.PROJECT_ID || process.env.RAILWAY_PROJECT_ID || HistoryHandler.PROJECT_IDENTIFIER;
        let query = supabase.from("settings").select("project_id, value").eq("key", "DOCX_ID_UPDATE");

        if (currentProjectId && !['default_project', 'default', 'test-hugo-local', 'local-dev'].includes(currentProjectId)) {
            console.log(`📌 [GoogleDocs] Sincronizando documentos exclusivamente para el proyecto activo: ${currentProjectId}`);
            query = query.eq("project_id", currentProjectId);
        }

        const { data: docSettings } = await query;

        const envDocx = process.env.DOCX_ID_UPDATE || "";
        const docTasks: Array<{ projectId: string; docxId: string }> = [];

        if (docSettings && docSettings.length > 0) {
            for (const s of docSettings) {
                const ids = (s.value || "").split(",").map(id => id.trim()).filter(Boolean);
                for (const docxId of ids) {
                    if (docxId && docxId !== "default" && docxId !== "PENDING" && !docxId.startsWith("default_")) {
                        docTasks.push({ projectId: s.project_id, docxId });
                    }
                }
            }
        }

        if (envDocx && envDocx !== "default" && envDocx !== "PENDING") {
            const ids = envDocx.split(",").map(id => id.trim()).filter(Boolean);
            for (const docxId of ids) {
                if (docxId && !docTasks.some(t => t.docxId === docxId)) {
                    docTasks.push({ projectId: "default", docxId });
                }
            }
        }

        if (docTasks.length === 0) {
            console.log("ℹ️ [GoogleDocs] No hay IDs de documentos para procesar.");
            return;
        }

        console.log(`📡 [GoogleDocs] Procesando ${docTasks.length} documentos para RAG en Supabase...`);

        for (const task of docTasks) {
            await processDocById(task.projectId, task.docxId);
        }
    } catch (err: any) {
        console.error("❌ [GoogleDocs] Error en updateAllDocs:", err?.message || err);
    }
}

async function processDocById(projectId: string, DOCX_FILE_ID: string) {
    const drive = getDriveClient();
    try {
        if (!DOCX_FILE_ID) throw new Error("No se definió DOCX_FILE_ID");

        const meta = await drive.files.get({ fileId: DOCX_FILE_ID, fields: "name, mimeType" });
        const fileName = meta.data.name || `archivo_${Date.now()}.docx`;

        if (!fs.existsSync("temp")) {
            fs.mkdirSync("temp", { recursive: true });
        }
        const tempDocxPath = path.join("temp", fileName.endsWith('.docx') ? fileName : fileName + '.docx');
        let downloaded = false;

        try {
            const dest = fs.createWriteStream(tempDocxPath);
            const res = await drive.files.get(
                { fileId: DOCX_FILE_ID, alt: "media" },
                { responseType: "stream" }
            );
            await new Promise((resolve, reject) => {
                res.data
                    .on("end", resolve)
                    .on("error", reject)
                    .pipe(dest);
            });
            downloaded = true;
            console.log(`✅ [GoogleDocs] Archivo descargado: ${tempDocxPath}`);
        } catch (err: any) {
            if (err?.response?.data?.error?.reason === "fileNotDownloadable" || /fileNotDownloadable/.test(err?.message || "")) {
                console.log("[GoogleDocs] Exportando Google Doc nativo como .docx...");
                const dest = fs.createWriteStream(tempDocxPath);
                const exportRes = await drive.files.export(
                    { fileId: DOCX_FILE_ID, mimeType: "application/vnd.openxmlformats-officedocument.wordprocessingml.document" },
                    { responseType: "stream" }
                );
                await new Promise((resolve, reject) => {
                    exportRes.data
                        .on("end", resolve)
                        .on("error", reject)
                        .pipe(dest);
                });
                downloaded = true;
                console.log(`✅ [GoogleDocs] Google Doc exportado como .docx: ${tempDocxPath}`);
            } else {
                throw err;
            }
        }

        if (!downloaded) throw new Error("No se pudo descargar ni exportar el documento.");

        // Indexar documento para RAG en Supabase
        const indexOk = await indexDocumentForRAG(projectId, DOCX_FILE_ID, fileName, tempDocxPath);

        deleteTemporaryDocx(tempDocxPath);

        if (indexOk) {
            console.log(`🎉 [GoogleDocs] Documento "${fileName}" (ID: ${DOCX_FILE_ID}) sincronizado con éxito en RAG Supabase.`);
        }
        return indexOk;
    } catch (error: any) {
        console.error(`❌ [GoogleDocs] Error procesando documento ID ${DOCX_FILE_ID}:`, error?.message || error);
        return false;
    }
}

function deleteTemporaryDocx(tempPath: string) {
    try {
        if (fs.existsSync(tempPath)) {
            fs.unlinkSync(tempPath);
        }
    } catch (error: any) {
        console.error("❌ Error eliminando archivo temporal:", error.message);
    }
}