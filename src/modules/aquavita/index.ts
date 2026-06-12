// src/modules/aquavita/index.ts
import { ClientesApi } from "../../apis/external/Aquavita/ClientesApi";
import { IncidentesApi } from "../../apis/external/Aquavita/IncidentesApi";
import { AdministracionApi } from "../../apis/external/Aquavita/FacturacionApi";
import { MovimientosApi } from "../../apis/external/Aquavita/MovimientosApi";
import { getMapsUbication } from "../../apis/external/Aquavita/getMapsUbication";
import { getUsuarioId } from "../../apis/external/Aquavita/SessionApi";
import { AssistantResponseProcessor } from "../../apis/openai/AssistantResponseProcessor";
import { ListaDePreciosApi } from "../../apis/external/Aquavita/ListaDePreciosApi";
import { RepartosApi } from "../../apis/external/Aquavita/RepartosApi";
import moment from "moment-timezone";
import util from "util";

// Helpers para fechas
function toDDMMYYYY(fecha: string): string {
    if (!fecha) return '';
    if (fecha.includes('{{HOY_DDMMYYYY}}') || fecha.includes('{{HOY}}')) {
        const today = new Date();
        const d = String(today.getDate()).padStart(2, '0');
        const m = String(today.getMonth() + 1).padStart(2, '0');
        const y = today.getFullYear();
        return `${d}/${m}/${y}`;
    }
    if (/^\d{2}\/\d{2}\/\d{4}$/.test(fecha)) return fecha;
    if (/^\d{4}-\d{2}-\d{2}$/.test(fecha)) {
        const [y, m, d] = fecha.split('-');
        return `${d}/${m}/${y}`;
    }
    if (/^\d{4}\/\d{2}\/\d{2}$/.test(fecha)) {
        const [y, m, d] = fecha.split('/');
        return `${d}/${m}/${y}`;
    }
    return fecha;
}

function parseDate(fechaStr: string): Date | null {
    if (!fechaStr || !/^\d{2}\/\d{2}\/\d{4}$/.test(fechaStr)) return null;
    const [d, m, y] = fechaStr.split('/').map(Number);
    return new Date(y, m - 1, d);
}

function validarRangoFechas(desdeStr: string, hastaStr: string): { desde: string, hasta: string } {
    const desde = toDDMMYYYY(desdeStr);
    let hasta = toDDMMYYYY(hastaStr);
    if (!hasta) {
        hasta = toDDMMYYYY('{{HOY}}');
    }
    if (desde && hasta) {
        const dDate = parseDate(desde);
        const hDate = parseDate(hasta);
        if (dDate && hDate && hDate < dDate) {
            hasta = toDDMMYYYY('{{HOY}}');
        }
    }
    return { desde, hasta };
}

// Helpers específicos del módulo
function getFechaCierreEstimado(): string {
  const date = new Date();
  let businessDays = 0;
  while (businessDays < 2) {
    date.setDate(date.getDate() + 1);
    if (date.getDay() !== 0 && date.getDay() !== 6) {
      businessDays++;
    }
  }
  const d = String(date.getDate()).padStart(2, '0');
  const m = String(date.getMonth() + 1).padStart(2, '0');
  const y = date.getFullYear();
  return `${d}/${m}/${y}`;
}

function esRespuestaExitosa(data: any, apiResponse?: any): boolean {
  if (!data) return false;
  if (data.error === 0) return true;
  if (data.success === true) return true;
  if (Array.isArray(data)) return true;
  if (apiResponse && apiResponse.status === 200 && Object.keys(data).length > 0) return true;
  return false;
}

function logApiResponse(tipo: string, response: any): void {
  if (!response || !response.config) {
    console.log(`[API Debug] ${tipo} (Sin objeto Axios):`, util.inspect(response, { depth: 4 }));
    return;
  }
  console.log(`\n[API Debug] Respuesta ${tipo}: status ${response.status}`);
}

