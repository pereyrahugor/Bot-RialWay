import { google } from "googleapis";
import moment from "moment";
import "dotenv/config";
import { GenericResumenData } from "../../utils/extractJsonData";
import { createGoogleAuth } from "./googleAuth";

// La inicialización se movió dentro de la función para ser lazy y evitar errores de carga prematura

// ID de la hoja de cálculo desde .env
const SHEET_ID = process.env.SHEET_ID_RESUMEN ?? "";

/**
 * Función para agregar datos genéricos a Google Sheets
 * @param {GenericResumenData} data - Datos dinámicos que se enviarán a Sheets
 * @param {string} spreadsheetId - ID opcional de la hoja (si no se pasa, usa process.env)
 * @param {string} customRange - Rango opcional (si no se pasa, usa process.env o Hoja1!A1)
 */
export const addToSheet = async (data: GenericResumenData, spreadsheetId?: string, customRange?: string): Promise<void> => {
    try {
        const auth = createGoogleAuth(["https://www.googleapis.com/auth/spreadsheets"]);
        const sheets = google.sheets({ version: "v4", auth });

        // Determinar ID y Rango (Prioridad: Argumento > Env)
        const targetSheetId = spreadsheetId || process.env.SHEET_ID_RESUMEN || "";
        if (!targetSheetId || targetSheetId === 'PENDING') {
            console.warn("⚠️ [SheetsResumen] No se ha definido SHEET_ID_RESUMEN.");
            return;
        }

        const targetRange = customRange || process.env.SHEET_RESUMEN_RANGE || "Hoja1!A1";

        // Obtener la fecha y hora actual
        const fechaHora: string = moment().format("YYYY-MM-DD HH:mm:ss");

        // Siempre poner fecha en A y linkWS en B, el resto en el orden recibido (sin duplicar linkWS)
        const linkWS = data.linkWS || '';
        // Excluir linkWS de los datos extra
        const keys = Object.keys(data).filter(key => key !== 'linkWS');
        const values = [[fechaHora, linkWS, ...keys.map(key => data[key])]];

        await sheets.spreadsheets.values.append({
            spreadsheetId: targetSheetId,
            range: targetRange,
            valueInputOption: "RAW",
            requestBody: { values },
        });

        console.log(`✅ [SheetsResumen] Datos enviados a Google Sheets: ${targetSheetId}`);
    } catch (error: any) {
        console.error("❌ Error al enviar datos a Google Sheets:", error?.message || error);
    }
};
