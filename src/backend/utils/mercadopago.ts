import { MercadoPagoConfig, Preference } from "mercadopago";
import { HistoryHandler, supabase } from "../db/historyHandler";
import axios from "axios";

/**
 * Crea una preferencia de pago en Mercado Pago y retorna el link de pago (initPoint).
 * @param title Concepto o descripción del pago.
 * @param amount Monto a cobrar.
 * @param quantity Cantidad (default: 1).
 */
export async function createMercadoPagoPreference(
    title: string,
    amount: number,
    quantity = 1,
    projectId: string | null = null,
    chatId: string | null = null
): Promise<{ initPoint: string; preferenceId: string }> {
    let accessToken = "";
    try {
        const { data: acc } = await supabase
            .from("mercadopago_acount_user")
            .select("access_token")
            .eq("project_id", projectId || "default")
            .eq("is_active", true)
            .maybeSingle();
        accessToken = acc?.access_token || "";
    } catch (dbErr) {
        console.error("[MercadoPago Pref] Error fetching token from DB:", dbErr);
    }

    if (!accessToken) {
        throw new Error("No hay ninguna cuenta de Mercado Pago vinculada y activa para este proyecto. Por favor vincula tu cuenta desde el panel.");
    }

    const client = new MercadoPagoConfig({ accessToken });
    const preference = new Preference(client);

    // Obtener dominio de retorno
    const publicDomain = process.env.RAILWAY_PUBLIC_DOMAIN || process.env.PROJECT_URL || "";
    const cleanDomain = publicDomain.startsWith("http") ? publicDomain : publicDomain ? `https://${publicDomain}` : "";

    const body: any = {
        items: [
            {
                title: title,
                quantity: quantity,
                unit_price: Number(amount),
                currency_id: "ARS"
            }
        ],
        external_reference: `${projectId || ''}:${chatId || ''}`,
        auto_return: "approved"
    };

    if (cleanDomain) {
        body.back_urls = {
            success: `${cleanDomain}/api/mercadopago/callback`,
            failure: `${cleanDomain}/api/mercadopago/callback`,
            pending: `${cleanDomain}/api/mercadopago/callback`
        };
    }

    const response = await preference.create({ body });
    return {
        initPoint: response.init_point || response.sandbox_init_point || "",
        preferenceId: response.id || ""
    };
}

/**
 * Consulta la API de Mercado Pago para verificar la existencia e información de un cobro.
 * @param paymentId ID de la operación/comprobante de Mercado Pago.
 * @param projectId ID del proyecto activo.
 */
export async function verifyMercadoPagoPayment(paymentId: string, projectId: string): Promise<any> {
    let accessToken = "";
    try {
        const { data: acc } = await supabase
            .from("mercadopago_acount_user")
            .select("access_token")
            .eq("project_id", projectId)
            .eq("is_active", true)
            .maybeSingle();
        accessToken = acc?.access_token || "";
    } catch (dbErr) {
        console.error("[MercadoPago Verify] Error fetching token from DB:", dbErr);
    }

    if (!accessToken) {
        throw new Error("No se encontró ninguna cuenta de Mercado Pago activa para este proyecto.");
    }

    const response = await axios.get(`https://api.mercadopago.com/v1/payments/${paymentId}`, {
        headers: {
            Authorization: `Bearer ${accessToken}`
        }
    });

    return response.data;
}
