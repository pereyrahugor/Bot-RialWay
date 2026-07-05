import { google } from "googleapis";
import { DefaultTransporter } from "google-auth-library";
import "dotenv/config";

// Obtener la URL del proxy de Google desde el entorno, o usar el predeterminado
const envGoogleProxy = process.env.GOOGLE_PROXY_URL;
// Por defecto usar nuestro proxy para evitar caídas en producción, excepto si se define 'direct'
const googleProxyUrl = envGoogleProxy === 'direct' ? null : (envGoogleProxy || "https://google-proxy.duskcodes.com.ar");

if (googleProxyUrl) {
    console.log(`🔌 [GoogleAuth] Configurando proxy global de Google a: ${googleProxyUrl}`);
    const originalRequest = DefaultTransporter.prototype.request;
    DefaultTransporter.prototype.request = function (opts: any) {
        if (opts.url) {
            const originalUrlStr = opts.url;
            let targetHost = "www.googleapis.com";
            
            try {
                const parsed = new URL(originalUrlStr);
                targetHost = parsed.host;
            } catch (e) {
                // fallback
            }

            // Reemplazar subdominios conocidos de Google por el proxy
            opts.url = opts.url.replace("https://www.googleapis.com", googleProxyUrl);
            opts.url = opts.url.replace("https://oauth2.googleapis.com", googleProxyUrl);
            opts.url = opts.url.replace("https://sheets.googleapis.com", googleProxyUrl);
            opts.url = opts.url.replace("https://calendar.googleapis.com", googleProxyUrl);
            opts.url = opts.url.replace("https://drive.googleapis.com", googleProxyUrl);

            if (opts.url !== originalUrlStr) {
                opts.headers = opts.headers || {};
                opts.headers["x-target-host"] = targetHost;
                console.log(`🌐 [Google Proxy] Interceptado: ${originalUrlStr} -> ${opts.url} (Destino: ${targetHost})`);
            }
        }
        return originalRequest.call(this, opts);
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

/**
 * Retorna las credenciales de Google configuradas.
 */
export const getGoogleCredentials = () => {
    return {
        client_email: process.env.GOOGLE_CLIENT_EMAIL,
        private_key: getGooglePrivateKey(),
    };
};

/**
 * Crea una instancia de autenticación de Google con los scopes necesarios.
 * @param scopes Lista de scopes de Google API
 */
export const createGoogleAuth = (scopes: string[]) => {
    const creds = getGoogleCredentials();
    
    if (!creds.private_key) {
        console.warn("⚠️ [GoogleAuth] La clave privada de Google está vacía.");
    }

    return new google.auth.GoogleAuth({
        credentials: {
            client_email: creds.client_email,
            private_key: creds.private_key,
        },
        scopes: scopes,
    });
};
