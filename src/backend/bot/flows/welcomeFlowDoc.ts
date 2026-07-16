import { addKeyword, EVENTS } from "@builderbot/bot";
import { BaileysProvider } from "@builderbot/provider-baileys";
import { MemoryDB } from "@builderbot/bot";
import { reset } from "~/bot/timeOut";
import { userQueues, userLocks, handleQueue } from "~/bot/queueManager";
import { processImageWithVision } from "../../apis/openai/processImageWithVision";
import fs from 'fs';
import path from 'path';


import { execSync } from 'child_process';



// Función para convertir PDF a imágenes PNG usando pdftoppm (Poppler)
function extraerPaginasComoPNG(pdfPath: string, outputDir: string) {
    // Genera imágenes page-1.png, page-2.png, ... en outputDir
    const outPrefix = path.join(outputDir, 'page');
    execSync(`pdftoppm -png "${pdfPath}" "${outPrefix}"`);
    // Buscar los archivos generados
    const files = fs.readdirSync(outputDir)
        .filter(f => f.startsWith('page-') && f.endsWith('.png'))
        .map(f => path.join(outputDir, f));
    return files;
}

export const welcomeFlowDoc = addKeyword<BaileysProvider, MemoryDB>(EVENTS.DOCUMENT)
    .addAction(async (ctx, { gotoFlow, flowDynamic, provider }) => {
        const { HistoryHandler } = await import("~/db/historyHandler");
        const timeoutCierreValue = await HistoryHandler.getConfig('timeOutCierre') || 45;
        const setTime = Number(timeoutCierreValue) * 60 * 1000;
        reset(ctx, gotoFlow, setTime);
        let localPath = null;
        let outputDir = null;
        const imagenesGeneradas = [];
        const botPhoneNumber = provider?.globalVendorArgs?.phone_number_id || (ctx.to ? ctx.to.replace(/\D/g, '') : null);
        const dynamicProjectId = await HistoryHandler.getProjectIdByRecipient(botPhoneNumber) || HistoryHandler.PROJECT_IDENTIFIER;
        try {
            let tipo = "desconocido";
            const mimetype = ctx?.media?.mimetype || ctx?.message?.documentMessage?.mimetype;
            if (mimetype === "application/pdf") tipo = "pdf";
            else tipo = mimetype || "desconocido";

            if (tipo !== "pdf") {
                await flowDynamic("Solo se aceptan archivos PDF en este flujo.");
                return;
            }

            // Asegurar que la carpeta tmp exista
            if (!fs.existsSync("./tmp/")) {
                fs.mkdirSync("./tmp/", { recursive: true });
            }

            // Guardar el PDF en tmp
            localPath = await provider.saveFile(ctx, { path: "./tmp/" });
            if (!localPath) {
                await flowDynamic("No se pudo guardar el PDF recibido.");
                return;
            }

            // Convertir cada página del PDF a imagen (png) usando pdftoppm (Poppler)
            outputDir = path.join("./tmp", `pdf_${Date.now()}`);
            fs.mkdirSync(outputDir, { recursive: true });
            let imagenes: string[] = [];
            try {
                imagenes = extraerPaginasComoPNG(localPath, outputDir);
            } catch (e: any) {
                console.error("Error extrayendo páginas como PNG:", e);
                await flowDynamic("Error al convertir el PDF a imágenes. Asegúrate de que el PDF no esté protegido y que Poppler esté instalado.");
            }
            if (imagenes.length === 0) {
                await flowDynamic("No se pudo convertir el PDF a imágenes.");
                return;
            }
            let receiptProcessed = false;
            const { verifyReceiptFlow } = await import("../../utils/receiptVerifierMP");
            
            for (const imgPath of imagenes) {
                const imgBuffer = fs.readFileSync(imgPath);
                const processed = await verifyReceiptFlow(imgBuffer, flowDynamic, dynamicProjectId, ctx.from);
                if (processed) {
                    receiptProcessed = true;
                    break;
                }
            }

            if (!receiptProcessed) {
                for (const imgPath of imagenes) {
                    const imgBuffer = fs.readFileSync(imgPath);
                    await processImageWithVision(imgBuffer, flowDynamic, dynamicProjectId);
                }
            }
            imagenesGeneradas.push(...imagenes);
        } catch (err: any) {
            console.error("Error procesando PDF:", err);
            await flowDynamic("Ocurrió un error al procesar el PDF.");
        } finally {
            // Limpiar archivos temporales SIEMPRE
            if (imagenesGeneradas.length > 0) {
                for (const imgPath of imagenesGeneradas) {
                    try { fs.unlinkSync(imgPath); } catch (e: any) { console.error("Ignorado:", e.message); }
                }
            }
            if (outputDir && fs.existsSync(outputDir)) {
                try { fs.rmSync(outputDir, { recursive: true, force: true }); } catch (e: any) { console.error("Ignorado:", e.message); }
            }
            if (localPath && fs.existsSync(localPath)) {
                try { fs.unlinkSync(localPath); } catch (e: any) { console.error("Ignorado:", e.message); }
            }
        }
    });