import axios from 'axios';

/**
 * Utilidad para descubrir y suscribir Páginas de Facebook (Messenger/Instagram)
 */
export async function discoverAndLinkMetaPages(userAccessToken: string) {
    try {
        console.log('📡 [MetaPageDiscovery] Buscando páginas vinculadas...');

        // 1. Obtener lista de páginas del usuario (incluyendo cuentas de Instagram vinculadas)
        const pagesResponse = await axios.get(`https://graph.facebook.com/v22.0/me/accounts`, {
            params: { 
                access_token: userAccessToken, 
                fields: 'id,name,access_token,instagram_business_account' 
            }
        });

        const pages = pagesResponse.data?.data || [];
        if (pages.length === 0) {
            console.warn('⚠️ [MetaPageDiscovery] No se encontraron páginas de Facebook.');
            return null;
        }

        // Tomamos la primera página para la configuración automática
        const mainPage = pages[0];
        const pageId = mainPage.id;
        const pageAccessToken = mainPage.access_token;
        const instagramId = mainPage.instagram_business_account?.id;

        console.log(`✅ [MetaPageDiscovery] Página detectada: ${mainPage.name} (${pageId})`);
        if (instagramId) {
            console.log(`✅ [MetaPageDiscovery] Instagram detectado: ${instagramId}`);
        }

        // 2. Suscribir la APP a los Webhooks de la Página
        console.log(`📡 [MetaPageDiscovery] Suscribiendo App a la página ${pageId} e Instagram...`);
        try {
            await axios.post(`https://graph.facebook.com/v22.0/${pageId}/subscribed_apps`, 
                { 
                    subscribed_fields: [
                        'messages', 
                        'messaging_postbacks', 
                        'messaging_optins', 
                        'message_echoes',
                        'instagram_manage_messages' // Para suscripción de IG
                    ] 
                }, 
                { params: { access_token: pageAccessToken } }
            );
            console.log(`✅ [MetaPageDiscovery] Suscripción exitosa para la página ${pageId}.`);
        } catch (subErr: any) {
            console.error(`❌ [MetaPageDiscovery] Error suscribiendo página:`, subErr.response?.data || subErr.message);
        }

        return {
            pageId,
            pageAccessToken,
            pageName: mainPage.name,
            instagramId: instagramId // Retornamos el ID de Instagram si lo encontramos
        };
    } catch (error: any) {
        console.error('❌ [MetaPageDiscovery] Error durante el descubrimiento de páginas:', error.response?.data || error.message);
        return null;
    }
}
