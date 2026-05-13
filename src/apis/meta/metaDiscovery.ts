import axios from 'axios';

/**
 * Utilidad para descubrir automáticamente los IDs de Meta (WABA y Phone)
 * utilizando únicamente el Access Token.
 */
export interface DiagnosticEntry {
    step: string;
    description: string;
    status: 'success' | 'failed' | 'empty';
    details?: any;
    error?: string;
    fbtrace_id?: string;
}

export interface DiscoveryResult {
    found: boolean;
    data?: {
        wabaId: string | null;
        phoneNumberId: string | null;
        verifiedName?: string;
        status?: string;
        verificationStatus?: string;
        messagingLimit?: string;
    };
    diagnostics: DiagnosticEntry[];
}

/**
 * Utilidad para descubrir automáticamente los IDs de Meta (WABA y Phone)
 * utilizando únicamente el Access Token.
 */
export async function discoverMetaIds(accessToken: string, mainToken: string | null = null): Promise<DiscoveryResult> {
    const diagnostics: DiagnosticEntry[] = [];
    
    const logDiag = (step: string, description: string, status: 'success' | 'failed' | 'empty', details?: any, error?: any) => {
        const entry: DiagnosticEntry = {
            step,
            description,
            status,
            details: details || null,
            error: error?.response?.data?.error?.message || error?.message || null,
            fbtrace_id: error?.response?.data?.error?.fbtrace_id || null
        };
        diagnostics.push(entry);
        console.log(`[MetaDiscovery][${status.toUpperCase()}] ${step}: ${description}`);
    };

    try {
        console.log('📡 [MetaDiscovery] Iniciando descubrimiento con token de usuario...');

        // 0. Identificar quién es el usuario vinculado
        try {
            const me = await axios.get(`https://graph.facebook.com/v22.0/me?fields=name,id,email`, {
                headers: { 'Authorization': `Bearer ${accessToken}` }
            });
            logDiag('User Identification', `Usuario detectado: ${me.data.name}`, 'success', { name: me.data.name, id: me.data.id });
        } catch (meErr: any) {
            logDiag('User Identification', 'No se pudo identificar al usuario.', 'failed', null, meErr);
        }

        let wabaId = null;
        let businesses: any[] = [];

        // 1. Intentar obtener los Negocios (Business Managers)
        try {
            const businessesResponse = await axios.get(`https://graph.facebook.com/v22.0/me/businesses`, {
                headers: { 'Authorization': `Bearer ${accessToken}` }
            });
            businesses = businessesResponse.data?.data || [];
            logDiag('Business Discovery', `Se encontraron ${businesses.length} negocios.`, businesses.length > 0 ? 'success' : 'empty', businesses);
        } catch (e: any) {
            logDiag('Business Discovery', 'Error consultando me/businesses', 'failed', null, e);
        }

        // Buscar en los negocios si los obtuvimos
        for (const business of businesses) {
            try {
                const accountsResponse = await axios.get(`https://graph.facebook.com/v22.0/${business.id}/owned_whatsapp_business_accounts`, {
                    headers: { 'Authorization': `Bearer ${accessToken}` }
                });
                const owned = accountsResponse.data?.data || [];
                logDiag(`Business ${business.id}`, `Owned WABAs: ${owned.length}`, owned.length > 0 ? 'success' : 'empty', owned);
                
                if (owned.length > 0) {
                    wabaId = owned[0].id;
                    break;
                }
                
                const clientResponse = await axios.get(`https://graph.facebook.com/v22.0/${business.id}/client_whatsapp_business_accounts`, {
                    headers: { 'Authorization': `Bearer ${accessToken}` }
                });
                const client = clientResponse.data?.data || [];
                logDiag(`Business ${business.id}`, `Client WABAs: ${client.length}`, client.length > 0 ? 'success' : 'empty', client);
                
                if (client.length > 0) {
                    wabaId = client[0].id;
                    break;
                }
            } catch (e: any) {
                logDiag(`Business ${business.id} Detail`, `Búsqueda en negocio fallida`, 'failed', null, e);
            }
        }

        // 2. Fallback: Intentar obtener WABAs directamente asociadas al usuario vía 'me/whatsapp_business_accounts'
        if (!wabaId) {
            try {
                const directResponse = await axios.get(`https://graph.facebook.com/v22.0/me/whatsapp_business_accounts`, {
                    headers: { 'Authorization': `Bearer ${accessToken}` }
                });
                
                const accounts = directResponse.data?.data || [];
                if (accounts.length > 0) {
                    wabaId = accounts[0].id;
                    logDiag('Direct WABA Access', `WABA encontrado vía me/whatsapp_business_accounts: ${wabaId}`, 'success', accounts);
                } else {
                    logDiag('Direct WABA Access', 'No se encontraron WABAs en me/whatsapp_business_accounts', 'empty');
                }
            } catch (e: any) {
                logDiag('Direct WABA Access', 'Error en me/whatsapp_business_accounts', 'failed', null, e);
            }
        }

        // 3. Fallback: Intentar directamente en el usuario/sistema si no se obtuvo WABA (campos genéricos)
        if (!wabaId) {
            try {
                const directResponse = await axios.get(`https://graph.facebook.com/v22.0/me?fields=id,name,whatsapp_business_accounts,owned_whatsapp_business_accounts,client_whatsapp_business_accounts`, {
                    headers: { 'Authorization': `Bearer ${accessToken}` }
                });
                
                const data = directResponse.data;
                const accounts = data.whatsapp_business_accounts?.data || 
                                 data.owned_whatsapp_business_accounts?.data || 
                                 data.client_whatsapp_business_accounts?.data || [];

                if (accounts.length > 0) {
                    wabaId = accounts[0].id;
                    logDiag('Me Fields Discovery', `WABA encontrado vía campos directos: ${wabaId}`, 'success', accounts);
                } else {
                    logDiag('Me Fields Discovery', 'No se encontraron WABAs en campos directos de me', 'empty');
                }
            } catch (e: any) {
                logDiag('Me Fields Discovery', 'Error en búsqueda directa por campos de me', 'failed', null, e);
            }
        }

        // 4. Fallback Final: Debug Token para obtener contexto de la App
        if (!wabaId) {
            try {
                const appToken = `${process.env.META_APP_ID}|${process.env.META_APP_SECRET}`;
                const debugResponse = await axios.get(`https://graph.facebook.com/v22.0/debug_token`, {
                    params: {
                        input_token: accessToken,
                        access_token: appToken
                    }
                });
                
                const debugData = debugResponse.data.data;
                logDiag('Debug Token Path', `Token Info: AppID=${debugData.app_id}, UserID=${debugData.user_id}`, 'success', debugData);
                
                let businessId = debugData.business_id;
                
                // Buscar IDs en scopes granulares si no hay business_id directo
                if (!businessId && debugData.granular_scopes) {
                    // Buscar Business ID
                    const bizScope = debugData.granular_scopes.find((s: any) => s.scope === 'business_management');
                    if (bizScope && bizScope.target_ids && bizScope.target_ids.length > 0) {
                        businessId = bizScope.target_ids[0];
                        logDiag('Debug Token Path', `Business ID detectado en scopes: ${businessId}`, 'info');
                    }
                    
                    // Buscar WABA ID directamente
                    const wabaScope = debugData.granular_scopes.find((s: any) => s.scope === 'whatsapp_business_management');
                    if (wabaScope && wabaScope.target_ids && wabaScope.target_ids.length > 0) {
                        const potentialWabaId = wabaScope.target_ids[0];
                        if (!wabaId) {
                            wabaId = potentialWabaId;
                            logDiag('Debug Token Path', `WABA ID detectado en scopes: ${wabaId}`, 'info');
                        }
                    }
                }

                if (businessId) {
                    const bizWabas = await axios.get(`https://graph.facebook.com/v22.0/${businessId}/whatsapp_business_accounts`, {
                        headers: { 'Authorization': `Bearer ${accessToken}` }
                    });
                    if (bizWabas.data?.data && bizWabas.data.data.length > 0) {
                        wabaId = bizWabas.data.data[0].id;
                        logDiag('Debug Token Business', `WABA encontrado vía Business ID ${businessId}: ${wabaId}`, 'success');
                    } else {
                        logDiag('Debug Token Business', `No se encontraron WABAs para el Business ID ${businessId}`, 'empty');
                    }
                }
            } catch (e: any) {
                logDiag('Debug Token Path', 'Error en debug_token o búsqueda por Business ID', 'failed', null, e);
            }
        }

        // 5. SUPER FALLBACK: Si tenemos un mainToken (Super User), buscar WABAs en TODO el portafolio
        if (!wabaId && mainToken) {
            try {
                const mainBizRes = await axios.get(`https://graph.facebook.com/v22.0/me/businesses`, {
                    headers: { 'Authorization': `Bearer ${mainToken}` }
                });
                
                if (mainBizRes.data?.data) {
                    for (const biz of mainBizRes.data.data) {
                        const clientWabas = await axios.get(`https://graph.facebook.com/v22.0/${biz.id}/client_whatsapp_business_accounts`, {
                            headers: { 'Authorization': `Bearer ${mainToken}` }
                        });
                        
                        if (clientWabas.data?.data?.[0]) {
                            wabaId = clientWabas.data.data[0].id;
                            logDiag('Main Token Fallback', `WABA encontrado en Portafolio vía Client WABA: ${wabaId}`, 'success');
                            break;
                        }

                        const bizWabas = await axios.get(`https://graph.facebook.com/v22.0/${biz.id}/whatsapp_business_accounts`, {
                            headers: { 'Authorization': `Bearer ${mainToken}` }
                        });
                        if (bizWabas.data?.data?.[0]) {
                            wabaId = bizWabas.data.data[0].id;
                            logDiag('Main Token Fallback', `WABA encontrado en Portafolio vía Business Account: ${wabaId}`, 'success');
                            break;
                        }
                    }
                }
            } catch (superErr: any) {
                logDiag('Main Token Fallback', 'Super-Fallback falló', 'failed', null, superErr);
            }
        }

        if (!wabaId) {
            return { found: false, diagnostics };
        }

        // Obtener el Phone Number ID
        let phoneNumberId = null;
        let verifiedName = "";
        try {
            const phoneResponse = await axios.get(`https://graph.facebook.com/v22.0/${wabaId}/phone_numbers`, {
                headers: { 'Authorization': `Bearer ${accessToken}` }
            });
            const phoneData = phoneResponse.data.data?.[0];
            if (phoneData) {
                phoneNumberId = phoneData.id;
                verifiedName = phoneData.verified_name || "Nombre pendiente";
                logDiag('Phone ID Discovery', `Phone ID detectado: ${phoneNumberId} (${verifiedName})`, 'success', phoneData);
            } else {
                logDiag('Phone ID Discovery', `No se encontraron números en la WABA ${wabaId}`, 'empty');
            }
        } catch (phoneErr: any) {
            logDiag('Phone ID Discovery', `Error consultando números de la WABA ${wabaId}`, 'failed', null, phoneErr);
        }

        let verificationStatus = 'unknown';
        let messagingLimit = 'unknown';

        if (wabaId) {
            try {
                const wabaStatus = await getWabaStatus(wabaId, accessToken);
                verificationStatus = wabaStatus.verification_status;
            } catch (e) {
                /* ignore failure to fetch extended status */
            }
        }

        if (phoneNumberId) {
            try {
                const limitInfo = await getPhoneLimit(phoneNumberId, accessToken);
                messagingLimit = limitInfo.messaging_limit_tier;
            } catch (e) {
                /* ignore failure to fetch limit info */
            }
        }

        return {
            found: !!phoneNumberId,
            data: {
                wabaId,
                phoneNumberId,
                verifiedName,
                status: 'active',
                verificationStatus,
                messagingLimit
            },
            diagnostics
        };
    } catch (error: any) {
        logDiag('General Discovery Flow', 'Error crítico durante el descubrimiento', 'failed', null, error);
        return { found: false, diagnostics };
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

/**
 * Consulta el estado de verificación de la WABA
 * Requiere permiso business_management
 */
export async function getWabaStatus(wabaId: string, accessToken: string) {
    try {
        const response = await axios.get(`https://graph.facebook.com/v22.0/${wabaId}`, {
            params: {
                fields: 'id,name,account_review_status,timezone_id,message_template_namespace',
                access_token: accessToken
            }
        });
        return response.data;
    } catch (error: any) {
        console.error('❌ [MetaDiscovery] Error consultando estado WABA:', error.response?.data || error.message);
        throw error;
    }
}

/**
 * Consulta el límite de mensajería del número de teléfono
 */
export async function getPhoneLimit(phoneId: string, accessToken: string) {
    try {
        const response = await axios.get(`https://graph.facebook.com/v22.0/${phoneId}`, {
            params: {
                fields: 'id,messaging_limit_tier,display_phone_number,quality_rating',
                access_token: accessToken
            }
        });
        return response.data;
    } catch (error: any) {
        console.error('❌ [MetaDiscovery] Error consultando límites del teléfono:', error.response?.data || error.message);
        throw error;
    }
}
