import { google } from "googleapis";
import { createGoogleAuth } from "./googleAuth";
import fs from "fs";
import path from "path";
import { finished } from "stream/promises";

// Se eliminaron inicializaciones estáticas para evitar errores de carga prematura
const getDriveClient = () => {
    const auth = createGoogleAuth([
        "https://www.googleapis.com/auth/drive.readonly",
        "https://www.googleapis.com/auth/drive.file"
    ]);
    return google.drive({ version: "v3", auth });
};


/**
 * Descarga un archivo desde Google Drive dado su ID.
 * @param fileId ID del archivo en Google Drive.
 * @returns Path local del archivo descargado.
 */
export const downloadFileFromDrive = async (fileId: string): Promise<string> => {
    try {
        // Asegurar que existe el directorio temporal
        const tempDir = path.join(process.cwd(), "temp", "drive");
        if (!fs.existsSync(tempDir)) {
            fs.mkdirSync(tempDir, { recursive: true });
        }

        // Obtener metadatos del archivo para saber el nombre original
        const drive = getDriveClient();
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
        const filePath = path.join(tempDir, fileName);

        console.log(`[Drive] Iniciando descarga de archivo ID: ${fileId} (${fileName})... MimeType: ${mimeType}`);

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
        console.error("❌ [Drive] Error al descargar de Google Drive:", error.message);
        throw error;
    }
};
