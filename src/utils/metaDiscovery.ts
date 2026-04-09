import axios from 'axios';

/**
 * Utilidad para descubrir automáticamente los IDs de Meta (WABA y Phone)
 * utilizando únicamente el Access Token.
 */
export async function discoverMetaIds(accessToken: string) {
    try {
        console.log('📡 [MetaDiscovery] Iniciando descubrimiento con token...');

        let wabaId = null;
        let businesses: any[] = [];

        // 1. Intentar obtener los Negocios (Business Managers)
        try {
            const businessesResponse = await axios.get(`https://graph.facebook.com/v22.0/me/businesses`, {
                headers: { 'Authorization': `Bearer ${accessToken}` }
            });
            businesses = businessesResponse.data?.data || [];
        } catch (e: any) {
            console.warn(`⚠️ [MetaDiscovery] No se pudo acceder a me/businesses (${e.response?.data?.error?.message || e.message}). Intentando rutas secundarias...`);
        }

        // Buscar en los negocios si los obtuvimos
        for (const business of businesses) {
            try {
                const accountsResponse = await axios.get(`https://graph.facebook.com/v22.0/${business.id}/owned_whatsapp_business_accounts`, {
                    headers: { 'Authorization': `Bearer ${accessToken}` }
                });
                if (accountsResponse.data?.data && accountsResponse.data.data.length > 0) {
                    wabaId = accountsResponse.data.data[0].id;
                    break;
                }
                
                const clientResponse = await axios.get(`https://graph.facebook.com/v22.0/${business.id}/client_whatsapp_business_accounts`, {
                    headers: { 'Authorization': `Bearer ${accessToken}` }
                });
                if (clientResponse.data?.data && clientResponse.data.data.length > 0) {
                    wabaId = clientResponse.data.data[0].id;
                    break;
                }
            } catch (e) {
                // Ignorar
            }
        }

        // 2. Fallback: Intentar directamente en el usuario/sistema si no se obtuvo WABA
        if (!wabaId) {
            console.log('📡 [MetaDiscovery] Intentando buscar WABAs directamente asociadas al usuario...');
            try {
                const directOwned = await axios.get(`https://graph.facebook.com/v22.0/me/owned_whatsapp_business_accounts`, {
                    headers: { 'Authorization': `Bearer ${accessToken}` }
                });
                if (directOwned.data?.data && directOwned.data.data.length > 0) {
                    wabaId = directOwned.data.data[0].id;
                } else {
                    const directClient = await axios.get(`https://graph.facebook.com/v22.0/me/client_whatsapp_business_accounts`, {
                        headers: { 'Authorization': `Bearer ${accessToken}` }
                    });
                    if (directClient.data?.data && directClient.data.data.length > 0) {
                        wabaId = directClient.data.data[0].id;
                    }
                }
            } catch (e: any) {
                console.warn(`⚠️ [MetaDiscovery] Error en búsqueda directa: ${e.response?.data?.error?.message || e.message}`);
            }
        }

        if (!wabaId) {
            console.warn('⚠️ [MetaDiscovery] No se encontraron cuentas asociadas en absoluto.');
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
