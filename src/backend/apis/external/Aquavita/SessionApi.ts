import axios from 'axios';

const getBaseUrl = () => process.env.AQUAVITA_SWS_BASE_URL || process.env.SWS_BASE_URL || '';

let sessionToken: string | null = null;
let tokenVencimiento: string | null = null;
let usuarioId: number | null = null;
let tokenCreatedAt: Date | null = null;

export function setSessionToken(token: string) {
  sessionToken = token;
  tokenCreatedAt = token ? new Date() : null;
}

export function setTokenVencimiento(vencimiento: string) {
  tokenVencimiento = vencimiento;
}

export function setUsuarioId(id: number) {
  usuarioId = id;
}

export function getSessionToken(): string | null {
  return sessionToken;
}

export function getTokenVencimiento(): string | null {
  return tokenVencimiento;
}

export function getUsuarioId(): number | null {
  return usuarioId;
}

export class SessionApi {
  static get username(): string {
    return process.env.AQUAVITA_SWS_USERNAME || process.env.SWS_USERNAME || '';
  }
  static get password(): string {
    return process.env.AQUAVITA_SWS_PASSWORD || process.env.SWS_PASSWORD || '';
  }

  static async login(username?: string, password?: string) {
    const user = username || SessionApi.username;
    const pass = password || SessionApi.password;
    const url = `${getBaseUrl()}/api/Session/GetToken`;
    const body = { username: user, password: pass };
    const headers = { 'Content-Type': 'application/json' };
    
    console.log(`[SessionApi] Intentando login en: ${url}`);
    
    try {
      const response = await axios.post(url, body, { headers });
      
      if (response.data && response.data.tokenValido) {
        setSessionToken(response.data.tokenValido);
        setTokenVencimiento(response.data.vencimiento || '');
        setUsuarioId(response.data.usuario_id || 0);
        console.log(`[SessionApi] Login exitoso. Token obtenido (últimos 5): ${response.data.tokenValido.slice(-5)}`);
      } else {
        console.warn(`[SessionApi] Login falló. Respuesta de la API:`, response.data);
        setSessionToken('');
        setTokenVencimiento('');
        setUsuarioId(0);
      }
      return response;
    } catch (e: any) {
      console.error(`[SessionApi] Error al realizar el POST de login:`, e.response?.data || e.message);
      throw e;
    }
  }

  static getToken() {
    return getSessionToken();
  }

  static setToken(token: string) {
    setSessionToken(token);
  }

  static getVencimiento() {
    return getTokenVencimiento();
  }

  static setVencimiento(vencimiento: string) {
    setTokenVencimiento(vencimiento);
  }
}

export async function ensureValidToken(username?: string, password?: string): Promise<string | null> {
  const token = getSessionToken();
  let vigente = false;
  
  if (token && tokenCreatedAt) {
    const ahora = new Date();
    const diffMs = ahora.getTime() - tokenCreatedAt.getTime();
    const diffMins = diffMs / 60000;
    vigente = diffMins < 30; // Vigente si pasaron menos de 30 minutos
  }
  
  const user = username || SessionApi.username;
  const pass = password || SessionApi.password;
  if (!token || !vigente) {
    const razon = !token ? 'ausente' : 'vencido (hace más de 30 min)';
    console.log(`[SessionApi] Token ${razon}. Solicitando uno nuevo para el usuario: ${user}`);
    try {
      const response = await SessionApi.login(user, pass);
      const newToken = getSessionToken();
      console.log(`[SessionApi] Resultado del login: ${newToken ? 'ÉXITO' : 'FALLO'}`);
      return newToken;
    } catch (err: any) {
      console.error(`[SessionApi] Error crítico en login:`, err.message);
      return null;
    }
  } else {
    return token;
  }
}
