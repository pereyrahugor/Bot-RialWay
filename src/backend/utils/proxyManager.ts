import { anonymizeProxy, closeAnonymizedProxy } from 'proxy-chain';
import axios from 'axios';
import { HistoryHandler } from '../db/historyHandler';

export interface ProxySession {
    proxyUrl: string;
    rawProxy?: string;
    cleanup: () => Promise<void>;
}

export class ProxyManager {
    /**
     * Obtiene una sesión de proxy (localmente anonimizada mediante proxy-chain) para un cliente/módulo específico
     * o a nivel global.
     * 
     * Prioridad de configuración:
     * 1. Proxy explícito por cliente: [CLIENT]_PROXY_URL (ej: GANAMOSNET_PROXY_URL)
     * 2. Webshare API Key por cliente: [CLIENT]_WEBSHARE_API_KEY (ej: GANAMOSNET_WEBSHARE_API_KEY)
     * 3. Proxy explícito global: GLOBAL_PROXY_URL o PROXY_URL
     * 4. Webshare API Key global: WEBSHARE_API_KEY
     * 
     * @param clientSlug Identificador del cliente (ej: 'ganemos-net', 'cas-epc', etc.)
     */
    public static async getProxySession(clientSlug?: string): Promise<ProxySession | null> {
        try {
            const prefix = clientSlug ? clientSlug.toUpperCase().replace(/[^A-Z0-9]/g, '_') : '';
            const altPrefix = prefix.includes('_') ? prefix.split('_')[0] : prefix;

            // 1. Verificar si hay un PROXY_URL estático configurado para el cliente
            let proxyUrl = prefix ? (await HistoryHandler.getConfig(`${prefix}_PROXY_URL`) || process.env[`${prefix}_PROXY_URL`]) : null;
            if (!proxyUrl && altPrefix && altPrefix !== prefix) {
                proxyUrl = await HistoryHandler.getConfig(`${altPrefix}_PROXY_URL`) || process.env[`${altPrefix}_PROXY_URL`];
            }

            // 2. Verificar Webshare API Key para el cliente
            let webshareApiKey = prefix ? (await HistoryHandler.getConfig(`${prefix}_WEBSHARE_API_KEY`) || process.env[`${prefix}_WEBSHARE_API_KEY`]) : null;
            if (!webshareApiKey && altPrefix && altPrefix !== prefix) {
                webshareApiKey = await HistoryHandler.getConfig(`${altPrefix}_WEBSHARE_API_KEY`) || process.env[`${altPrefix}_WEBSHARE_API_KEY`];
            }

            // 3. Fallback a configuración global si no hay específica del cliente
            if (!proxyUrl && !webshareApiKey) {
                proxyUrl = await HistoryHandler.getConfig('PROXY_URL') || process.env.PROXY_URL || null;
                webshareApiKey = await HistoryHandler.getConfig('WEBSHARE_API_KEY') || process.env.WEBSHARE_API_KEY || null;
            }

            // 4. Fallback al proyecto maestro de referencia
            if (!proxyUrl && !webshareApiKey) {
                proxyUrl = await HistoryHandler.getSetting(`${prefix}_PROXY_URL`, '79cbfba7-d278-4298-84d3-a29ad021b579') 
                    || await HistoryHandler.getSetting('PROXY_URL', '79cbfba7-d278-4298-84d3-a29ad021b579');
                webshareApiKey = await HistoryHandler.getSetting(`${prefix}_WEBSHARE_API_KEY`, '79cbfba7-d278-4298-84d3-a29ad021b579') 
                    || await HistoryHandler.getSetting('WEBSHARE_API_KEY', '79cbfba7-d278-4298-84d3-a29ad021b579');
            }

            // Si hay Webshare API Key, consultar la lista dinámica
            if (!proxyUrl && webshareApiKey) {
                proxyUrl = await this.fetchProxyFromWebshareApi(webshareApiKey);
            }

            if (!proxyUrl || !proxyUrl.trim()) {
                console.log(`ℹ️ [ProxyManager] No hay proxy configurado para el cliente '${clientSlug || 'global'}'.`);
                return null;
            }

            const cleanRawProxy = proxyUrl.trim();
            console.log(`🔌 [ProxyManager] Configurando sesión de proxy para '${clientSlug || 'global'}'...`);

            // Si el proxy requiere credenciales (usuario:pass@ip:port), usar proxy-chain
            if (cleanRawProxy.includes('@')) {
                const anonymizedLocalUrl = await anonymizeProxy(cleanRawProxy);
                console.log(`🔌 [ProxyManager] Túnel local anónimo creado en ${anonymizedLocalUrl}`);
                return {
                    proxyUrl: anonymizedLocalUrl,
                    rawProxy: cleanRawProxy,
                    cleanup: async () => {
                        try {
                            await closeAnonymizedProxy(anonymizedLocalUrl, true);
                            console.log(`🔌 [ProxyManager] Túnel local ${anonymizedLocalUrl} cerrado.`);
                        } catch (e: any) {
                            console.warn('[ProxyManager] Error cerrando túnel anónimo:', e.message);
                        }
                    }
                };
            }

            // Si es un proxy HTTP/SOCKS sin auth (ip:port o http://ip:port)
            return {
                proxyUrl: cleanRawProxy.startsWith('http') ? cleanRawProxy : `http://${cleanRawProxy}`,
                rawProxy: cleanRawProxy,
                cleanup: async () => {}
            };

        } catch (err: any) {
            console.error('[ProxyManager] Error obteniendo sesión de proxy:', err.message || err);
            return null;
        }
    }

    /**
     * Consulta la API de Webshare para obtener un proxy activo
     */
    private static async fetchProxyFromWebshareApi(apiKey: string): Promise<string | null> {
        try {
            console.log('📡 [ProxyManager] Consultando Webshare API para obtener proxy activo...');
            const response = await axios.get('https://proxy.webshare.io/api/v2/proxy/list/?mode=direct&page=1&page_size=25', {
                headers: { Authorization: `Token ${apiKey.trim()}` },
                timeout: 7000
            });

            const results = response.data?.results || [];
            const validProxies = results.filter((p: any) => p.valid);

            if (validProxies.length === 0) {
                console.warn('[ProxyManager] No se encontraron proxies válidos/activos en la cuenta de Webshare.');
                return null;
            }

            // Seleccionar uno de los proxies válidos aleatoriamente
            const selected = validProxies[Math.floor(Math.random() * validProxies.length)];
            const rawUrl = `http://${selected.username}:${selected.password}@${selected.proxy_address}:${selected.port}`;
            console.log(`📡 [ProxyManager] Proxy obtenido de Webshare API: ${selected.proxy_address}:${selected.port} (${selected.country_code})`);
            return rawUrl;
        } catch (err: any) {
            console.error('[ProxyManager] Error al consultar la API de Webshare:', err.message);
            return null;
        }
    }
}
