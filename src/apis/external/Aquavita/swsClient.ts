import axios from 'axios';
import { ensureValidToken, SessionApi } from './SessionApi';

const getBaseUrl = () => process.env.AQUAVITA_SWS_BASE_URL || process.env.SWS_BASE_URL || '';

export const swsClient = axios.create({
  timeout: 15000, // 15 segundos
});

// Interceptor de petición: inyecta automáticamente la URL base y el token de sesión y Authorization Bearer
swsClient.interceptors.request.use(
  async (config) => {
    // Configurar URL base dinámicamente para soportar cambios en caliente del Backoffice
    config.baseURL = getBaseUrl();

    const token = await ensureValidToken();
    if (token && config.headers) {
      if (typeof config.headers.set === 'function') {
        config.headers.set('CURRENTTOKENVALUE', token);
        config.headers.set('Authorization', `Bearer ${token}`);
      } else {
        config.headers['CURRENTTOKENVALUE'] = token;
        config.headers['Authorization'] = `Bearer ${token}`;
      }
    }
    return config;
  },
  (error) => {
    return Promise.reject(error);
  }
);

// Interceptor de respuesta: maneja renovación automática ante 401 y reintentos ante errores de red temporales
swsClient.interceptors.response.use(
  (response) => response,
  async (error) => {
    const originalRequest = error.config;
    if (!originalRequest) {
      return Promise.reject(error);
    }

    // 1. Manejo de error 401 (No Autorizado) -> Renovar token en caliente y reintentar una vez
    if (error.response?.status === 401 && !originalRequest._retry) {
      originalRequest._retry = true;
      console.warn("[swsClient] Petición falló con 401 (no autorizado). Intentando renovar token...");
      try {
        const user = SessionApi.username;
        const pass = SessionApi.password;
        // Forzamos el login de SessionApi usando axios directo para obtener un nuevo token
        const response = await SessionApi.login(user, pass);
        const newToken = response.data?.tokenValido;
        if (newToken && originalRequest.headers) {
          if (typeof originalRequest.headers.set === 'function') {
            originalRequest.headers.set('CURRENTTOKENVALUE', newToken);
            originalRequest.headers.set('Authorization', `Bearer ${newToken}`);
          } else {
            originalRequest.headers['CURRENTTOKENVALUE'] = newToken;
            originalRequest.headers['Authorization'] = `Bearer ${newToken}`;
          }
          console.log("[swsClient] Token renovado exitosamente tras 401. Reintentando petición...");
          return swsClient(originalRequest);
        }
      } catch (loginErr: any) {
        console.error("[swsClient] Fallo al renovar token en el interceptor 401:", loginErr.message);
      }
    }

    // 2. Manejo de reintentos ante errores temporales de red/servidor (con backoff exponencial)
    const attempt = originalRequest._attempt || 0;
    const maxRetries = 2; // Máximo 2 reintentos adicionales (3 intentos en total)
    const isTransientError =
      !error.response || // error de red (sin respuesta)
      error.code === 'ECONNABORTED' || // timeout
      error.response.status === 429 || // rate limit
      error.response.status >= 500;    // error de servidor (5xx)

    if (isTransientError && attempt < maxRetries) {
      originalRequest._attempt = attempt + 1;
      const delay = 2000 * (attempt + 1); // 2000ms -> 4000ms
      console.warn(`[swsClient] Petición falló (${error.message}). Reintentando en ${delay}ms... (Intento ${attempt + 1} de ${maxRetries})`);
      await new Promise((resolve) => setTimeout(resolve, delay));
      return swsClient(originalRequest);
    }

    return Promise.reject(error);
  }
);
