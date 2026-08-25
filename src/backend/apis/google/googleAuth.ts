import { google } from "googleapis";
import { DefaultTransporter } from "google-auth-library";
import type { GaxiosOptions, GaxiosPromise } from "gaxios";
import "dotenv/config";

// Obtener la URL del proxy de Google desde el entorno, o usar el predeterminado
const envGoogleProxy = process.env.GOOGLE_PROXY_URL;
// Por defecto usar nuestro proxy para evitar caídas en producción, excepto si se define 'direct'
const googleProxyUrl = envGoogleProxy === 'direct' ? null : (envGoogleProxy || "https://google-proxy.duskcodes.com.ar");

if (googleProxyUrl) {
    console.log(`🔌 [GoogleAuth] Configurando proxy global de Google a: ${googleProxyUrl}`);
    const originalRequest = DefaultTransporter.prototype.request;
    DefaultTransporter.prototype.request = function <T>(opts: GaxiosOptions): GaxiosPromise<T> {
        const mutableOpts = opts as GaxiosOptions & { url?: string; headers?: Record<string, string> };
        if (mutableOpts.url) {
            const originalUrlStr = String(mutableOpts.url);
            let targetHost = "www.googleapis.com";
            
            try {
                const parsed = new URL(originalUrlStr);
                targetHost = parsed.host;
            } catch (e) {
                // fallback
            }

            // Reemplazar subdominios conocidos de Google por el proxy
            mutableOpts.url = originalUrlStr.replace("https://www.googleapis.com", googleProxyUrl);
            mutableOpts.url = mutableOpts.url.replace("https://oauth2.googleapis.com", googleProxyUrl);
            mutableOpts.url = mutableOpts.url.replace("https://sheets.googleapis.com", googleProxyUrl);
            mutableOpts.url = mutableOpts.url.replace("https://calendar.googleapis.com", googleProxyUrl);
            mutableOpts.url = mutableOpts.url.replace("https://drive.googleapis.com", googleProxyUrl);
            mutableOpts.url = mutableOpts.url.replace("https://docs.googleapis.com", googleProxyUrl);

            if (mutableOpts.url !== originalUrlStr) {
                mutableOpts.headers = mutableOpts.headers || {};
                mutableOpts.headers["x-target-host"] = targetHost;
                console.log(`[Google Proxy] Interceptado: ${originalUrlStr} -> ${mutableOpts.url} (Destino: ${targetHost})`);
            }
        }
        return originalRequest.call(this, mutableOpts) as GaxiosPromise<T>;
    };
}


/**
 * Obtiene la clave privada de Google limpia de las variables de entorno.
 * Maneja comillas circundantes y saltos de línea escapados.
 */
export const getGooglePrivateKey = (): string => {
    let rawKey = process.env.GOOGLE_PRIVATE_KEY || "";
    
    // 1. Quitar comillas si el string viene envuelto en ellas (común en Railway/Docker/.env)
    if (rawKey.startsWith('"') && rawKey.endsWith('"')) {
        rawKey = rawKey.slice(1, -1);
    }
    
    // 2. Reemplazar los saltos de línea literales '\n' por caracteres de salto de línea reales
    // y asegurar que no haya espacios extras al inicio/final de cada línea
    return rawKey.replace(/\\n/g, '\n').trim();
};

export const getGoogleCredentials = async (projectId?: string | null, serviceId?: string | null) => {
    let clientEmail = process.env.GOOGLE_CLIENT_EMAIL;
    let privateKey = getGooglePrivateKey();

    if (!clientEmail || !privateKey) {
        try {
            const { HistoryHandler, supabase } = await import("../../db/historyHandler");
            if (projectId) {
                clientEmail = (await HistoryHandler.getSetting('GOOGLE_CLIENT_EMAIL', projectId, serviceId)) || clientEmail;
                privateKey = (await HistoryHandler.getSetting('GOOGLE_PRIVATE_KEY', projectId, serviceId)) || privateKey;
            }
            if (!clientEmail || !privateKey) {
                if (supabase) {
                    const { data } = await supabase
                        .from('settings')
                        .select('key, value')
                        .eq('project_id', 'defaul')
                        .in('key', ['GOOGLE_CLIENT_EMAIL', 'GOOGLE_PRIVATE_KEY']);
                    if (data) {
                        for (const s of data) {
                            if (s.key === 'GOOGLE_CLIENT_EMAIL' && !clientEmail) clientEmail = s.value;
                            if (s.key === 'GOOGLE_PRIVATE_KEY' && !privateKey) privateKey = s.value;
                        }
                    }
                }
            }
            if (clientEmail && !process.env.GOOGLE_CLIENT_EMAIL) process.env.GOOGLE_CLIENT_EMAIL = clientEmail;
            if (privateKey && !process.env.GOOGLE_PRIVATE_KEY) process.env.GOOGLE_PRIVATE_KEY = privateKey;
        } catch (e) {
            console.warn('[GoogleAuth] Error cargando credenciales desde DB:', e);
        }
    }

    if (privateKey) {
        if (privateKey.startsWith('"') && privateKey.endsWith('"')) {
            privateKey = privateKey.slice(1, -1);
        }
        privateKey = privateKey.replace(/\\n/g, '\n').trim();
    }

    return {
        client_email: clientEmail,
        private_key: privateKey,
    };
};

/**
 * Crea una instancia de autenticación de Google con los scopes necesarios.
 * @param scopes Lista de scopes de Google API
 */
export const createGoogleAuth = (scopes: string[], projectId?: string | null, serviceId?: string | null) => {
    const rawKey = getGooglePrivateKey();
    const clientEmail = process.env.GOOGLE_CLIENT_EMAIL;

    return new google.auth.GoogleAuth({
        credentials: {
            client_email: clientEmail,
            private_key: rawKey,
        },
        scopes: scopes,
    });
};

/**
 * Crea una instancia de autenticación de Google de forma asíncrona resolviendo credenciales de DB si faltan en env.
 */
export const createGoogleAuthAsync = async (scopes: string[], projectId?: string | null, serviceId?: string | null) => {
    const creds = await getGoogleCredentials(projectId, serviceId);
    
    if (!creds.private_key || !creds.client_email) {
        console.warn("⚠️ [GoogleAuth] La clave privada o email de Google están vacíos.");
    }

    return new google.auth.GoogleAuth({
        credentials: {
            client_email: creds.client_email,
            private_key: creds.private_key,
        },
        scopes: scopes,
    });
};
