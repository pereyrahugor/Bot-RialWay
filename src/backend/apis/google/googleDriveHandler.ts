import { google } from "googleapis";
import { createGoogleAuthAsync } from "./googleAuth";
import fs from "fs";
import path from "path";
import { finished } from "stream/promises";

// Se eliminaron inicializaciones estáticas para evitar errores de carga prematura
const getDriveClient = async (projectId?: string | null, serviceId?: string | null) => {
    const auth = await createGoogleAuthAsync([
        "https://www.googleapis.com/auth/drive.readonly",
        "https://www.googleapis.com/auth/drive.file"
    ], projectId, serviceId);
    return google.drive({ version: "v3", auth });
};


/**
 * Extrae un ID limpio de archivo de Google Drive a partir de un ID directo o una URL.
 */
export const extractGoogleDriveFileId = (input: string): string => {
    if (!input) return '';
    const trimmed = input.trim();

    // Si ya es una ruta existente en disco
    if (fs.existsSync(trimmed)) return trimmed;

    // 1. Extraer de URL estándar de Drive / Docs / Sheets
    const urlMatch = trimmed.match(/\/d\/([a-zA-Z0-9_-]{15,})/i) || trimmed.match(/id=([a-zA-Z0-9_-]{15,})/i);
    if (urlMatch) {
        return urlMatch[1];
    }

    // 2. Si viene como ID directo con extensión (ej: ID.pdf)
    const withoutExt = trimmed.replace(/\.pdf$/i, '').trim();

    // 3. Si contiene una secuencia válida de ID de Drive (mínimo 15 caracteres)
    const idMatch = withoutExt.match(/([a-zA-Z0-9_-]{15,})/);
    if (idMatch) {
        return idMatch[1];
    }

    return withoutExt;
};

/**
 * Descarga un archivo desde Google Drive dado su ID o URL.
 * @param rawFileId ID o URL del archivo en Google Drive, o ruta local.
 * @param projectId ID del proyecto opcional para resolución de credenciales.
 * @param serviceId ID del servicio opcional para resolución de credenciales.
 * @returns Path local del archivo descargado.
 */
export const downloadFileFromDrive = async (rawFileId: string, projectId?: string | null, serviceId?: string | null): Promise<string> => {
    if (!rawFileId) throw new Error("ID de archivo no proporcionado");
    
    // Si ya es un archivo local existente
    const trimmed = rawFileId.trim();
    if (fs.existsSync(trimmed)) {
        return path.resolve(trimmed);
    }

    const fileId = extractGoogleDriveFileId(trimmed);
    if (!fileId) throw new Error(`No se pudo extraer un ID válido de Google Drive desde: "${rawFileId}"`);

    try {
        // Asegurar que existe el directorio temporal
        const tempDir = path.join(process.cwd(), "temp", "drive");
        if (!fs.existsSync(tempDir)) {
            fs.mkdirSync(tempDir, { recursive: true });
        }

        // Obtener metadatos del archivo para saber el nombre original
        const drive = await getDriveClient(projectId, serviceId);
        const fileMetadata = await drive.files.get({
            fileId: fileId,
            fields: "name, mimeType",
        });

        const mimeType = fileMetadata.data.mimeType || "";
        const isGoogleDoc = mimeType.startsWith("application/vnd.google-apps.");
        let fileName = fileMetadata.data.name || fileId;

        // Si es un Google Doc, Sheet, Slide, etc., o es un PDF nativo y no tiene la extensión .pdf, se la agregamos
        if ((isGoogleDoc || mimeType === "application/pdf") && !fileName.toLowerCase().endsWith(".pdf")) {
            fileName = `${fileName}.pdf`;
        }
        // Sanitizar el nombre del archivo para que no contenga caracteres inválidos en el sistema de archivos
        const sanitizedFileName = fileName.replace(/[<>:"/\\|?*]/g, '_');
        const filePath = path.join(tempDir, sanitizedFileName);

        console.log(`[Drive] 📥 Iniciando descarga de archivo ID: ${fileId} (${sanitizedFileName})... MimeType: ${mimeType}`);

        // Descargar/exportar el contenido del archivo
        let res;
        if (isGoogleDoc) {
            console.log(`[Drive] Archivo es Google Doc. Exportando a PDF...`);
            res = await drive.files.export(
                { fileId: fileId, mimeType: "application/pdf" },
                { responseType: "stream" }
            );
        } else {
            res = await drive.files.get(
                { fileId: fileId, alt: "media" },
                { responseType: "stream" }
            );
        }

        const dest = fs.createWriteStream(filePath);
        res.data.pipe(dest);

        await finished(dest);

        console.log(`✅ [Drive] Archivo descargado con éxito: ${filePath}`);
        return filePath;
    } catch (error: any) {
        console.error(`❌ [Drive] Error al descargar de Google Drive (ID: ${fileId}):`, error.message);
        throw error;
    }
};
