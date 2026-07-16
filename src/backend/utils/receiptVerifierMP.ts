import { processImageWithVision } from "../apis/openai/processImageWithVision";
import { verifyMercadoPagoPayment } from "./mercadopago";
import { supabase } from "../db/historyHandler";

/**
 * Verifica si una imagen o comprobante es de Mercado Pago, extrae sus datos
 * con el asistente de OCR especializado, valida duplicados y consulta la API de Mercado Pago.
 * 
 * @returns true si se detectó y procesó como comprobante de Mercado Pago, false de lo contrario.
 */
export async function verifyReceiptFlow(
    imgBuffer: Buffer,
    flowDynamic: any,
    projectId: string,
    userId: string
): Promise<boolean> {
    try {
        // 1. Ejecutar el asistente general para descripción
        console.log(`[ReceiptVerifierMP] Ejecutando análisis general del asistente de visión para usuario: ${userId}...`);
        const description = await processImageWithVision(imgBuffer, flowDynamic, projectId, 'ASSISTANT_ID_IMG');
        
        if (!description) {
            console.log("[ReceiptVerifierMP] El análisis general no retornó descripción.");
            return false;
        }

        // 2. Detectar si el texto contiene indicios de ser un comprobante de Mercado Pago
        const isReceipt = /comprobante|transferencia|mercado\s*pago|transaccion|pago/i.test(description);
        
        if (!isReceipt) {
            console.log("[ReceiptVerifierMP] La imagen no fue identificada como un comprobante de Mercado Pago.");
            return false;
        }

        // Registrar la detección en el log (sin enviar mensaje de carga al chat del usuario)
        console.log("[ReceiptVerifierMP] Se detectó un comprobante de Mercado Pago en logs. Iniciando extracción OCR...");

        // 3. Ejecutar el asistente OCR especializado para obtener JSON
        const ocrResult = await processImageWithVision(imgBuffer, flowDynamic, projectId, 'ASSISTANT_ID_MP_OCR');
        if (!ocrResult) {
            console.warn("[ReceiptVerifierMP] No se obtuvo respuesta del OCR especializado.");
            return false;
        }

        // 4. Intentar parsear el JSON estructurado del comprobante
        let receiptData: any = null;
        try {
            const cleanJson = ocrResult.replace(/```json/g, "").replace(/```/g, "").trim();
            receiptData = JSON.parse(cleanJson);
        } catch (e: any) {
            console.error("[ReceiptVerifierMP] Error parseando respuesta de OCR como JSON:", e.message, "\nResultado crudo:", ocrResult);
            return false;
        }

        if (!receiptData || receiptData.estado_lectura !== "EXITO" || !receiptData.numero_operacion) {
            console.log("[ReceiptVerifierMP] El comprobante no pudo ser leído exitosamente o no contiene número de operación.", receiptData);
            return false;
        }

        const paymentId = String(receiptData.numero_operacion).trim();
        const amount = Number(receiptData.monto_numerico);

        console.log(`[ReceiptVerifierMP] Comprobante leído. Operación: ${paymentId}, Monto: ${amount}`);

        // 5. Verificar duplicados en la base de datos (mercadopago_payments_clients)
        const { data: existingPayment, error: dbError } = await supabase
            .from("mercadopago_payments_clients")
            .select("id")
            .eq("id", paymentId)
            .eq("project_id", projectId)
            .maybeSingle();

        if (dbError) {
            console.error("[ReceiptVerifierMP] Error consultando duplicados en BD:", dbError);
        }

        if (existingPayment) {
            console.log(`[ReceiptVerifierMP] Operación duplicada detectada: ${paymentId}`);
            await flowDynamic("⚠️ Este comprobante ya fue recibido y registrado anteriormente.");
            return true; // Retornamos true porque ya fue procesada, evitando que continúe a otras preguntas
        }

        // 6. Consultar la API de Mercado Pago para verificar la veracidad en cuenta real
        try {
            console.log(`[ReceiptVerifierMP] Consultando API de Mercado Pago para ID: ${paymentId}...`);
            const paymentInfo = await verifyMercadoPagoPayment(paymentId, projectId);
            
            const mpAmount = Number(paymentInfo.transaction_amount);
            const mpStatus = paymentInfo.status;

            if (mpStatus === 'approved') {
                // Pago verificado y aprobado!
                // Guardar en la base de datos para control de duplicados
                const { error: insertError } = await supabase
                    .from("mercadopago_payments_clients")
                    .insert({
                        id: paymentId,
                        project_id: projectId,
                        chat_id: userId,
                        status: mpStatus,
                        transaction_amount: mpAmount,
                        description: paymentInfo.description || 'Verificación automática OCR de comprobante',
                        payment_method_id: paymentInfo.payment_method_id,
                        user_id: String(paymentInfo.collector_id),
                        created_at: new Date().toISOString(),
                        updated_at: new Date().toISOString()
                    });

                if (insertError) {
                    console.error("[ReceiptVerifierMP] Error insertando registro de pago verificado en BD:", insertError);
                }

                await flowDynamic(`✅ ¡Comprobante verificado con éxito! Pago acreditado en tu cuenta por un monto de $${mpAmount}.`);
                return true;
            } else {
                console.log(`[ReceiptVerifierMP] Operación encontrada pero estado no es approved: ${mpStatus}`);
                await flowDynamic(`⚠️ El comprobante corresponde a la operación N° ${paymentId}, pero el estado del pago en Mercado Pago es "${mpStatus}" (no aprobado).`);
                return true; // Es un comprobante real pero no acreditado, detenemos el procesamiento genérico
            }

        } catch (apiErr: any) {
            console.error("[ReceiptVerifierMP] Error llamando a API de Mercado Pago:", apiErr.response?.data || apiErr.message);
            await flowDynamic(`⚠️ No se pudo verificar la operación N° ${paymentId} en la cuenta de Mercado Pago. Detalle: ${apiErr.response?.data?.message || apiErr.message}`);
            return true; // Es comprobante pero falló verificación de API, detenemos
        }

    } catch (err: any) {
        console.error("[ReceiptVerifierMP] Error crítico en el flujo de verificación de comprobante:", err.message);
        return false;
    }
}
