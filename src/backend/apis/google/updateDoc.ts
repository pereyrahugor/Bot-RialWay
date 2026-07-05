import fs from "fs";
import path from "path";
import { google } from "googleapis";
import dotenv from "dotenv";
import OpenAI from "openai";
import * as glob from "glob";

dotenv.config();

let currentFileId: string | null = null;


import { createGoogleAuth } from "./googleAuth";
import { getOpenAIBaseUrl } from "../openai/openaiHelper";

// Se eliminaron inicializaciones estáticas para evitar errores de carga prematura

const getDriveClient = () => {
    const auth = createGoogleAuth(["https://www.googleapis.com/auth/drive.readonly"]);
    return google.drive({ version: "v3", auth });
};

const getOpenAIClient = () => {
    const key = process.env.OPENAI_API_KEY;
    const baseURL = getOpenAIBaseUrl();
    return (key && key.length > 5) ? new OpenAI({ 
        apiKey: key,
        ...(baseURL ? { baseURL } : {})
    }) : null;
};


// Función principal para procesar todos los docs
export async function updateAllDocs() {
    const DOCX_FILE_IDS = (process.env.DOCX_ID_UPDATE || "")
        .split(",")
        .map(id => id.trim())
        .filter(Boolean);

    for (const DOCX_FILE_ID of DOCX_FILE_IDS) {
        if (DOCX_FILE_ID === "default" || DOCX_FILE_ID === "PENDING" || DOCX_FILE_ID.startsWith("default_")) {
            console.log(`ℹ️ [GoogleDocs] Saltando ID de doc marcador de posición: "${DOCX_FILE_ID}"`);
            continue;
        }

        await processDocById(DOCX_FILE_ID);
    }
}

// Procesa un docx por ID, obtiene el nombre real y ejecuta la lógica
async function processDocById(DOCX_FILE_ID: string) {
    const drive = getDriveClient();
    const openai = getOpenAIClient();
    try {
        if (!DOCX_FILE_ID) throw new Error("No se definió DOCX_FILE_ID en el .env");
        // Obtener el nombre real del archivo desde Google Drive
        const meta = await drive.files.get({ fileId: DOCX_FILE_ID, fields: "name, mimeType" });
        const fileName = meta.data.name || `archivo_${Date.now()}.docx`;
        const mimeType = meta.data.mimeType || "";

        // Verifica que la carpeta temp exista
        if (!fs.existsSync("temp")) {
            fs.mkdirSync("temp", { recursive: true });
        }
        const tempDocxPath = path.join("temp", fileName.endsWith('.docx') ? fileName : fileName + '.docx');
        let downloaded = false;
        // Intentar descarga binaria directa (para archivos subidos)
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
            console.log(`✅ Archivo descargado: ${tempDocxPath}`);
        } catch (err: any) {
            // Si es un Google Doc nativo, usar export
            if (err?.response?.data?.error?.reason === "fileNotDownloadable" || /fileNotDownloadable/.test(err?.message || "")) {
                console.log("Archivo es un Google Doc nativo, exportando como .docx...");
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
                console.log(`✅ Google Doc exportado como .docx: ${tempDocxPath}`);
            } else {
                throw err;
            }
        }
        if (!downloaded) throw new Error("No se pudo descargar ni exportar el documento.");
        if (!openai) {
            console.warn("⚠️ IA Desactivada: Saltando subida de .docx a OpenAI.");
            deleteTemporaryDocx(tempDocxPath);
            return true;
        }
        // Sube el archivo a OpenAI
        const fileStream = fs.createReadStream(tempDocxPath);
        const response = await openai.files.create({
            file: fileStream,
            purpose: "assistants"
        });
        currentFileId = response.id;
        console.log(`📂 Archivo .docx subido con ID: ${currentFileId}`);
        // Adjunta el archivo al vector store
        const attachSuccess = await attachFileToVectorStore(currentFileId);
        if (!attachSuccess) {
            throw new Error("No se pudo adjuntar el archivo al vector store.");
        }
        // Elimina el archivo temporal
        deleteTemporaryDocx(tempDocxPath);
        console.log("✅ Archivo .docx actualizado en el vector store.");
        return true;
    } catch (error: any) {
        console.error("❌ Error al procesar el documento:", error?.message || error);
        return false;
    }
}

async function attachFileToVectorStore(fileId: string) {
    const VECTOR_STORE_ID = process.env.VECTOR_STORE_ID || "";
    const openai = getOpenAIClient();

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
            console.log("✅ Archivo adjuntado correctamente al vector store.");
            return true;
        } else {
            console.warn("⚠️ No se recibió una confirmación clara de OpenAI.");
            return false;
        }
    } catch (error: any) {
        console.error("❌ Error al adjuntar el archivo al vector store:", error.message);
        return false;
    }
}

async function deleteOldDocxFiles(fileName: string) {
    const openai = getOpenAIClient();
    if (!openai) return;
    try {

        console.log("🗑️ Eliminando archivos .docx anteriores del vector store...");
        const files = await openai.files.list();
        for (const file of files.data) {
            if (file.filename === fileName) {
                await openai.files.del(file.id);
                console.log(`🗑️ Archivo eliminado: ${file.id}`);
            }
        }
    } catch (error: any) {
        console.error("❌ Error al eliminar archivos anteriores:", error.message);
    }
}

function deleteTemporaryDocx(tempPath: string) {
    try {
        if (fs.existsSync(tempPath)) {
            fs.unlinkSync(tempPath);
            console.log("🗑️ Archivo temporal eliminado.");
        }
    } catch (error: any) {
        console.error("❌ Error al eliminar el archivo temporal:", error.message);
    }
}