export const aquavitaModule = {
  key: "aquavita",
  label: "Aquavita",

  tools: {
    // 1. buscarCliente
    buscarCliente: async (args: any, context: any) => {
      const { state, ctx } = context;
      let domicilioParam = args.domicilio ?? '';
      let requiereFiltroSN = false;
      const filtroPiso = args.piso ? String(args.piso).trim().toLowerCase() : null;
      const filtroDepto = args.depto ? String(args.depto).trim().toLowerCase() : null;

      if (typeof domicilioParam === 'string' && domicilioParam) {
        if (!domicilioParam.toLowerCase().includes("córdoba capital")) {
          domicilioParam = `Córdoba Capital, ${domicilioParam}`;
        }
        const regexSN = /\s+s\/?n\s*$/i;
        if (regexSN.test(domicilioParam)) {
          requiereFiltroSN = true;
          domicilioParam = domicilioParam.replace(regexSN, '').trim();
        }
      }

      const apiResponse = await ClientesApi.busquedaRapida({
        datosCliente: args.datosCliente ?? '',
        telefono: args.telefono ?? '',
        domicilio: domicilioParam
      });
      logApiResponse('BUSCAR_CLIENTE', apiResponse);

      const respuestaApi = apiResponse.data || {};
      let countResultados = 0;
      let datosCliente = null;

      if (Array.isArray(respuestaApi.data) && respuestaApi.data.length > 0) {
        let resultados = respuestaApi.data;
        
        if (filtroPiso || filtroDepto || requiereFiltroSN) {
          resultados = resultados.filter((c: any) => {
            let match = true;
            if (filtroPiso) {
              const pisoCliente = String(c.piso || '').trim().toLowerCase();
              if (pisoCliente !== filtroPiso) match = false;
            }
            if (filtroDepto) {
              const deptoCliente = String(c.depto || '').trim().toLowerCase();
              if (deptoCliente !== filtroDepto) match = false;
            }
            if (requiereFiltroSN) {
              const numPuerta = String(c.numeroPuerta || '').trim().toUpperCase();
              if (numPuerta !== 'S/N') match = false;
            }
            return match;
          });
        }

        countResultados = resultados.length;
        if (resultados.length > 0) {
          const clienteActivo = resultados.find((c: any) => c.estadoCliente?.trim().toLowerCase() !== 'baja');
          datosCliente = clienteActivo || resultados[0];
        }
      }

      if (esRespuestaExitosa(respuestaApi) && datosCliente) {
        await AssistantResponseProcessor.actualizarContextoCliente(state, datosCliente, ctx.from);
        const esBaja = datosCliente.estadoCliente?.trim().toLowerCase() === 'baja';
        const esMultiple = countResultados > 1;
        const advertenciaMultiple = esMultiple ? "⚠️ ATENCIÓN: multiples resultados obtenidos, solicitar datos adicionales para obtener datos mas precisos o identificar un unico cliente\n\n" : "";

        if (esBaja) {
          return `${advertenciaMultiple}⚠️ ATENCIÓN: El cliente se encuentra en estado de "BAJA" (Inactivo). No se permiten realizar nuevos pedidos ni registrar incidencias para clientes en este estado.\n\nDatos completos:\n${JSON.stringify(datosCliente, null, 2)}`;
        } else {
          return `${advertenciaMultiple}Datos completos del cliente:\n${JSON.stringify(datosCliente, null, 2)}`;
        }
      } else {
        let resumen = "No se encuentra cliente coincidente con los datos enviados";
        const filtrosAplicados = [];
        if (filtroPiso) filtrosAplicados.push(`piso: ${filtroPiso}`);
        if (filtroDepto) filtrosAplicados.push(`depto: ${filtroDepto}`);
        if (requiereFiltroSN) filtrosAplicados.push(`S/N: S/N`);
        
        if (filtrosAplicados.length > 0) {
          resumen += ` (se aplicaron filtros - ${filtrosAplicados.join(', ')})`;
        }
        return resumen;
      }
    },

    // 2. buscarClientePorContacto
    buscarClientePorContacto: async (args: any, context: any) => {
      const { state, ctx } = context;
      const apiResponse = await ClientesApi.buscarClientePorContacto({
        telefono: args.telefono ?? '',
        email: args.email ?? ''
      });
      logApiResponse('BUSCAR_CLIENTE_POR_CONTACTO', apiResponse);

      const respuestaApi = apiResponse.data || {};
      const clientes = respuestaApi.clientes || [];
      let datosCliente = null;

      if (clientes.length === 1) {
        datosCliente = clientes[0];
      }

      if (datosCliente) {
        await AssistantResponseProcessor.actualizarContextoCliente(state, datosCliente, ctx.from);
        return `Se encontró el cliente coincidente:\n${JSON.stringify(datosCliente, null, 2)}`;
      } else if (clientes.length > 1) {
        return `⚠️ SE ENCONTRARON MÚLTIPLES COINCIDENCIAS (${clientes.length}). Solicitar datos adicionales para identificar al cliente único.\n\nResumen de resultados:\n${JSON.stringify(clientes.slice(0, 3).map((c: any) => ({ 
          cliente_id: c.cliente_id, 
          nombre: c.nombreCliente || c.nombrePersona,
          domicilio: c.DomicilioCompleto
        })), null, 2)}`;
      } else {
        return "No se encontró ningún cliente registrado con ese teléfono o email de contacto.";
      }
    },

    // 3. crearCliente
    crearCliente: async (args: any, context: any) => {
      const { state, ctx } = context;
      const clienteRaw = args.cliente || args.payload?.cliente || args;
      
      let nombreCompleto = '';
      if (clienteRaw.nombre && clienteRaw.apellido) {
        nombreCompleto = `${clienteRaw.nombre} ${clienteRaw.apellido}`.trim().toUpperCase();
      } else if (clienteRaw.nombre) {
        nombreCompleto = String(clienteRaw.nombre).trim().toUpperCase();
      } else if (clienteRaw.apellido) {
        nombreCompleto = String(clienteRaw.apellido).trim().toUpperCase();
      }

      if (clienteRaw.direccion) {
        try {
          let dirToNormalize = clienteRaw.direccion;
          if (!dirToNormalize.toLowerCase().includes("córdoba capital")) {
            dirToNormalize = `Córdoba Capital, ${dirToNormalize}`;
          }
          const mapData = await getMapsUbication(dirToNormalize, "", "Córdoba Capital", "Córdoba", "Argentina");
          if (mapData && mapData.formattedAddress) {
            clienteRaw.direccion = mapData.formattedAddress;
          } else {
            clienteRaw.direccion = dirToNormalize;
          }
        } catch (error) {
          console.error("[CREAR_CLIENTE] Error normalizando dirección con Google Maps:", error);
        }
      }

      const cliente = {
        ...clienteRaw,
        nombre: nombreCompleto,
      };
      if (cliente.apellido !== undefined) delete cliente.apellido;

      const reparto_id = args.reparto_id || args.payload?.reparto_id || 1;
      const apiResponse = await ClientesApi.crearNuevoCliente({
        cliente,
        reparto_id
      });

      logApiResponse('CREAR_CLIENTE', apiResponse);
      if (esRespuestaExitosa(apiResponse?.data)) {
        const id = apiResponse?.data?.cliente?.cliente_id;
        await AssistantResponseProcessor.actualizarContextoCliente(state, {
          ...cliente,
          cliente_id: id,
          esCliente: 'Si'
        }, ctx.from);
        return `✅ Cliente creado exitosamente. ID: ${id ?? 'desconocido'}`;
      } else if (apiResponse?.data?.error) {
        return `No se pudo crear el cliente: ${apiResponse.data?.message || 'Error desconocido.'}`;
      } else {
        return "No se pudo crear el cliente. (Sin respuesta de la API)";
      }
    },

    // 4. agregarContacto
    agregarContacto: async (args: any) => {
      const apiResponse = await ClientesApi.agregarContacto(args.modeloContacto || args);
      logApiResponse('AGREGAR_CONTACTO', apiResponse);
      return esRespuestaExitosa(apiResponse.data)
        ? "Contacto agregado exitosamente."
        : "No se pudo agregar el contacto.";
    },

    // 5. obtenerCredencialesAutogestion
    obtenerCredencialesAutogestion: async (args: any) => {
      const id = args.cliente_id ?? args.id ?? args.cliente_Id;
      const apiResponse = await ClientesApi.obtenerCredencialesAutogestion(id);
      logApiResponse('OBTENER_CREDENCIALES_AUTOGESTION', apiResponse);
      const datos = apiResponse.data || {};
      return esRespuestaExitosa(datos, apiResponse)
        ? `Credenciales de autogestión: ${JSON.stringify(datos)}`
        : "No se pudieron obtener las credenciales.";
    },

    // 6. obtenerSucursales
    obtenerSucursales: async (args: any) => {
      const id = args.cliente_id ?? args.id;
      const apiResponse = await ClientesApi.obtenerSucursales(id);
      logApiResponse('OBTENER_SUCURSALES', apiResponse);
      return JSON.stringify(apiResponse.data);
    },

    // 7. crearIncidencia
    crearIncidencia: async (args: any, context: any) => {
      const { state } = context;
      const payload = {
        ...args,
        centroDistribucion_id: 1,
        usuarioResponsable_id: getUsuarioId() || null,
        fechaCierreEstimado: getFechaCierreEstimado(),
        estadoIncidente_ids: 1
      };
      const apiResponse = await IncidentesApi.crearTicket(payload);
      logApiResponse('CREAR_INCIDENCIA', apiResponse);
      const incidenteId = apiResponse.data?.incidente?.id || apiResponse.data?.id;
      if (incidenteId) {
        await AssistantResponseProcessor.actualizarContextoCliente(state, { incidencia_generada: incidenteId });
      }
      return JSON.stringify(apiResponse.data);
    },

    // 8. buscarIncidencia
    buscarIncidencia: async (args: any) => {
      const today = moment().tz("America/Argentina/Buenos_Aires");
      const fechaHasta = today.format("DD/MM/YYYY");
      const fechaDesde = today.clone().subtract(7, 'days').format("DD/MM/YYYY");
      
      const payload = {
        cliente_id: args.cliente_id || args.cliente,
        tipoIncidente_id: args.tipoIncidente_id || args.tipo,
        ordenarDescendente: true,
        fechaDesde,
        fechaHasta
      };
      const apiResponse = await IncidentesApi.obtenerIncidentesCliente(payload);
      logApiResponse('BUSCAR_INCIDENCIA', apiResponse);
      return JSON.stringify(apiResponse.data);
    },

    // 9. obtenerSaldoCuenta
    obtenerSaldoCuenta: async (args: any, context: any) => {
      const { state } = context;
      const cId = args.cliente_id || args.cliente || args.clienteId;
      const apiResponse = await MovimientosApi.obtenerSaldosDeCliente(cId);
      logApiResponse('SALDO_CUENTA', apiResponse);
      
      const datos = apiResponse.data || {};
      if (datos.saldos) {
        const consumo = Number(datos.saldos.saldoCuentaConsumo || 0);
        const facturacion = Number(datos.saldos.saldoCuentaFacturacion || 0);
        const saldoReal = consumo + facturacion;
        
        const contextData = state.get('datosClienteContext') || {};
        const esFamilia = String(contextData.tipoCliente || '').toLowerCase() === 'familia';
        
        if (esFamilia) {
          return `Saldo total: ${saldoReal}. Saldo Consumo: ${consumo}`;
        } else {
          return `Saldo total: ${saldoReal}`;
        }
      } else {
        return "No se pudieron obtener los saldos.";
      }
    },

    // 10. obtenerDatosCliente
    obtenerDatosCliente: async (args: any) => {
      const id = args.cliente_id ?? args.id;
      const apiResponse = await ClientesApi.obtenerDatosCliente(id);
      logApiResponse('OBTENER_DATOS_CLIENTE', apiResponse);
      return JSON.stringify(apiResponse.data);
    },

    // 11. precio
    precio: async (args: any) => {
      const clientId = args.ClienteId ?? args.cliente_id ?? args.clienteId;
      const apiResponse = await ListaDePreciosApi.obtenerListaDePrecios(clientId);
      logApiResponse('PRECIO', apiResponse);
      const data = apiResponse.data || {};
      if (esRespuestaExitosa(data, apiResponse)) {
        const precios = Array.isArray(data) ? data : (Array.isArray(data.precios) ? data.precios : data);
        return `Precios: ${JSON.stringify(precios)}`;
      } else {
        return "No se pudo obtener la lista de precios.";
      }
    },

    // 12. matrizListaDePrecios
    matrizListaDePrecios: async (args: any) => {
      const tipoListaId = args.tipoLista_id ?? 1;
      const filtroListaId = args.lista_id ? parseInt(args.lista_id, 10) : null;
      const apiResponse = await ListaDePreciosApi.obtenerMatrizListaDePrecios(tipoListaId);
      logApiResponse('MATRIZ_LISTA_PRECIOS', apiResponse);
      
      const data = apiResponse.data || {};
      const success = esRespuestaExitosa(data, apiResponse);
      if (success && filtroListaId != null && data.matriz && Array.isArray(data.matriz.articulos)) {
        data.matriz.articulos = data.matriz.articulos
          .map((art: any) => {
            if (Array.isArray(art.precios)) {
              art.precios = art.precios.filter((p: any) => p.lista_id === filtroListaId);
            }
            return art;
          })
          .filter((art: any) => Array.isArray(art.precios) && art.precios.length > 0);
      }
      return success ? `Matriz de lista de precios: ${JSON.stringify(data)}` : "No se pudo obtener la matriz de lista de precios.";
    },

    // 13. abonosTipos
    abonosTipos: async (args: any) => {
      const { desde, hasta } = validarRangoFechas(args.desde ?? '', args.hasta ?? '');
      const apiResponse = await ListaDePreciosApi.obtenerAbonosTipos(
        desde || null,
        hasta || null,
        args.concepto ?? null,
        typeof args.activo === 'boolean' ? args.activo : true
      );
      logApiResponse('ABONOS_TIPOS', apiResponse);
      const data = apiResponse.data || {};
      return esRespuestaExitosa(data, apiResponse) ? `Tipos de abonos: ${JSON.stringify(data)}` : "No se pudo obtener los tipos de abonos.";
    },

    // 14. historialFacturas
    historialFacturas: async (args: any) => {
      const clientId = args.cliente_id ?? args.ClienteId ?? args.clienteId;
      const { desde, hasta } = validarRangoFechas(args.fechaDesde ?? '', args.fechaHasta ?? '');
      const apiResponse = await AdministracionApi.historialFacturasCliente(
        clientId,
        desde,
        hasta,
        typeof args.saldoPendiente === 'boolean' ? args.saldoPendiente : false
      );
      logApiResponse('HISTORIAL_FACTURAS', apiResponse);
      const data = apiResponse.data || {};
      return esRespuestaExitosa(data, apiResponse) ? `Historial de facturas: ${JSON.stringify(data)}` : "No se pudo obtener el historial de facturas.";
    },

    // 15. recibosPago
    recibosPago: async (args: any) => {
      const clientId = args.cliente_id ?? args.clienteId ?? args.ClienteId;
      const { desde, hasta } = validarRangoFechas(args.fechaReciboDesde ?? '', args.fechaReciboHasta ?? '');
      const apiResponse = await AdministracionApi.recibosPagoCliente(
        clientId,
        desde,
        hasta,
        typeof args.saldoDisponible === 'boolean' ? args.saldoDisponible : false
      );
      logApiResponse('RECIBOS_PAGO', apiResponse);
      const data = apiResponse.data || {};
      return esRespuestaExitosa(data, apiResponse) ? `Recibos de pago: ${JSON.stringify(data)}` : "No se pudo obtener los recibos de pago.";
    },

    // 16. reenviarFacturaPorMail
    reenviarFacturaPorMail: async (args: any) => {
      const apiResponse = await AdministracionApi.reenviarFacturaPorMail(args.facturaId);
      logApiResponse('REENVIAR_FACTURA_POR_MAIL', apiResponse);
      const data = apiResponse.data || {};
      return esRespuestaExitosa(data, apiResponse) ? "Factura reenviada por mail exitosamente." : "No se pudo reenviar la factura por mail.";
    },

    // 17. linkPago
    linkPago: async (args: any) => {
      const clientId = args.cliente_id ?? args.ClienteId ?? args.clienteId;
      const apiResponse = await AdministracionApi.obtenerLinkPago(clientId, args.monto);
      logApiResponse('LINK_PAGO', apiResponse);
      const data = apiResponse.data || {};
      return esRespuestaExitosa(data, apiResponse) ? `Link de pago generado: ${JSON.stringify(data)}` : "No se pudo generar el link de pago.";
    },

    // 18. productos
    productos: async (args: any) => {
      const clientId = args.ClienteId ?? args.cliente_id ?? args.clienteId;
      const apiResponse = await ListaDePreciosApi.obtenerListaDePrecios(clientId);
      logApiResponse('PRODUCTOS', apiResponse);
      const data = apiResponse.data || {};
      let resumen = "No se pudieron obtener los productos.";
      if (esRespuestaExitosa(data, apiResponse)) {
        let productos = Array.isArray(data) ? data : (Array.isArray(data.precios) ? data.precios : (data.ArticulosDeListaDePrecio || data));
        if (!Array.isArray(productos) && typeof productos === 'object') {
          productos = Object.entries(productos).map(([nombre, precio]) => ({ nombre, precio }));
        }
        if (args.categoria && Array.isArray(productos)) {
          const categoria = args.categoria.toLowerCase();
          productos = productos.filter((p: any) =>
            (p.nombre && p.nombre.toLowerCase().includes(categoria)) ||
            (p.categoria && p.categoria.toLowerCase().includes(categoria))
          );
        }
        resumen = `Productos disponibles${args.categoria ? ` (categoría: ${args.categoria})` : ''}: ${JSON.stringify(productos)}`;
      }
      return resumen;
    },

    // 19. reparto
    reparto: async (args: any, context: any) => {
      const { state } = context;
      let resumen = "No se encuentra en zona habitual de reparto.";
      
      let calleYAltura = args.calleYAltura || `${args.calle ?? ''} ${args.numero ?? ''}`;
      if (calleYAltura && !calleYAltura.toLowerCase().includes("córdoba capital")) {
        calleYAltura = `Córdoba Capital, ${calleYAltura}`;
      }

      const apiResponse = await RepartosApi.obtenerClientesCercanosPorDireccion(
        calleYAltura,
        args.codigoPostal ?? '',
        args.localidad ?? '',
        args.provincia ?? '',
        args.pais ?? '',
        typeof args.excluir === 'boolean' ? args.excluir : false
      );
      logApiResponse('REPARTO', apiResponse);
      
      let clienteSeleccionado = null;
      let preciosCliente = null;
      
      const resData = (apiResponse as any).data || apiResponse;
      
      if (resData.clientesCercanos && Array.isArray(resData.clientesCercanos) && resData.clientesCercanos.length > 0) {
        const clientes = resData.clientesCercanos;
        clienteSeleccionado = clientes.reduce((min: any, c: any) => c.distanciaMetros < min.distanciaMetros ? c : min, clientes[0]);
        try {
          const preciosResp = await ListaDePreciosApi.obtenerListaDePrecios(clienteSeleccionado.cliente_id);
          preciosCliente = preciosResp.data || {};
        } catch (err) {
          console.error('[API Debug] Error obteniendo lista de precios:', err);
        }
        resumen = `La dirección está dentro de la zona de cobertura.\nCliente más cercano: ${clienteSeleccionado.cliente_id}, Reparto: ${clienteSeleccionado.nombreReparto}`;
        const datosCliente = {
          cliente_id: clienteSeleccionado.cliente_id,
          nombreReparto: clienteSeleccionado.nombreReparto,
          visitas: clienteSeleccionado.visitas,
          proximaVisita: clienteSeleccionado.proximaVisita,
          diasProximaVisita: clienteSeleccionado.diasProximaVisita,
          precios: preciosCliente
        };
        state.datosClienteReparto = datosCliente;
        resumen += `\nPrecios: ${JSON.stringify(preciosCliente)}`;
      } else if (resData.diasHorarios && resData.diasHorarios.length > 0) {
        resumen = resData.diasHorarios.map((dh: any) => `Día: ${dh.dia}, Horario: ${dh.horario}`).join(" | ");
      } else if (resData.error === 0 || resData.success === true) {
        resumen = "Se encuentra en zona habitual de reparto.";
      }
      
      return resumen;
    },

    // Aliases para retrocompatibilidad con etiquetas legacy del Asistente (UPPERCASE)
    BUSCAR_CLIENTE: async (args: any, context: any) => aquavitaModule.tools.buscarCliente(args, context),
    BUSCAR_CLEINTE: async (args: any, context: any) => aquavitaModule.tools.buscarCliente(args, context),
    BUSCAR_CLIENTE_POR_CONTACTO: async (args: any, context: any) => aquavitaModule.tools.buscarClientePorContacto(args, context),
    CREAR_CLIENTE: async (args: any, context: any) => aquavitaModule.tools.crearCliente(args, context),
    AGREGAR_CONTACTO: async (args: any) => aquavitaModule.tools.agregarContacto(args),
    OBTENER_CREDENCIALES_AUTOGESTION: async (args: any) => aquavitaModule.tools.obtenerCredencialesAutogestion(args),
    OBTENER_SUCURSALES: async (args: any) => aquavitaModule.tools.obtenerSucursales(args),
    OBTENER_SUCURSALES_CLIENTE: async (args: any) => aquavitaModule.tools.obtenerSucursales(args),
    INCIDENCIA: async (args: any, context: any) => aquavitaModule.tools.crearIncidencia(args, context),
    BUSCAR_INCIDENCIA: async (args: any) => aquavitaModule.tools.buscarIncidencia(args),
    SALDO_CUENTA: async (args: any, context: any) => aquavitaModule.tools.obtenerSaldoCuenta(args, context),
    OBTENER_DATOS_CLIENTE: async (args: any) => aquavitaModule.tools.obtenerDatosCliente(args),
    PRECIO: async (args: any) => aquavitaModule.tools.precio(args),
    MATRIZ_LISTA_PRECIOS: async (args: any) => aquavitaModule.tools.matrizListaDePrecios(args),
    ABONOS_TIPOS: async (args: any) => aquavitaModule.tools.abonosTipos(args),
    HISTORIAL_FACTURAS: async (args: any) => aquavitaModule.tools.historialFacturas(args),
    RECIBOS_PAGO: async (args: any) => aquavitaModule.tools.recibosPago(args),
    REENVIAR_FACTURA_POR_MAIL: async (args: any) => aquavitaModule.tools.reenviarFacturaPorMail(args),
    LINK_PAGO: async (args: any) => aquavitaModule.tools.linkPago(args),
    OBTENER_LINK_MERCADO_PAGO: async (args: any) => aquavitaModule.tools.linkPago(args),
    PRODUCTOS: async (args: any) => aquavitaModule.tools.productos(args),
    REPARTO: async (args: any, context: any) => aquavitaModule.tools.reparto(args, context)
  }
};
