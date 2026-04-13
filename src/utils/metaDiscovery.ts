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

        // 2. Fallback: Intentar obtener WABAs directamente asociadas al usuario vía 'me/whatsapp_business_accounts'
        if (!wabaId) {
            console.log('📡 [MetaDiscovery] Intentando buscar WABAs directamente asociadas al usuario vía endpoint específico...');
            try {
                const directResponse = await axios.get(`https://graph.facebook.com/v22.0/me/whatsapp_business_accounts`, {
                    headers: { 'Authorization': `Bearer ${accessToken}` }
                });
                
                const accounts = directResponse.data?.data || [];
                if (accounts.length > 0) {
                    wabaId = accounts[0].id;
                    console.log(`✅ [MetaDiscovery] WABA encontrado vía 'me/whatsapp_business_accounts': ${wabaId}`);
                }
            } catch (e: any) {
                console.warn(`⚠️ [MetaDiscovery] Error en me/whatsapp_business_accounts: ${e.response?.data?.error?.message || e.message}`);
            }
        }

        // 3. Fallback: Intentar directamente en el usuario/sistema si no se obtuvo WABA (campos genéricos)
        if (!wabaId) {
            console.log('📡 [MetaDiscovery] Intentando buscar WABAs directamente asociadas al usuario vía campos...');
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

        // 4. Fallback final: Intentar ver si el usuario tiene algún Business ID vía /me/businesses (requiere business_management, pero a veces devuelve algo con whatsapp_business_management)
        if (!wabaId) {
            try {
                console.log('📡 [MetaDiscovery] Intentando buscar Businesses del usuario...');
                const bizRes = await axios.get(`https://graph.facebook.com/v22.0/me/businesses`, {
                    headers: { 'Authorization': `Bearer ${accessToken}` }
                });
                if (bizRes.data?.data) {
                    for (const biz of bizRes.data.data) {
                        const wRes = await axios.get(`https://graph.facebook.com/v22.0/${biz.id}/whatsapp_business_accounts`, {
                            headers: { 'Authorization': `Bearer ${accessToken}` }
                        });
                        if (wRes.data?.data?.[0]) {
                            wabaId = wRes.data.data[0].id;
                            console.log(`✅ [MetaDiscovery] WABA encontrado vía Business ${biz.id}: ${wabaId}`);
                            break;
                        }
                    }
                }
            } catch (e) {}
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

/**
 * Paso 1: Añadir un número de teléfono a la WABA.
 * Esto genera un Phone ID en Meta.
 */
export async function addPhoneNumberToWaba(accessToken: string, wabaId: string, phoneNumber: string, verifiedName: string) {
    try {
        // Limpiar número: debe ser solo dígitos (ej: 549116244...)
        const cleanNumber = phoneNumber.replace(/[^0-9]/g, '');
        
        // Meta requiere CC (country code) y el número por separado.
        // Intentamos inferir (este es un macheo básico, en producción el front debería enviarlos separados)
        // Ejemplo simple: Argentina 54, España 34, etc.
        let cc = "54"; // Default simple
        let number = cleanNumber;
        if (cleanNumber.startsWith("54")) { cc = "54"; number = cleanNumber.substring(2); }
        else if (cleanNumber.startsWith("34")) { cc = "34"; number = cleanNumber.substring(2); }
        else if (cleanNumber.length > 10) { 
            cc = cleanNumber.substring(0, 2); 
            number = cleanNumber.substring(2); 
        }

        console.log(`📡 [MetaDiscovery] Añadiendo número ${cc}${number} a WABA ${wabaId}...`);
        
        const response = await axios.post(`https://graph.facebook.com/v22.0/${wabaId}/phone_numbers`, {
            cc,
            phone_number: number,
            verified_name: verifiedName
        }, { headers: { 'Authorization': `Bearer ${accessToken}` } });

        return response.data; // { id: "PHONE_ID" }
    } catch (error: any) {
        console.error('❌ [MetaDiscovery] Error añadiendo número:', error.response?.data || error.message);
        throw error;
    }
}

/**
 * Paso 2: Solicitar código de verificación (OTP) vía SMS o VOZ
 */
export async function requestPhoneNumberOtp(accessToken: string, phoneId: string, method: 'SMS' | 'VOICE' = 'SMS') {
    try {
        console.log(`📡 [MetaDiscovery] Solicitando OTP (${method}) para Phone ID ${phoneId}...`);
        const response = await axios.post(`https://graph.facebook.com/v22.0/${phoneId}/request_code`, {
            code_method: method,
            language: 'es_ES'
        }, { headers: { 'Authorization': `Bearer ${accessToken}` } });

        return response.data;
    } catch (error: any) {
        console.error('❌ [MetaDiscovery] Error solicitando OTP:', error.response?.data || error.message);
        throw error;
    }
}

/**
 * Paso 3: Verificar el código y activar el número
 */
export async function verifyPhoneNumberOtp(accessToken: string, phoneId: string, code: string) {
    try {
        console.log(`📡 [MetaDiscovery] Verificando OTP para Phone ID ${phoneId}...`);
        const response = await axios.post(`https://graph.facebook.com/v22.0/${phoneId}/verify_code`, {
            code: code
        }, { headers: { 'Authorization': `Bearer ${accessToken}` } });

        // Si la verificación es exitosa, registramos el número en la plataforma de WhatsApp
        if (response.data.success) {
            await axios.post(`https://graph.facebook.com/v22.0/${phoneId}/register`, {
                messaging_product: 'whatsapp',
                pin: '123456' // PIN de seguridad por defecto
            }, { headers: { 'Authorization': `Bearer ${accessToken}` } });
        }

        return response.data;
    } catch (error: any) {
        console.error('❌ [MetaDiscovery] Error verificando OTP:', error.response?.data || error.message);
        throw error;
    }
}
