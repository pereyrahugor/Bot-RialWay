import { swsClient } from './swsClient';

export class IncidentesApi {
  static async crearTicket(params: any) {
    const url = `/api/Incidentes/Save`;
    return swsClient.post(url, params);
  }

  static async obtenerIncidentesCliente(params: any) {
    const url = `/api/Incidentes/ObtenerIncidentesCliente`;
    return swsClient.post(url, params);
  }
}
