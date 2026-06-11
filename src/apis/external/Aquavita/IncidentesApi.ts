// src/apis/external/Aquavita/IncidentesApi.ts
import axios from 'axios';
import { getSessionToken, ensureValidToken } from './SessionApi';

const BASE_URL = {
  toString() {
    return process.env.AQUAVITA_SWS_BASE_URL || process.env.SWS_BASE_URL || '';
  }
} as unknown as string;

export class IncidentesApi {
  static async crearTicket(params: any) {
    await ensureValidToken();
    const url = `${BASE_URL}/api/Incidentes/Save`;
    const headers = {
      'Content-Type': 'application/json',
      'CURRENTTOKENVALUE': getSessionToken() || ''
    };
    return axios.post(url, params, { headers });
  }

  static async obtenerIncidentesCliente(params: any) {
    await ensureValidToken();
    const url = `${BASE_URL}/api/Incidentes/ObtenerIncidentesCliente`;
    const headers = {
      'Content-Type': 'application/json',
      'CURRENTTOKENVALUE': getSessionToken() || ''
    };
    return axios.post(url, params, { headers });
  }
}
