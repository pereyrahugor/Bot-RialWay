import { swsClient } from './swsClient';

export class MovimientosApi {
  static async obtenerSaldosDeCliente(clienteId: number) {
    const url = `/api/Movimientos/ObtenerSaldosDeCliente/`;
    const params = { clienteId };
    return swsClient.get(url, { params });
  }
}
