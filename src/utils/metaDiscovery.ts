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
                // Probamos campos directos que a veces funcionan dependiendo del tipo de token
                const directResponse = await axios.get(`https://graph.facebook.com/v22.0/me?fields=id,name,whatsapp_business_accounts,owned_whatsapp_business_accounts,client_whatsapp_business_accounts`, {
                    headers: { 'Authorization': `Bearer ${accessToken}` }
                });
                
                const data = directResponse.data;
                const accounts = data.whatsapp_business_accounts?.data || 
                                 data.owned_whatsapp_business_accounts?.data || 
                                 data.client_whatsapp_business_accounts?.data || [];

                if (accounts.length > 0) {
                    wabaId = accounts[0].id;
                    console.log(`✅ [MetaDiscovery] WABA encontrado vía campos directos en 'me': ${wabaId}`);
                }
            } catch (e: any) {
                console.warn(`⚠️ [MetaDiscovery] Error en búsqueda directa por campos: ${e.response?.data?.error?.message || e.message}`);
            }
        }

        // 3. Fallback Final: Debug Token para obtener contexto de la App
        if (!wabaId) {
            console.log('📡 [MetaDiscovery] Intentando obtener información vía debug_token...');
            try {
                // Necesitamos el App Token (AppID|AppSecret)
                const appToken = `${process.env.META_APP_ID}|${process.env.META_APP_SECRET}`;
                const debugResponse = await axios.get(`https://graph.facebook.com/v22.0/debug_token`, {
                    params: {
                        input_token: accessToken,
                        access_token: appToken
                    }
                });
                
                const debugData = debugResponse.data.data;
                console.log(`ℹ️ [MetaDiscovery] Token Info: AppID=${debugData.app_id}, UserID=${debugData.user_id}, Scopes=${debugData.scopes?.join(',')}`);
                
                // Si el debug token nos da el Business ID, podemos buscar WABAs ahí
                const businessId = debugData.business_id;
                if (businessId) {
                    console.log(`📡 [MetaDiscovery] Buscando WABAs para el Business ID: ${businessId}...`);
                    const bizWabas = await axios.get(`https://graph.facebook.com/v22.0/${businessId}/whatsapp_business_accounts`, {
                        headers: { 'Authorization': `Bearer ${accessToken}` }
                    });
                    if (bizWabas.data?.data && bizWabas.data.data.length > 0) {
                        wabaId = bizWabas.data.data[0].id;
                        console.log(`✅ [MetaDiscovery] WABA encontrado vía Business ID del Token: ${wabaId}`);
                    }
                }
            } catch (e: any) {
                console.warn(`⚠️ [MetaDiscovery] Error en debug_token o búsqueda por Business ID: ${e.response?.data?.error?.message || e.message}`);
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
