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
    if (fecha.toLowerCase().includes('dd/mm')) {
        return '';
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
    // 0. actualizarContexto
    actualizarContexto: async (args: any, context: any) => {
      const { state, ctx } = context;
      await AssistantResponseProcessor.actualizarContextoCliente(state, args, ctx.from);
      return "✅ Memoria de pre-contexto de la conversación actualizada con éxito.";
    },

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
        if (countResultados === 1) {
          datosCliente = resultados[0];
        }
      }

      if (esRespuestaExitosa(respuestaApi)) {
        if (countResultados > 1) {
          return `⚠️ SE ENCONTRARON MÚLTIPLES COINCIDENCIAS (${countResultados} clientes con nombre/datos similares).
NO se ha seleccionado ningún cliente automáticamente para evitar confusiones de cuenta.
DEBES solicitar al usuario su DNI/CUIT, número de cliente o domicilio exacto para desempatar e identificar la cuenta unívoca antes de consultar saldos o generar tickets.

Coincidencias encontradas:
${JSON.stringify(resultados.slice(0, 4).map((c: any) => ({
  cliente_id: c.cliente_id,
  nombre: c.nombreCliente || c.nombrePersona,
  domicilio: c.DomicilioCompleto || `${c.calle || ''} ${c.numeroPuerta || ''}`.trim()
})), null, 2)}`;
        }

        if (datosCliente) {
          await AssistantResponseProcessor.actualizarContextoCliente(state, datosCliente, ctx.from);
          const esBaja = datosCliente.estadoCliente?.trim().toLowerCase() === 'baja';
          if (esBaja) {
            return `⚠️ ATENCIÓN: El cliente se encuentra en estado de "BAJA" (Inactivo). No se permiten realizar nuevos pedidos ni registrar incidencias para clientes en este estado.\n\nDatos completos:\n${JSON.stringify(datosCliente, null, 2)}`;
          } else {
            return `Datos completos del cliente:\n${JSON.stringify(datosCliente, null, 2)}`;
          }
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
      const ctxData = state?.get ? state.get('datosClienteContext') : null;
      const parsedArgs = args.cliente || args.payload?.cliente || args;
      const clienteRaw = {
        ...parsedArgs,
        nombre: parsedArgs.nombre || ctxData?.nombre || '',
        apellido: parsedArgs.apellido || ctxData?.apellido || '',
        direccion: parsedArgs.direccion || ctxData?.direccion || '',
        telefono: parsedArgs.telefono || ctxData?.telefono || '',
        cuit: parsedArgs.cuit || ctxData?.numCliente || ctxData?.dni_cuit || '',
        email: parsedArgs.email || ctxData?.email || '',
      };
      
      if (!clienteRaw.nombre) {
        return "❌ Error: El nombre del cliente es obligatorio para darlo de alta. Solicita el nombre al usuario.";
      }
      
      if (!clienteRaw.direccion) {
        return "❌ Error: La dirección (calle y altura) es obligatoria para dar de alta al cliente. Solicita la dirección completa al usuario.";
      }

      // Fallback para teléfono usando el número del chat actual
      if (!clienteRaw.telefono && ctx?.from) {
        clienteRaw.telefono = ctx.from.split('@')[0];
      }
      
      let nombreCompleto = '';
      if (clienteRaw.nombre && clienteRaw.apellido) {
        nombreCompleto = `${clienteRaw.nombre} ${clienteRaw.apellido}`.trim().toUpperCase();
      } else if (clienteRaw.nombre) {
        nombreCompleto = String(clienteRaw.nombre).trim().toUpperCase();
      } else if (clienteRaw.apellido) {
        nombreCompleto = String(clienteRaw.apellido).trim().toUpperCase();
      }

      // Preservar la dirección literal ingresada por el usuario (calle, número, depto, piso, referencias)
      // Google Maps es consultado internamente por ClientesApi solo para obtener latitud y longitud sin destruir la dirección.

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
      const payload: any = {
        centroDistribucion_id: 1,
        usuarioResponsable_id: getUsuarioId() || null,
        fechaCierreEstimado: getFechaCierreEstimado(),
        estadoIncidente_ids: 1,
        tipoIncidente_ids: args.tipoIncidente_ids ?? args.tipoIncidente_id ?? args.tipo ?? 8,
        subTipoIncidente_ids: args.subTipoIncidente_ids ?? args.subTipoIncidente_id ?? args.subtipo ?? 74,
        descripcion: args.descripcion ?? args.observaciones ?? ''
      };

      const cId = args.cliente_id ?? args.clienteId ?? args.cliente;
      if (cId) {
        payload.cliente_id = Number(cId);
      }

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
        
        const formatCurrency = (val: number) => {
          return `$ ${val.toLocaleString('es-AR', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
        };
        
        const contextData = (state && typeof state.get === 'function') ? (state.get('datosClienteContext') || {}) : {};
        const esFamilia = String(contextData.tipoCliente || '').toLowerCase() === 'familia';
        
        if (esFamilia) {
          return `Saldo total: ${formatCurrency(saldoReal)}. Saldo Consumo: ${formatCurrency(consumo)}`;
        } else {
          return `Saldo total: ${formatCurrency(saldoReal)}`;
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
      
      let desdeVal = args.fechaDesde ?? '';
      let hastaVal = args.fechaHasta ?? '';
      if (!desdeVal || desdeVal.toLowerCase().includes('dd/mm')) {
        // Por defecto, buscar últimos 6 meses si no se especifican fechas, para tener margen
        const sixMonthsAgo = new Date();
        sixMonthsAgo.setMonth(sixMonthsAgo.getMonth() - 6);
        const d = String(sixMonthsAgo.getDate()).padStart(2, '0');
        const m = String(sixMonthsAgo.getMonth() + 1).padStart(2, '0');
        const y = sixMonthsAgo.getFullYear();
        desdeVal = `${d}/${m}/${y}`;
      }
      if (!hastaVal || hastaVal.toLowerCase().includes('dd/mm')) {
        hastaVal = '{{HOY}}';
      }

      const { desde, hasta } = validarRangoFechas(desdeVal, hastaVal);
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
      
      let desdeVal = args.fechaReciboDesde ?? '';
      let hastaVal = args.fechaReciboHasta ?? '';
      if (!desdeVal || desdeVal.toLowerCase().includes('dd/mm')) {
        const sixMonthsAgo = new Date();
        sixMonthsAgo.setMonth(sixMonthsAgo.getMonth() - 6);
        const d = String(sixMonthsAgo.getDate()).padStart(2, '0');
        const m = String(sixMonthsAgo.getMonth() + 1).padStart(2, '0');
        const y = sixMonthsAgo.getFullYear();
        desdeVal = `${d}/${m}/${y}`;
      }
      if (!hastaVal || hastaVal.toLowerCase().includes('dd/mm')) {
        hastaVal = '{{HOY}}';
      }

      const { desde, hasta } = validarRangoFechas(desdeVal, hastaVal);
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
      const { state, ctx } = context;
      let resumen = "❌ SIN COBERTURA: La dirección no se encuentra dentro de la zona habitual de reparto.";
      
      let calleYAltura = args.calleYAltura || `${args.calle ?? ''} ${args.numero ?? ''}`.trim();
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
      const clientes = resData.clientesCercanos || resData.data;
      
      if (clientes && Array.isArray(clientes) && clientes.length > 0) {
        const parseDist = (c: any) => {
          const val = c?.distanciaMetros ?? c?.distancia ?? Infinity;
          const num = typeof val === 'number' ? val : parseFloat(String(val).replace(',', '.'));
          return isNaN(num) ? Infinity : num;
        };
        clienteSeleccionado = clientes.reduce((min: any, c: any) => parseDist(c) < parseDist(min) ? c : min, clientes[0]);
        try {
          const preciosResp = await ListaDePreciosApi.obtenerListaDePrecios(clienteSeleccionado.cliente_id);
          preciosCliente = preciosResp.data || {};
        } catch (err) {
          console.error('[API Debug] Error obteniendo lista de precios:', err);
        }

        // Extracción exhaustiva de los días de visita del cliente más cercano
        const diasEncontrados: string[] = [];
        const parsearItemDia = (v: any) => {
          if (!v) return;
          if (typeof v === 'string') {
            const trimmed = v.trim();
            if (trimmed) diasEncontrados.push(trimmed);
          } else if (typeof v === 'object') {
            const d = v.dia || v.Dia || v.nombreDia || v.NombreDia || v.diaSemana || v.DiaSemana || v.nombre || v.Nombre;
            if (d && typeof d === 'string') diasEncontrados.push(d.trim());
          }
        };

        if (Array.isArray(clienteSeleccionado.visitas)) {
          clienteSeleccionado.visitas.forEach(parsearItemDia);
        } else if (typeof clienteSeleccionado.visitas === 'string') {
          clienteSeleccionado.visitas.split(/[,;\-\/]+/).forEach((s: string) => parsearItemDia(s.trim()));
        }

        if (Array.isArray(clienteSeleccionado.diasVisita)) clienteSeleccionado.diasVisita.forEach(parsearItemDia);
        else if (typeof clienteSeleccionado.diasVisita === 'string') clienteSeleccionado.diasVisita.split(/[,;\-\/]+/).forEach((s: string) => parsearItemDia(s.trim()));

        if (Array.isArray(clienteSeleccionado.diasProximaVisita)) clienteSeleccionado.diasProximaVisita.forEach(parsearItemDia);
        else if (typeof clienteSeleccionado.diasProximaVisita === 'string') clienteSeleccionado.diasProximaVisita.split(/[,;\-\/]+/).forEach((s: string) => parsearItemDia(s.trim()));

        if (typeof clienteSeleccionado.dia === 'string' && clienteSeleccionado.dia.trim()) parsearItemDia(clienteSeleccionado.dia);
        if (typeof clienteSeleccionado.Dia === 'string' && clienteSeleccionado.Dia.trim()) parsearItemDia(clienteSeleccionado.Dia);

        // Si el cliente puntual no tiene visitas fijas asignadas en su ficha, inferir los días desde el nombre de su reparto
        if (diasEncontrados.length === 0 && clienteSeleccionado.nombreReparto && typeof clienteSeleccionado.nombreReparto === 'string') {
          const diasSemana = ['lunes', 'martes', 'miércoles', 'miercoles', 'jueves', 'viernes', 'sábado', 'sabado', 'domingo'];
          const lowerReparto = clienteSeleccionado.nombreReparto.toLowerCase();
          diasSemana.forEach(d => {
            if (lowerReparto.includes(d)) {
              diasEncontrados.push(d.charAt(0).toUpperCase() + d.slice(1));
            }
          });
        }

        const dias = [...new Set(diasEncontrados)];
        const diasStr = dias.length > 0 ? dias.join(', ') : 'A coordinar';
        const repartoId = clienteSeleccionado.reparto_id || clienteSeleccionado.repartoId || 1;

        resumen = `✅ COBERTURA CONFIRMADA: La dirección está dentro de la zona de reparto.\nDías de visita/reparto: ${diasStr}.\nReparto ID: ${repartoId}.`;
        
        const datosCliente = {
          cliente_id: clienteSeleccionado.cliente_id,
          nombreReparto: clienteSeleccionado.nombreReparto,
          visitas: clienteSeleccionado.visitas,
          proximaVisita: clienteSeleccionado.proximaVisita,
          diasProximaVisita: clienteSeleccionado.diasProximaVisita,
          precios: preciosCliente,
          direccion: calleYAltura,
          domicilio: calleYAltura,
          reparto_id: repartoId
        };
        state.datosClienteReparto = datosCliente;

        if (ctx?.from) {
          await AssistantResponseProcessor.actualizarContextoCliente(state, {
            direccion: calleYAltura,
            domicilio: calleYAltura,
            reparto_id: repartoId
          }, ctx.from);
        }

        if (preciosCliente) {
          resumen += `\nPrecios asignados a la zona: ${JSON.stringify(preciosCliente)}`;
        }
      } else if (resData.diasHorarios && resData.diasHorarios.length > 0) {
        const diasStr = resData.diasHorarios.map((dh: any) => `Día: ${dh.dia}, Horario: ${dh.horario}`).join(" | ");
        resumen = `✅ COBERTURA CONFIRMADA: Se encuentra en zona habitual de reparto. ${diasStr}`;
        if (ctx?.from && calleYAltura) {
          await AssistantResponseProcessor.actualizarContextoCliente(state, {
            direccion: calleYAltura,
            domicilio: calleYAltura
          }, ctx.from);
        }
      } else if (resData.error === 0 || resData.success === true) {
        resumen = "✅ COBERTURA CONFIRMADA: Se encuentra en zona habitual de reparto.";
        if (ctx?.from && calleYAltura) {
          await AssistantResponseProcessor.actualizarContextoCliente(state, {
            direccion: calleYAltura,
            domicilio: calleYAltura
          }, ctx.from);
        }
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
    REPARTO: async (args: any, context: any) => aquavitaModule.tools.reparto(args, context),
    ACTUALIZAR_CONTEXTO: async (args: any, context: any) => aquavitaModule.tools.actualizarContexto(args, context)
  },

  // ----------------------------------------------------
  // NATIVE OPENAI TOOLS SCHEMAS FOR AQUAVITA
  // ----------------------------------------------------
  openAiTools: [
    {
      "type": "function",
      "function": {
        "name": "ACTUALIZAR_CONTEXTO",
        "description": "Guarda y actualiza los datos temporales del cliente (nombre, apellido, dirección, teléfono, cuit) en la memoria de la conversación para que el asistente no los olvide.",
        "parameters": {
          "type": "object",
          "properties": {
            "nombre": { "type": "string", "description": "Nombre de pila o de la empresa." },
            "apellido": { "type": "string", "description": "Apellido del cliente." },
            "direccion": { "type": "string", "description": "Dirección completa (calle y número)." },
            "telefono": { "type": "string", "description": "Número de teléfono de contacto." },
            "cuit": { "type": "string", "description": "DNI, CUIT o CUIL." }
          }
        }
      }
    },
    {
      "type": "function",
      "function": {
        "name": "BUSCAR_CLIENTE",
        "description": "Busca clientes registrados en el sistema Aquavita usando datos aproximados como nombre, teléfono, domicilio o filtros de dirección específicos.",
        "parameters": {
          "type": "object",
          "properties": {
            "datosCliente": { "type": "string", "description": "Nombre, apellido o dato general para buscar al cliente." },
            "telefono": { "type": "string", "description": "Número de teléfono de contacto del cliente." },
            "domicilio": { "type": "string", "description": "Calle y altura de la dirección (Córdoba Capital)." },
            "piso": { "type": "string", "description": "Piso de la dirección del cliente." },
            "depto": { "type": "string", "description": "Departamento de la dirección." }
          }
        }
      }
    },
    {
      "type": "function",
      "function": {
        "name": "BUSCAR_CLIENTE_POR_CONTACTO",
        "description": "Busca un cliente de forma exacta usando su teléfono o email de contacto.",
        "parameters": {
          "type": "object",
          "properties": {
            "telefono": { "type": "string", "description": "Teléfono de contacto exacto." },
            "email": { "type": "string", "description": "Correo electrónico del contacto." }
          }
        }
      }
    },
    {
      "type": "function",
      "function": {
        "name": "CREAR_CLIENTE",
        "description": "Crea y da de alta a un nuevo cliente en el sistema de Aquavita.",
        "parameters": {
          "type": "object",
          "properties": {
            "cliente": {
              "type": "object",
              "description": "Objeto con los datos del nuevo cliente.",
              "properties": {
                "nombre": { "type": "string", "description": "Nombre completo o de pila." },
                "apellido": { "type": "string", "description": "Apellido del cliente." },
                "direccion": { "type": "string", "description": "Calle y altura (ej: 'Colón 1500')." },
                "telefono": { "type": "string", "description": "Teléfono de contacto." },
                "email": { "type": "string", "description": "Correo electrónico." },
                "cuit": { "type": "string", "description": "CUIT, CUIL o DNI del cliente." }
              },
              "required": ["nombre", "direccion"]
            },
            "reparto_id": { "type": "integer", "description": "ID del reparto inicial (por defecto 1)." }
          },
          "required": ["cliente"]
        }
      }
    },
    {
      "type": "function",
      "function": {
        "name": "AGREGAR_CONTACTO",
        "description": "Agrega un nuevo contacto (teléfono o correo) asociado a la cuenta de un cliente existente.",
        "parameters": {
          "type": "object",
          "properties": {
            "cliente_id": { "type": "integer", "description": "ID numérico del cliente en el sistema." },
            "telefono": { "type": "string", "description": "Número de teléfono a agregar." },
            "email": { "type": "string", "description": "Correo electrónico a agregar." },
            "nombre": { "type": "string", "description": "Nombre del contacto a agregar." }
          },
          "required": ["cliente_id"]
        }
      }
    },
    {
      "type": "function",
      "function": {
        "name": "OBTENER_CREDENCIALES_AUTOGESTION",
        "description": "Obtiene las credenciales de la web de autogestión de un cliente.",
        "parameters": {
          "type": "object",
          "properties": {
            "cliente_id": { "type": "integer", "description": "ID numérico del cliente." }
          },
          "required": ["cliente_id"]
        }
      }
    },
    {
      "type": "function",
      "function": {
        "name": "OBTENER_SUCURSALES",
        "description": "Obtiene la lista de sucursales asociadas a la cuenta de un cliente.",
        "parameters": {
          "type": "object",
          "properties": {
            "cliente_id": { "type": "integer", "description": "ID numérico del cliente." }
          },
          "required": ["cliente_id"]
        }
      }
    },
    {
      "type": "function",
      "function": {
        "name": "INCIDENCIA",
        "description": "Genera y crea un ticket de incidencia (reclamo, sugerencia o problema técnico) para un cliente.",
        "parameters": {
          "type": "object",
          "properties": {
            "cliente_id": { "type": "integer", "description": "ID numérico del cliente (opcional para incidencias generales)." },
            "tipoIncidente_id": { "type": "integer", "description": "ID del tipo de incidente (ej: 1 para pedidos/reclamos, 2 para servicio técnico, 8 para otras gestiones)." },
            "subTipoIncidente_id": { "type": "integer", "description": "ID del subtipo de incidente (ej: 1 para solicitud de artículos, 74 para otras gestiones)." },
            "observaciones": { "type": "string", "description": "Detalles u observaciones de la incidencia." }
          },
          "required": ["tipoIncidente_id", "observaciones"]
        }
      }
    },
    {
      "type": "function",
      "function": {
        "name": "BUSCAR_INCIDENCIA",
        "description": "Busca incidentes registrados recientemente para un cliente específico.",
        "parameters": {
          "type": "object",
          "properties": {
            "cliente_id": { "type": "integer", "description": "ID numérico del cliente." },
            "tipoIncidente_id": { "type": "integer", "description": "ID del tipo de incidente para filtrar." }
          },
          "required": ["cliente_id"]
        }
      }
    },
    {
      "type": "function",
      "function": {
        "name": "SALDO_CUENTA",
        "description": "Obtiene el saldo de cuenta actual (saldos de consumo, facturación y saldo total) de un cliente.",
        "parameters": {
          "type": "object",
          "properties": {
            "cliente_id": { "type": "integer", "description": "ID numérico del cliente." }
          },
          "required": ["cliente_id"]
        }
      }
    },
    {
      "type": "function",
      "function": {
        "name": "OBTENER_DATOS_CLIENTE",
        "description": "Obtiene la ficha técnica y de datos completos de un cliente registrado por su ID.",
        "parameters": {
          "type": "object",
          "properties": {
            "cliente_id": { "type": "integer", "description": "ID numérico del cliente." }
          },
          "required": ["cliente_id"]
        }
      }
    },
    {
      "type": "function",
      "function": {
        "name": "PRECIO",
        "description": "Obtiene la lista de precios asignada y vigente para un cliente específico.",
        "parameters": {
          "type": "object",
          "properties": {
            "cliente_id": { "type": "integer", "description": "ID numérico del cliente." }
          },
          "required": ["cliente_id"]
        }
      }
    },
    {
      "type": "function",
      "function": {
        "name": "MATRIZ_LISTA_PRECIOS",
        "description": "Obtiene la matriz completa de listas de precios del sistema.",
        "parameters": {
          "type": "object",
          "properties": {
            "tipoLista_id": { "type": "integer", "description": "Tipo de lista de precios (por defecto 1)." },
            "lista_id": { "type": "string", "description": "Filtrar por ID de lista específica." }
          }
        }
      }
    },
    {
      "type": "function",
      "function": {
        "name": "ABONOS_TIPOS",
        "description": "Consulta los tipos de abonos configurados en el sistema entre un rango de fechas.",
        "parameters": {
          "type": "object",
          "properties": {
            "desde": { "type": "string", "description": "Fecha desde (formato DD/MM/YYYY)." },
            "hasta": { "type": "string", "description": "Fecha hasta (formato DD/MM/YYYY)." },
            "concepto": { "type": "string", "description": "Filtrar abonos por concepto." },
            "activo": { "type": "boolean", "description": "Filtro por abonos activos." }
          }
        }
      }
    },
    {
      "type": "function",
      "function": {
        "name": "HISTORIAL_FACTURAS",
        "description": "Obtiene el historial de facturas emitidas para un cliente específico.",
        "parameters": {
          "type": "object",
          "properties": {
            "cliente_id": { "type": "integer", "description": "ID numérico del cliente." },
            "fechaDesde": { "type": "string", "description": "Fecha de inicio del historial (DD/MM/YYYY)." },
            "fechaHasta": { "type": "string", "description": "Fecha de fin del historial (DD/MM/YYYY)." },
            "saldoPendiente": { "type": "boolean", "description": "Filtrar solo facturas con saldo pendiente (por pagar)." }
          },
          "required": ["cliente_id"]
        }
      }
    },
    {
      "type": "function",
      "function": {
        "name": "RECIBOS_PAGO",
        "description": "Consulta el historial de recibos de pago emitidos a favor de un cliente.",
        "parameters": {
          "type": "object",
          "properties": {
            "cliente_id": { "type": "integer", "description": "ID numérico del cliente." },
            "fechaReciboDesde": { "type": "string", "description": "Fecha de inicio de búsqueda (DD/MM/YYYY)." },
            "fechaReciboHasta": { "type": "string", "description": "Fecha de fin de búsqueda (DD/MM/YYYY)." },
            "saldoDisponible": { "type": "boolean", "description": "Filtrar solo recibos con saldo disponible." }
          },
          "required": ["cliente_id"]
        }
      }
    },
    {
      "type": "function",
      "function": {
        "name": "REENVIAR_FACTURA_POR_MAIL",
        "description": "Solicita reenviar una factura electrónica al correo del cliente usando el ID de la factura.",
        "parameters": {
          "type": "object",
          "properties": {
            "facturaId": { "type": "integer", "description": "ID numérico de la factura." }
          },
          "required": ["facturaId"]
        }
      }
    },
    {
      "type": "function",
      "function": {
        "name": "LINK_PAGO",
        "description": "Genera un enlace de cobro de Mercado Pago para un cliente y monto específicos.",
        "parameters": {
          "type": "object",
          "properties": {
            "cliente_id": { "type": "integer", "description": "ID numérico del cliente." },
            "monto": { "type": "number", "description": "Monto de dinero a pagar." }
          },
          "required": ["cliente_id", "monto"]
        }
      }
    },
    {
      "type": "function",
      "function": {
        "name": "PRODUCTOS",
        "description": "Obtiene la lista de productos y dispensers disponibles para el cliente, pudiendo filtrar por categoría.",
        "parameters": {
          "type": "object",
          "properties": {
            "cliente_id": { "type": "integer", "description": "ID numérico del cliente." },
            "categoria": { "type": "string", "description": "Categoría a filtrar (ej. 'soda', 'bidon', 'dispenser')." }
          },
          "required": ["cliente_id"]
        }
      }
    },
    {
      "type": "function",
      "function": {
        "name": "REPARTO",
        "description": "Verifica si una dirección dada está dentro de la zona de reparto habitual y calcula el cliente más cercano y días de visita.",
        "parameters": {
          "type": "object",
          "properties": {
            "calle": { "type": "string", "description": "Nombre de la calle." },
            "numero": { "type": "string", "description": "Altura/Número de la puerta." },
            "calleYAltura": { "type": "string", "description": "Dirección completa (calle y número, ej: Colón 450)." },
            "codigoPostal": { "type": "string", "description": "Código postal de la dirección." },
            "localidad": { "type": "string", "description": "Localidad o ciudad (por defecto Córdoba Capital)." }
          }
        }
      }
    }
  ]
};
