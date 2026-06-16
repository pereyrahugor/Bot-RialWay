import { MercadoPagoConfig, Preference } from "mercadopago";
import { HistoryHandler } from "../db/historyHandler";

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
    projectId: string | null = null
): Promise<{ initPoint: string; preferenceId: string }> {
    let accessToken = await HistoryHandler.getSetting("MP_ACCESS_TOKEN", projectId);
    if (!accessToken) {
        accessToken = process.env.MP_TOKEN_TEST || process.env.MP_ACCESS_TOKEN || "";
    }
    if (!accessToken) {
        throw new Error("Mercado Pago no está configurado. Token de acceso faltante.");
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
