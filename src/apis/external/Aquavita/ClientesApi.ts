// src/apis/external/Aquavita/ClientesApi.ts
import axios from 'axios';
import { getSessionToken, ensureValidToken } from './SessionApi';
import { getMapsUbication } from './getMapsUbication';

const getBaseUrl = () => process.env.AQUAVITA_SWS_BASE_URL || process.env.SWS_BASE_URL || '';

export class ClientesApi {
  /**
   * Obtener datos de un cliente por ID
   */
  static async obtenerDatosCliente(cliente_id: number) {
    await ensureValidToken();
    const token = getSessionToken() || '';
    const url = `${getBaseUrl()}/api/Clientes/ObtenerDatosCliente`;
    const headers = {
      'Content-Type': 'application/json',
      'CURRENTTOKENVALUE': token
    };
    const data = { cliente_id };
    return axios.post(url, data, { headers });
  }

  /**
   * Obtener sucursales de un cliente por ID
   */
  static async obtenerSucursales(cliente_id: number) {
    await ensureValidToken();
    const token = getSessionToken() || '';
    const url = `${getBaseUrl()}/api/Clientes/ObtenerSucursalesJson`;
    const headers = {
      'Content-Type': 'application/json',
      'CURRENTTOKENVALUE': token
    };
    const data = { cliente_id };
    return axios.post(url, data, { headers });
  }

  /**
   * Búsqueda rápida de clientes
   */
  static async busquedaRapida(params: { datosCliente?: string; telefono?: string; dni?: string; domicilio?: string }) {
    await ensureValidToken();
    const token = getSessionToken() || '';
    const url = `${getBaseUrl()}/api/Clientes/BusquedaRapidaResultJson`;
    
    // Sanitizar parámetros para evitar Syntax Error en Full-Text Search del backend SQL
    const sanitizeQuery = (str: string) => str.replace(/[^a-zA-Z0-9\sñÑáéíóúÁÉÍÓÚ]/g, ' ').replace(/\s+/g, ' ').trim();

    const datosCliente = sanitizeQuery(String(params.datosCliente ?? ""));
    const telefono = sanitizeQuery(String(params.telefono ?? ""));
    const domicilio = sanitizeQuery(String(params.domicilio ?? ""));

    const headers = {
      'Content-Type': 'application/json',
      'CURRENTTOKENVALUE': token,
      'Authorization': `Bearer ${token}`
    };

    const body = {
      type: "BUSCAR_CLIENTE",
      datosCliente: datosCliente,
      telefono: telefono,
      domicilio: domicilio
    };

    console.log(`[ClientesApi] Buscando cliente: "${datosCliente || domicilio || telefono}"`);
    
    try {
      const response = await axios.post(url, body, { headers, timeout: 15000 });
      
      // Si no hay resultados y es búsqueda por nombre, intentar una variación
      if ((!response.data?.data || response.data.data.length === 0) && datosCliente.includes(' ')) {
          console.log('[ClientesApi] Sin resultados. Reintentando con variación de nombre...');
          const partes = datosCliente.split(/\s+/);
          if (partes.length >= 2) {
              const variacion = `${partes[0]} ${partes[partes.length - 1]}`;
              const bodyVar = { ...body, datosCliente: variacion };
              const respVar = await axios.post(url, bodyVar, { headers, timeout: 10000 });
              if (respVar.data?.data && respVar.data.data.length > 0) {
                  console.log(`[ClientesApi] Éxito con variación de nombre: "${variacion}"`);
                  return respVar;
              }
          }
      }
      
      // Sub-filtro si la búsqueda es claramente por número de ID y arroja múltiples
      const resultData = response.data?.data || [];
      if (resultData.length > 1 && /^\d{1,7}$/.test(datosCliente)) {
          console.log(`[ClientesApi] Múltiples resultados devueltos para ID numérico '${datosCliente}'. Aplicando sub-filtro estricto por ID...`);
          const subFilter = resultData.filter((c: any) => String(c.id) === datosCliente || String(c.cliente_id) === datosCliente);
          if (subFilter.length > 0) {
              console.log(`[ClientesApi] Coincidencia de ID encontrada! Priorizando sobre ${resultData.length - 1} resultados.`);
              response.data.data = subFilter;
          }
      }

      return response;
    } catch (error: any) {
      console.error('[ClientesApi] Error en busquedaRapida:', error.message);
      throw error;
    }
  }

