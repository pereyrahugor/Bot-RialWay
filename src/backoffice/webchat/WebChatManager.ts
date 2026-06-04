import { WebChatSession } from './WebChatSession';

/** Gestiona las sesiones activas del webchat, una por IP de cliente. */
export class WebChatManager {
  private sessions: Record<string, WebChatSession> = {};

  /** Devuelve la sesión existente o crea una nueva para la IP dada. */
  getSession(ip: string): WebChatSession {
    if (!this.sessions[ip]) {
      this.sessions[ip] = new WebChatSession();
    }
    return this.sessions[ip];
  }

  /** Limpia el historial de la sesión para la IP dada sin eliminarla. */
  resetSession(ip: string) {
    if (this.sessions[ip]) {
      this.sessions[ip].clear();
    }
  }
}
