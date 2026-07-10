import { getMapsUbication } from './getMapsUbication';
import { swsClient } from './swsClient';

export class RepartosApi {
    /**
     * Busca clientes cercanos por dirección usando el endpoint correcto
     * @param params { address: string, metros: number }
     */
    static async busquedaClientesCercanosResultJson(params: { address: string, metros: number }) {
      const url = `/Repartos/BusquedaClientesCercanosResultJson`;
      return swsClient.get(url, { params });
    }
  /**
   * Busca clientes cercanos a un cliente dado su ID.
   * @param clienteId string
   * @param radioMetros number
   * @param excluir boolean
   * @returns respuesta completa de la API
   */
  static async obtenerClientesCercanosACliente(clienteId: string, radioMetros: number, excluir: boolean = false) {
    const url = `/Repartos/ObtenerClientesCercanosACliente`;
    const params = {
      clienteId,
      excluir,
      radioMetros
    };
    return swsClient.get(url, { params });
  }
  /**
   * Busca clientes cercanos por dirección, aumentando el radio si no hay resultados.
   * @param calleYAltura string (ej: "Av. Siempre Viva 123")
   * @param codigoPostal string
   * @param localidad string
   * @param provincia string
   * @param pais string
   * @param excluir boolean
   * @returns respuesta completa de la API
   */
  static async obtenerClientesCercanosPorDireccion(
    calleYAltura: string,
    codigoPostal: string,
    _localidad: string,
    _provincia: string,
    _pais: string,
    excluir: boolean = false
  ) {
        // Forzar valores estáticos
        const provincia = "Cordoba";
        const pais = "Argentina";
        const localidad = "Ciudad de Cordoba";
    // Obtener coordenadas con getMapsUbication
    const ubicacion = await getMapsUbication(
      calleYAltura,
      codigoPostal,
      localidad,
      provincia,
      pais
    );
    if (!ubicacion || !ubicacion.lat || !ubicacion.lng) {
      return { error: 'No se pudo obtener coordenadas para la dirección proporcionada.' };
    }
    let radio = 500;
    const radioMax = 2500;
    let respuesta;
    do {
      respuesta = await RepartosApi.obtenerClientesCercanos(
        String(ubicacion.lat),
        String(ubicacion.lng),
        radio,
        false // excluir siempre es falso
      );
      // Si hay resultados, salir (detectar array directo o propiedad clientesCercanos/data)
      const hasResults = (Array.isArray(respuesta?.data) && respuesta.data.length > 0) ||
                         (Array.isArray(respuesta?.data?.clientesCercanos) && respuesta.data.clientesCercanos.length > 0) ||
                         (Array.isArray(respuesta?.data?.data) && respuesta.data.data.length > 0);

      if (hasResults) {
        break;
      }
      radio += 250;
    } while (radio <= radioMax);
    return respuesta;
  }
  static async obtenerClientesCercanos(latitud: string, longitud: string, radioMetros: number, excluir: boolean = false) {
    const url = `/Repartos/ObtenerClientesCercanosPorCoordenadas`;
    const params = {
      latitud,
      longitud,
      radioMetros,
      excluir
    };
    return swsClient.get(url, { params });
  }
}