  /**
   * Crear nuevo cliente
   */
  static async crearNuevoCliente(payload: { cliente: any, reparto_id: number }) {
    const clienteRaw = { ...payload.cliente };
    if (clienteRaw.direccion && !clienteRaw.domicilio) {
      clienteRaw.domicilio = clienteRaw.direccion;
    }
    if (clienteRaw.direccion !== undefined) {
      delete clienteRaw.direccion;
    }

    let domicilio = payload.cliente.domicilio;
    if (typeof domicilio === 'string') {
      domicilio = parseDomicilioString(domicilio);
    } else if (!domicilio || typeof domicilio !== 'object') {
      domicilio = parseDomicilioString('');
    }

    try {
      const calleYAltura = `${domicilio.calle ?? ''} ${domicilio.puerta ?? ''}`.trim();
      const ubicacion = await getMapsUbication(
        calleYAltura,
        domicilio.cp ?? '',
        domicilio.ciudad ?? '',
        domicilio.provincia ?? '',
        domicilio.pais ?? ''
      );
      domicilio.latitud = (ubicacion && ubicacion.lat != null) ? String(ubicacion.lat) : '';
      domicilio.longitud = (ubicacion && ubicacion.lng != null) ? String(ubicacion.lng) : '';
      
      if (ubicacion && ubicacion.formattedAddress) {
        const partesGoogle = ubicacion.formattedAddress.split(',');
        const principal = partesGoogle[0].trim();
        const matchDirs = principal.match(/^(.+?)\s+(\d+)$/);
        
        if (matchDirs) {
          domicilio.calle = matchDirs[1].trim();
          domicilio.puerta = matchDirs[2].trim();
        } else {
          domicilio.calle = principal;
          domicilio.puerta = '';
        }
        
        if (partesGoogle.length > 1) {
          domicilio.observaciones = partesGoogle.slice(1).join(', ').trim();
        }
      }

      console.log('[CrearCliente] Domicilio parseado (Normalizado):', domicilio);
    } catch (e) {
      console.warn('No se pudo obtener geolocalización:', e);
      domicilio.latitud = '';
      domicilio.longitud = '';
    }

    await ensureValidToken();
    const token = getSessionToken() || '';
    const url = `${getBaseUrl()}/Clientes/CrearNuevoClientePorChatBot`;
    const headers = {
      'Content-Type': 'application/json',
      'CURRENTTOKENVALUE': token
    };

    let tipoDeClienteId = 1;
    if (payload.cliente.tipoCliente) {
      const tipo = String(payload.cliente.tipoCliente).toLowerCase();
      if (tipo === 'familia') tipoDeClienteId = 1;
      else if (tipo === 'empresa') tipoDeClienteId = 2;
    }

    const cliente = {
      nombre: payload.cliente.nombre ?? '',
      apellido: payload.cliente.apellido ?? '',
      tipoDeClienteId,
      condicionIvaId: payload.cliente.condicionIvaId ?? 2,
      dniCuit: payload.cliente.dni ?? '',
      telefono: payload.cliente.telefono ?? '',
      email: payload.cliente.email ?? '',
      listaDePreciosId: payload.cliente.listaDePreciosId ?? 1,
      reparto_id: payload.reparto_id,
      domicilio
    };

    return axios.post(url, { cliente }, { headers });
  }

  /**
   * Agregar contacto
   */
  static async agregarContacto(modeloContacto: any) {
    await ensureValidToken();
    const token = getSessionToken() || '';
    const url = `${getBaseUrl()}/api/Clientes/CreateContacto`;
    const headers = {
      'Content-Type': 'application/json',
      'CURRENTTOKENVALUE': token
    };
    return axios.post(url, { ModeloContacto: modeloContacto }, { headers });
  }

  /**
   * Obtener credenciales de autogestión
   */
  static async obtenerCredencialesAutogestion(cliente_id: number) {
    await ensureValidToken();
    const token = getSessionToken() || '';
    const url = `${getBaseUrl()}/api/UsuariosClientes/ObtenerUsuarioPorCliente`;
    const headers = {
      'Content-Type': 'application/json',
      'CURRENTTOKENVALUE': token
    };
    return axios.post(url, { cliente_id }, { headers });
  }

  /**
   * Buscar un cliente por contacto (teléfono o email)
   */
  static async buscarClientePorContacto(params: { telefono?: string; email?: string }) {
    await ensureValidToken();
    const token = getSessionToken() || '';
    const url = `${getBaseUrl()}/Clientes/BuscarClientePorContacto`;
    const headers = {
      'Content-Type': 'application/json',
      'CURRENTTOKENVALUE': token
    };
    return axios.get(url, { headers, params });
  }
}

function parseDomicilioString(domicilioStr: string) {
  let calle = '';
  let puerta = '';
  let ciudad = '';
  let provincia = 'Cordoba';
  let pais = 'Argentina';
  let observaciones = '';
  const cp = '';
  const regexDireccion = /^(.+?)\s+(\d+)(?:\s+(.*))?$/;

  if (domicilioStr && domicilioStr.includes(',')) {
    const partes = domicilioStr.split(',').map(p => p.trim());
    const parte1 = partes[0] || '';
    const match1 = parte1.match(regexDireccion);
    if (match1) {
      calle = match1[1].trim();
      puerta = match1[2].trim();
    } else {
      calle = parte1;
    }

    ciudad = partes.length > 1 ? partes[1] : '';
    if (partes.length > 2) {
      if (/capital/i.test(partes[2])) {
        provincia = 'Cordoba';
        if (!ciudad) ciudad = partes[2];
      } else {
        provincia = partes[2];
      }
    }
  } else {
    const match = domicilioStr.match(regexDireccion);
    if (match) {
      calle = match[1].trim();
      puerta = match[2].trim();
      const resto = match[3] ? match[3].trim() : '';

      if (/cordoba|capital/i.test(resto)) {
        ciudad = resto;
      } else {
        observaciones = resto;
        if (!ciudad) ciudad = 'Cordoba Capital';
      }
    } else {
      calle = domicilioStr;
    }
  }

  if (/argentina/i.test(domicilioStr)) {
    pais = 'Argentina';
  }

  return {
    provincia,
    pais,
    ciudad,
    calle,
    puerta,
    observaciones,
    piso: '',
    depto: '',
    torre: '',
    cp,
    lote: '',
    manzana: '',
    latitud: '',
    longitud: ''
  };
}
