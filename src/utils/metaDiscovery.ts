import axios from 'axios';

/**
 * Utilidad para descubrir automáticamente los IDs de Meta (WABA y Phone)
 * utilizando únicamente el Access Token.
 */
export async function discoverMetaIds(accessToken: string) {
    try {
        console.log('📡 [MetaDiscovery] Iniciando descubrimiento con token...');

        // 1. Obtener el WABA ID (WhatsApp Business Account)
        // Consultamos las cuentas de Whatsapp Business asociadas al token
        const wabaResponse = await axios.get(`https://graph.facebook.com/v22.0/me/client_whatsapp_business_accounts`, {
            headers: { 'Authorization': `Bearer ${accessToken}` }
        });

        const wabaData = wabaResponse.data.data?.[0]; // Tomamos la primera cuenta disponible
        if (!wabaData) {
            console.warn('⚠️ [MetaDiscovery] No se encontraron cuentas de WhatsApp Business asociadas a este token.');
            return null;
        }

        const wabaId = wabaData.id;
        console.log(`✅ [MetaDiscovery] WABA ID detectado: ${wabaId}`);

        // 2. Obtener el Phone Number ID
        // Consultamos los números de teléfono de esa WABA
        const phoneResponse = await axios.get(`https://graph.facebook.com/v22.0/${wabaId}/phone_numbers`, {
            headers: { 'Authorization': `Bearer ${accessToken}` }
        });

        const phoneData = phoneResponse.data.data?.[0]; // Tomamos el primer número
        if (!phoneData) {
            console.warn(`⚠️ [MetaDiscovery] No se encontraron números de teléfono en la WABA ${wabaId}.`);
            return { wabaId, phoneNumberId: null };
        }

        const phoneNumberId = phoneData.id;
        const verifiedName = phoneData.verified_name;

        console.log(`✅ [MetaDiscovery] Phone ID detectado: ${phoneNumberId} (${verifiedName})`);

        return {
            wabaId,
            phoneNumberId,
            verifiedName,
            status: 'active'
        };
    } catch (error: any) {
        console.error('❌ [MetaDiscovery] Error durante el descubrimiento:', error.response?.data || error.message);
        return null;
    }
}
