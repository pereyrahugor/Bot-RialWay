// src/apis/external/Aquavita/MovimientosApi.ts
import axios from 'axios';
import { getSessionToken, ensureValidToken } from './SessionApi';

const BASE_URL = {
  toString() {
    return process.env.AQUAVITA_SWS_BASE_URL || process.env.SWS_BASE_URL || '';
  }
} as unknown as string;

export class MovimientosApi {
  static async obtenerSaldosDeCliente(clienteId: number) {
    await ensureValidToken();
    const token = getSessionToken() || '';
    const url = `${BASE_URL}/api/Movimientos/ObtenerSaldosDeCliente/`;
    const headers = {
      'CURRENTTOKENVALUE': token
    };
    const params = { clienteId };
    return axios.get(url, { headers, params });
  }
}
