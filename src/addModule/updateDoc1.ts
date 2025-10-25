import fs from "fs";
import path from "path";
import { google } from "googleapis";
import dotenv from "dotenv";
import OpenAI from "openai";
import * as glob from "glob";

dotenv.config();

const VECTOR_STORE_ID = process.env.VECTOR_STORE_ID ?? "";
const DOCX_FILE_ID = process.env.DOCX_ID_UPDATE_1 ?? "";
let currentFileId: string | null = null;

// Construir credenciales desde variables de entorno
const credentials = {
    client_email: process.env.GOOGLE_CLIENT_EMAIL,
    private_key: process.env.GOOGLE_PRIVATE_KEY?.replace(/\\n/g, '\n'),
};

const auth = new google.auth.GoogleAuth({
    credentials,
    scopes: ["https://www.googleapis.com/auth/drive.readonly"],
});
const drive = google.drive({ version: "v3", auth });
const openai = new OpenAI();

/**
 * Descarga un archivo .docx desde Google Drive usando el fileId del .env y obtiene el nombre real del archivo
 * @returns {Promise<{ localPath: string, fileName: string }>}
 */
export async function downloadDocxFromDrive(): Promise<{ localPath: string, fileName: string }> {
    try {
        if (!DOCX_FILE_ID) throw new Error("No se definió DOCX_FILE_ID en el .env");

        // Obtener el nombre real del archivo desde Google Drive
        const meta = await drive.files.get({ fileId: DOCX_FILE_ID, fields: "name" });
        const fileName = meta.data.name || `archivo_${Date.now()}.docx`;

        // Verifica que la carpeta temp exista
        if (!fs.existsSync("temp")) {
            fs.mkdirSync("temp", { recursive: true });
        }

        const tempDocxPath = path.join("temp", fileName);
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

        console.log(`✅ Archivo descargado: ${tempDocxPath}`);
        return { localPath: tempDocxPath, fileName };
    } catch (error: any) {
        console.error("❌ Error al descargar el archivo .docx:", error.message);
        throw error;
    }
}

/**
 * Sube el archivo .docx al vector store de OpenAI, elimina la versión anterior y limpia el temp
 */
export async function updateDocx1(stateId?: string) {
    try {
        // Descarga el archivo desde Google Drive usando el fileId del .env y obtiene el nombre real
        const { localPath, fileName } = await downloadDocxFromDrive();

        // Elimina archivos anteriores en OpenAI usando el nombre real
        await deleteOldDocxFiles(fileName);

        // Sube el archivo a OpenAI
        const fileStream = fs.createReadStream(localPath);
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
        deleteTemporaryDocx(localPath);

        console.log("✅ Archivo .docx actualizado en el vector store.");
        return true;
    } catch (error: any) {
        console.error("❌ Error al subir el archivo .docx:", error.message);
        throw error;
    }
}

/**
 * Adjunta un archivo al vector store de OpenAI
 */
async function attachFileToVectorStore(fileId: string) {
    try {
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

/**
 * Elimina archivos .docx anteriores del vector store de OpenAI que tengan el mismo nombre
 * @param fileName El nombre real del archivo .docx a eliminar
 */
async function deleteOldDocxFiles(fileName: string) {
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

/**
 * Elimina el archivo .docx temporal
 * @param tempPath Ruta al archivo temporal a eliminar
 */
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