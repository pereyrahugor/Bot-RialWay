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
            const mimetype = (ctx?.media?.mimetype || ctx?.message?.documentMessage?.mimetype || ctx?.mimetype || '').toLowerCase();
            const fileName = (ctx?.media?.filename || ctx?.message?.documentMessage?.fileName || '').toLowerCase();

            const isPdf = mimetype.includes('pdf') || fileName.endsWith('.pdf') || mimetype === 'application/octet-stream' || mimetype === 'application/x-pdf' || !mimetype;

            if (!isPdf) {
                await flowDynamic("Solo se aceptan comprobantes en formato PDF o Imagen en este flujo.");
                return;
            }

            // Asegurar que la carpeta tmp exista
            if (!fs.existsSync("./tmp/")) {
                fs.mkdirSync("./tmp/", { recursive: true });
            }

            // Prevenir 'Error: MIME type not found' en BaileysProvider asegurando mimetype por defecto
            if (ctx) {
                if (ctx.message?.documentMessage && !ctx.message.documentMessage.mimetype) {
                    ctx.message.documentMessage.mimetype = "application/pdf";
                }
                if (ctx.message?.documentWithCaptionMessage?.message?.documentMessage && !ctx.message.documentWithCaptionMessage.message.documentMessage.mimetype) {
                    ctx.message.documentWithCaptionMessage.message.documentMessage.mimetype = "application/pdf";
                }
                if (ctx.media && !ctx.media.mimetype) {
                    ctx.media.mimetype = "application/pdf";
                }
                if (!ctx.mimetype) {
                    ctx.mimetype = "application/pdf";
                }
            }

            // 1. Intentar guardar usando provider.saveFile del framework
            try {
                localPath = await provider.saveFile(ctx, { path: "./tmp/" });
            } catch (saveErr: any) {
                console.warn("⚠️ [welcomeFlowDoc] provider.saveFile falló con error:", saveErr.message || saveErr);
            }

            // 2. Si provider.saveFile falló (ej: MIME type not found en Baileys), descargar directamente mediante el stream de Baileys
            if (!localPath || !fs.existsSync(localPath)) {
                try {
                    console.log("🔄 [welcomeFlowDoc] Ejecutando descarga directa de stream de Baileys...");

                    // 2a. Verificar si el buffer ya existe en memoria en el contexto
                    if (ctx?.media?.buffer && Buffer.isBuffer(ctx.media.buffer) && ctx.media.buffer.length > 0) {
                        const fallbackPath = path.join("./tmp/", `doc_${Date.now()}.pdf`);
                        fs.writeFileSync(fallbackPath, ctx.media.buffer);
                        localPath = fallbackPath;
                        console.log(`✅ [welcomeFlowDoc] PDF guardado desde ctx.media.buffer: ${localPath} (${ctx.media.buffer.length} bytes)`);
                    } else {
                        // 2b. Extraer objeto de media de cualquier estructura posible de Baileys
                        const rawMsg = ctx.message || ctx.msg || ctx;
                        let targetMedia = rawMsg?.documentMessage 
                            || rawMsg?.documentWithCaptionMessage?.message?.documentMessage 
                            || rawMsg?.ephemeralMessage?.message?.documentMessage 
                            || rawMsg?.viewOnceMessage?.message?.documentMessage 
                            || rawMsg?.viewOnceMessageV2?.message?.documentMessage 
                            || rawMsg?.imageMessage
                            || rawMsg;

                        if (targetMedia?.message) {
                            targetMedia = targetMedia.message.documentMessage || targetMedia.message.imageMessage || targetMedia.message;
                        }

                        const mediaType = (targetMedia?.mimetype?.includes('image') || rawMsg?.imageMessage) ? 'image' : 'document';

                        if (targetMedia && (targetMedia.url || targetMedia.directPath || targetMedia.mediaKey)) {
                            const { downloadContentFromMessage } = await import("@whiskeysockets/baileys");
                            const stream = await downloadContentFromMessage(targetMedia, mediaType as any);
                            let buffer = Buffer.from([]);
                            for await (const chunk of stream) {
                                buffer = Buffer.concat([buffer, chunk]);
                            }

                            if (buffer.length > 0) {
                                const fallbackPath = path.join("./tmp/", `doc_${Date.now()}.pdf`);
                                fs.writeFileSync(fallbackPath, buffer);
                                localPath = fallbackPath;
                                console.log(`✅ [welcomeFlowDoc] PDF descargado directamente con éxito en: ${localPath} (${buffer.length} bytes)`);
                            }
                        } else {
                            console.error("⚠️ [welcomeFlowDoc] No se pudo encontrar objeto con llaves de descarga en ctx. Keys de ctx:", Object.keys(ctx || {}));
                        }
                    }
                } catch (directErr: any) {
                    console.error("❌ [welcomeFlowDoc] Error en descarga directa de stream de Baileys:", directErr.message || directErr);
                }
            }

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
            
            const isOcrEnabled = await HistoryHandler.getSetting('MERCADOPAGO_OCR_ENABLED', dynamicProjectId)
                || await HistoryHandler.getConfig('MERCADOPAGO_OCR_ENABLED');

            if (isOcrEnabled === 'true') {
                const { verifyReceiptFlow } = await import("../../utils/receiptVerifierMP");
                
                for (const imgPath of imagenes) {
                    const imgBuffer = fs.readFileSync(imgPath);
                    const processed = await verifyReceiptFlow(imgBuffer, flowDynamic, dynamicProjectId, ctx.from);
                    if (processed) {
                        receiptProcessed = true;
                        break;
                    }
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