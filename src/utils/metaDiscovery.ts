import axios from 'axios';

/**
 * Utilidad para descubrir automáticamente los IDs de Meta (WABA y Phone)
 * utilizando únicamente el Access Token.
 */
export async function discoverMetaIds(accessToken: string) {
    try {
        console.log('📡 [MetaDiscovery] Iniciando descubrimiento con token...');

        // 1. Obtener los Negocios (Business Managers) del usuario
        // Un usuario no tiene "Cuentas de WhatsApp" directamente, las tienen sus negocios.
        const businessesResponse = await axios.get(`https://graph.facebook.com/v22.0/me/businesses`, {
            headers: { 'Authorization': `Bearer ${accessToken}` }
        });

        const businesses = businessesResponse.data.data;
        if (!businesses || businesses.length === 0) {
            console.warn('⚠️ [MetaDiscovery] El usuario no pertenece a ningún Business Manager.');
            return null;
        }

        let wabaId = null;

        // Buscar en todos los negocios alguna WABA (ya sea propia o compartida)
        for (const business of businesses) {
            try {
                // Buscamos WABAs compartidas/propias
                const accountsResponse = await axios.get(`https://graph.facebook.com/v22.0/${business.id}/owned_whatsapp_business_accounts`, {
                    headers: { 'Authorization': `Bearer ${accessToken}` }
                });
                if (accountsResponse.data.data && accountsResponse.data.data.length > 0) {
                    wabaId = accountsResponse.data.data[0].id;
                    break;
                }
                
                const clientResponse = await axios.get(`https://graph.facebook.com/v22.0/${business.id}/client_whatsapp_business_accounts`, {
                    headers: { 'Authorization': `Bearer ${accessToken}` }
                });
                if (clientResponse.data.data && clientResponse.data.data.length > 0) {
                    wabaId = clientResponse.data.data[0].id;
                    break;
                }
            } catch (e) {
                // Ignorar si un negocio da error de permisos
            }
        }

        if (!wabaId) {
            console.warn('⚠️ [MetaDiscovery] No se encontraron cuentas de WhatsApp Business asociadas a los negocios de este usuario.');
            return null;
        }

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
