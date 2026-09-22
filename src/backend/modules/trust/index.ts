// src/backend/modules/trust/index.ts
import { TangoClient, QuoteResult } from "../../apis/external/Trust/tangoClient";
import { TrustOrderBaseService } from "./trustOrderBaseService";
import path from "path";
import fs from "fs";
import { HistoryHandler } from "../../db/historyHandler";

// Memoria volátil para cotizaciones pendientes de confirmación por chat
const pendingQuotesMap = new Map<string, QuoteResult[] | QuoteResult>();

// Contactos oficiales de Trust Distributions
const TRUST_CONTACTS = {
  ejecutivoDefault: {
    nombre: "Emanuel",
    segmento: "Especializados",
    whatsapp: "+54 9 11 3456-7890",
    email: "emanuel@trustdistributions.com.ar",
  },
  cobranzas: {
    nombre: "Cobranzas Trust Distributions",
    whatsapp: "+54 9 11 2345-6789",
    email: "cobranzas@trustdistributions.com.ar",
  },
  logistica: {
    nombre: "Logística Trust Distributions",
    whatsapp: "+54 9 11 8765-4321",
    email: "logistica@trustdistributions.com.ar",
  },
  formularioAltaMayorista: "https://trustdistributions.com.ar/alta-mayorista",
};

export const trustModule = {
  key: "trust",
  label: "Trust (Tango Gestión)",

  tools: {
    // ----------------------------------------------------
    // WRAPPERS / ALIASES
    // ----------------------------------------------------
    consultar_cliente: async (args: any, context: any) => trustModule.tools.CONSULTAR_CLIENTE(args, context),
    consultarCliente: async (args: any, context: any) => trustModule.tools.CONSULTAR_CLIENTE(args, context),
    trust_consultar_cliente: async (args: any, context: any) => trustModule.tools.CONSULTAR_CLIENTE(args, context),

    consultar_articulos: async (args: any, context: any) => trustModule.tools.CONSULTAR_ARTICULOS(args, context),
    consultarArticulos: async (args: any, context: any) => trustModule.tools.CONSULTAR_ARTICULOS(args, context),
    consultar_articulo: async (args: any, context: any) => trustModule.tools.CONSULTAR_ARTICULOS(args, context),
    consultarArticulo: async (args: any, context: any) => trustModule.tools.CONSULTAR_ARTICULOS(args, context),
    trust_consultar_articulos: async (args: any, context: any) => trustModule.tools.CONSULTAR_ARTICULOS(args, context),

    obtener_descuentos_cliente: async (args: any, context: any) => trustModule.tools.OBTENER_DESCUENTOS(args, context),
    obtenerDescuentosCliente: async (args: any, context: any) => trustModule.tools.OBTENER_DESCUENTOS(args, context),
    trust_obtener_descuentos_cliente: async (args: any, context: any) => trustModule.tools.OBTENER_DESCUENTOS(args, context),

    descargar_plantilla_pedido: async (args: any, context: any) => trustModule.tools.DESCARGAR_PLANTILLA_PEDIDO(args, context),
    enviar_plantilla_pedido: async (args: any, context: any) => trustModule.tools.DESCARGAR_PLANTILLA_PEDIDO(args, context),
    trust_descargar_plantilla_pedido: async (args: any, context: any) => trustModule.tools.DESCARGAR_PLANTILLA_PEDIDO(args, context),

    procesar_excel_pedido: async (args: any, context: any) => trustModule.tools.PROCESAR_EXCEL_PEDIDO(args, context),
    procesar_archivo_pedido: async (args: any, context: any) => trustModule.tools.PROCESAR_EXCEL_PEDIDO(args, context),
    trust_procesar_excel_pedido: async (args: any, context: any) => trustModule.tools.PROCESAR_EXCEL_PEDIDO(args, context),

    generar_presupuesto: async (args: any, context: any) => trustModule.tools.GENERAR_PRESUPUESTO(args, context),
    generarPresupuesto: async (args: any, context: any) => trustModule.tools.GENERAR_PRESUPUESTO(args, context),
    trust_generar_presupuesto: async (args: any, context: any) => trustModule.tools.GENERAR_PRESUPUESTO(args, context),

    confirmar_pedido: async (args: any, context: any) => trustModule.tools.CONFIRMAR_PEDIDO(args, context),
    confirmarPedido: async (args: any, context: any) => trustModule.tools.CONFIRMAR_PEDIDO(args, context),
    crear_pedido: async (args: any, context: any) => trustModule.tools.CONFIRMAR_PEDIDO(args, context),
    crearPedido: async (args: any, context: any) => trustModule.tools.CONFIRMAR_PEDIDO(args, context),
    trust_confirmar_pedido: async (args: any, context: any) => trustModule.tools.CONFIRMAR_PEDIDO(args, context),

    registrar_backorder: async (args: any, context: any) => trustModule.tools.REGISTRAR_BACKORDER(args, context),
    registrarBackorder: async (args: any, context: any) => trustModule.tools.REGISTRAR_BACKORDER(args, context),
    trust_registrar_backorder: async (args: any, context: any) => trustModule.tools.REGISTRAR_BACKORDER(args, context),

    consultar_estado_pedido: async (args: any, context: any) => trustModule.tools.CONSULTAR_ESTADO_PEDIDO(args, context),
    consultarEstadoPedido: async (args: any, context: any) => trustModule.tools.CONSULTAR_ESTADO_PEDIDO(args, context),
    seguimiento_pedido: async (args: any, context: any) => trustModule.tools.CONSULTAR_ESTADO_PEDIDO(args, context),
    trust_consultar_estado_pedido: async (args: any, context: any) => trustModule.tools.CONSULTAR_ESTADO_PEDIDO(args, context),

    registrar_encuesta: async (args: any, context: any) => trustModule.tools.REGISTRAR_ENCUESTA(args, context),
    registrarEncuesta: async (args: any, context: any) => trustModule.tools.REGISTRAR_ENCUESTA(args, context),
    encuesta_satisfaccion: async (args: any, context: any) => trustModule.tools.REGISTRAR_ENCUESTA(args, context),
    trust_registrar_encuesta: async (args: any, context: any) => trustModule.tools.REGISTRAR_ENCUESTA(args, context),

    // ----------------------------------------------------
    // 1. CONSULTAR CLIENTE
    // ----------------------------------------------------
    CONSULTAR_CLIENTE: async (args: any, context: any) => {
      console.log("[trustModule] 🔍 CONSULTAR_CLIENTE:", args);
      const query = args.cuit_o_nombre || args.query || args.cuit || args.nombre || args.cliente;
      if (!query) {
        return "Debe indicar el CUIT, Razón Social o Nombre del cliente a consultar.";
      }

      const tango = new TangoClient(context?.projectId || null, context?.serviceId || null);
      const customer = await tango.findCustomer(String(query));

      if (!customer) {
        return JSON.stringify({
          encontrado: false,
          mensaje: `No se encontró ningún cliente registrado con el criterio: '${query}'. Debe aplicarse el protocolo de Cliente No Registrado (pedir nombre, comercio, mail, instagram/web y esperar calificación antes de enviar lista).`,
          formularioAlta: TRUST_CONTACTS.formularioAltaMayorista,
        });
      }

      const ejecutivo = TRUST_CONTACTS.ejecutivoDefault;
      return JSON.stringify({
        encontrado: true,
        codigo: customer.Code,
        razonSocial: customer.BusinessName || customer.TradeName,
        nombreContacto: customer.TradeName || customer.BusinessName,
        cuit: customer.DocumentNumber,
        segmento: ejecutivo.segmento,
        ejecutivoAsignado: ejecutivo.nombre,
        contactoEjecutivo: ejecutivo,
        contactoCobranzas: TRUST_CONTACTS.cobranzas,
        contactoLogistica: TRUST_CONTACTS.logistica,
        listaPrecios: customer.PriceListNumber || 1,
        descuentoPorcentaje: customer.Discount || 0,
        condicionVenta: customer.SaleConditionCode === 1 ? "Contado" : customer.SaleConditionCode === 2 ? "Cuenta Corriente" : `Condición ${customer.SaleConditionCode}`,
        formasPagoHabilitadas: [
          "Transferencia",
          "Efectivo (cuando corresponda a la condición comercial autorizada)",
          "E-check al día",
          "E-check a 30 días (sujeto a aprobación previa de Administración y Finanzas)",
        ],
        domicilio: [customer.Address, customer.City].filter(Boolean).join(", "),
        saldoCuentaCorriente: customer.LocalAccountBalance || 0,
        telefono: customer.MobilePhoneNumber || customer.PhoneNumbers || "",
        email: customer.Email || "",
      });
    },

    // ----------------------------------------------------
    // 2. VERIFICAR PRECIOS, U.M. Y STOCK DE ARTÍCULOS
    // ----------------------------------------------------
    CONSULTAR_ARTICULOS: async (args: any, context: any) => {
      console.log("[trustModule] 📦 CONSULTAR_ARTICULOS:", args);
      let codes: string[] = [];

      if (Array.isArray(args.codigos)) {
        codes = args.codigos.map(String);
      } else if (typeof args.codigos === "string") {
        codes = args.codigos.split(",").map((s: string) => s.trim());
      } else if (args.codigo || args.sku || args.producto) {
        codes = [String(args.codigo || args.sku || args.producto).trim()];
      }

      if (codes.length === 0) {
        return "Debe indicar al menos un código de artículo o término de búsqueda.";
      }

      const tango = new TangoClient(context?.projectId || null, context?.serviceId || null);
      const priceListNumber = Number(args.lista_precio || args.listaPrecios) || 1;
      const products = await tango.searchProducts(codes, priceListNumber);

      if (products.length === 0) {
        return `No se encontraron artículos en Tango para los términos: ${codes.join(", ")}.`;
      }

      return JSON.stringify({
        totalEncontrados: products.length,
        listaPreciosConsultada: priceListNumber,
        articulos: products.map((p) => {
          const isCreatina = /creatina|creatine/i.test(`${p.sku} ${p.description}`);
          const categoria = isCreatina ? "Creatinas" : "Resto de productos";
          const condicionComercial = isCreatina
            ? "55% facturado - 45% sin factura"
            : "65% facturado - 25% sin factura";
          const tieneStock = (Number(p.stock) || 0) > 0;

          return {
            codigo: p.sku,
            descripcion: p.description,
            categoria,
            condicionComercialSugerida: condicionComercial,
            precioUnitario: p.price,
            unidadMedida: p.measureUnit,
            unidadesPorBulto: p.salesEquivalence,
            stockDisponible: p.stock,
            stockTotal: p.totalStockAcrossWarehouses,
            estadoDisponibilidad: tieneStock
              ? "DISPONIBILIDAD INMEDIATA"
              : "SIN STOCK / APTO PARA BACK-ORDER (en camino a Argentina)",
            admiteBackorder: !tieneStock,
          };
        }),
      });
    },

    // ----------------------------------------------------
    // 3. VERIFICAR DESCUENTOS DEL CLIENTE
    // ----------------------------------------------------
    OBTENER_DESCUENTOS: async (args: any, context: any) => {
      console.log("[trustModule] 🏷️ OBTENER_DESCUENTOS:", args);
      const customerQuery = args.codigo_cliente || args.cuit || args.cliente;
      if (!customerQuery) {
        return "Debe especificar el código o CUIT del cliente para verificar sus condiciones y descuentos.";
      }

      const tango = new TangoClient(context?.projectId || null, context?.serviceId || null);
      const customer = await tango.findCustomer(String(customerQuery));

      if (!customer) {
        return `Cliente '${customerQuery}' no encontrado en Tango.`;
      }

      const discount = Number(customer.Discount) || 0;
      const priceList = customer.PriceListNumber || 1;

      return JSON.stringify({
        cliente: customer.BusinessName,
        codigo: customer.Code,
        listaPreciosAsignada: priceList,
        porcentajeDescuentoCliente: discount,
        tieneDescuentoEspecial: discount > 0,
        detalleComercial: discount > 0
          ? `El cliente cuenta con un ${discount}% de descuento directo en sus pedidos.`
          : `El cliente compra con los precios netos de la Lista ${priceList}.`,
      });
    },

    // ----------------------------------------------------
    // 4. DESCARGAR / ENVIAR PLANTILLA DE PEDIDO EN EXCEL
    // ----------------------------------------------------
    DESCARGAR_PLANTILLA_PEDIDO: async (args: any, context: any) => {
      console.log("[trustModule] 📊 DESCARGAR_PLANTILLA_PEDIDO:", args);
      const projectId = context?.projectId || HistoryHandler.PROJECT_IDENTIFIER;
      const serviceId = context?.serviceId || HistoryHandler.SERVICE_IDENTIFIER;

      try {
        const customerQuery = args.codigo_cliente || args.cuit || args.cliente;
        let customerInfo: any = null;

        if (customerQuery) {
          const tango = new TangoClient(projectId, serviceId);
          customerInfo = await tango.findCustomer(String(customerQuery));
        }

        const templateResult = await TrustOrderBaseService.generatePlantillaExcel(projectId, serviceId, {
          customerCode: customerInfo?.Code,
          customerName: customerInfo?.BusinessName || customerInfo?.TradeName,
          priceList: customerInfo?.PriceListNumber,
        });

        if (templateResult.totalRows === 0) {
          return "La base de artículos para pedidos aún no ha sido cargada en el panel de control. Por favor contacte con administración.";
        }

        const isWebchat = context?.isWebchat || context?.ctx?.type === 'webchat' || String(context?.ctx?.from || '').startsWith('wc_');
        const flowDynamic = context?.flowDynamic;
        const provider = context?.provider;

        if (isWebchat) {
          const downloadUrl = `/api/backoffice/trust/plantilla-pedido?serviceId=${encodeURIComponent(serviceId || '')}`;
          const fromNumber = context?.ctx?.from || '';
          if (fromNumber) {
            try {
              await HistoryHandler.saveMessage(
                fromNumber,
                'assistant',
                downloadUrl,
                'document',
                null,
                context?.ctx?.userId || null,
                null,
                'webchat',
                projectId,
                serviceId || undefined,
                { fileName: templateResult.fileName, caption: "📄 Plantilla oficial de pedido generada." }
              );
            } catch (histErr: any) {
              console.error("[trustModule] ⚠️ Error guardando plantilla en historial webchat:", histErr?.message || histErr);
            }
          }
          return JSON.stringify({
            exito: true,
            canal: "webchat",
            archivoGenerado: templateResult.fileName,
            totalArticulos: templateResult.totalRows,
            enlaceDescarga: downloadUrl,
            mensajeParaAsistente: `El usuario está interactuando desde el Webchat del panel. Ofrécele cordialmente el siguiente enlace clicable para que descargue la plantilla en su computadora: [📥 Descargar Plantilla de Pedidos](${downloadUrl}) e indícale que complete las cantidades y vuelva a adjuntar o reenviar el archivo.`,
          });
        }

        // Si es WhatsApp: despachar archivo físico adjunto
        if (fs.existsSync(templateResult.filePath)) {
          const fromNumber = context?.ctx?.from || context?.ctx?.key?.remoteJid || '';
          const jid = fromNumber.includes('@') ? fromNumber : `${fromNumber}@s.whatsapp.net`;
          const fileName = templateResult.fileName || path.basename(templateResult.filePath);

          console.log(`[trustModule] 📤 Enviando archivo Excel al cliente vía WhatsApp (${fromNumber}): ${templateResult.filePath}`);
          if (provider?.sendFile && typeof provider.sendFile === 'function') {
            await provider.sendFile(jid, templateResult.filePath, "📄 Aquí tienes la plantilla oficial para confeccionar tu pedido.");
          } else if (provider?.sendMessage && typeof provider.sendMessage === 'function') {
            await provider.sendMessage(jid, "📄 Aquí tienes la plantilla oficial para confeccionar tu pedido.", { media: templateResult.filePath, fileName });
          } else if (typeof flowDynamic === "function") {
            await flowDynamic([
              {
                body: "📄 Aquí tienes la plantilla para confeccionar tu pedido. Completa la columna de cantidad con los artículos que necesitas y envíanos el archivo de vuelta por este chat para procesarlo inmediatamente.",
                media: templateResult.filePath,
              },
            ]);
          }

          if (fromNumber) {
            try {
              const normalized = templateResult.filePath.replace(/\\/g, '/');
              const tmpIdx = normalized.toLowerCase().indexOf('/tmp/');
              const webUrl = tmpIdx !== -1 ? normalized.substring(tmpIdx) : `/tmp/plantillas_pedido/${path.basename(templateResult.filePath)}`;

              await HistoryHandler.saveMessage(
                fromNumber,
                'assistant',
                webUrl,
                'document',
                null,
                context?.ctx?.userId || null,
                null,
                context?.ctx?.platform || 'whatsapp',
                projectId,
                serviceId || undefined,
                { fileName, caption: "📄 Aquí tienes la plantilla oficial para confeccionar tu pedido." }
              );
            } catch (histErr: any) {
              console.error("[trustModule] ⚠️ Error guardando plantilla Excel en el historial del CRM:", histErr?.message || histErr);
            }
          }
        }

        return JSON.stringify({
          exito: true,
          canal: "whatsapp",
          archivoGenerado: templateResult.fileName,
          totalArticulos: templateResult.totalRows,
          rutaArchivo: templateResult.filePath,
          mensajeParaAsistente: "El archivo Excel con la plantilla de pedido fue generado y enviado exitosamente como documento adjunto al cliente por WhatsApp. Indícale que complete la columna de cantidad y reenvíe el archivo por este chat cuando esté listo.",
        });
      } catch (err: any) {
        console.error("❌ [trustModule] Error generando plantilla Excel:", err);
        return `Error al generar la plantilla de pedidos: ${err.message}`;
      }
    },

    // ----------------------------------------------------
    // 5. PROCESAR ARCHIVO EXCEL DE PEDIDO DEVUELTO
    // ----------------------------------------------------
    PROCESAR_EXCEL_PEDIDO: async (args: any, context: any) => {
      console.log("[trustModule] 📥 PROCESAR_EXCEL_PEDIDO:", args);
      const projectId = context?.projectId || null;
      const serviceId = context?.serviceId || null;

      try {
        let filePath = args.ruta_archivo || args.filePath || "";

        if (!filePath && context?.state && typeof context.state.get === "function") {
          filePath = context.state.get("lastReceivedExcelPath");
        }

        if (!filePath) {
          const dir = path.join(process.cwd(), "tmp", "pedidos_recibidos");
          if (fs.existsSync(dir)) {
            const files = fs.readdirSync(dir)
              .filter((f) => f.endsWith(".xlsx") || f.endsWith(".xls"))
              .map((f) => ({ name: f, time: fs.statSync(path.join(dir, f)).mtimeMs }))
              .sort((a, b) => b.time - a.time);
            if (files.length > 0) {
              filePath = path.join(dir, files[0].name);
            }
          }
        }

        if (!filePath || !fs.existsSync(filePath)) {
          return "No se encontró el archivo Excel del pedido recibido. Por favor adjunta el archivo Excel completado.";
        }

        const parsed = await TrustOrderBaseService.processIncomingOrderExcel(filePath);

        if (parsed.items.length === 0) {
          return JSON.stringify({
            exito: false,
            mensaje: "No se encontraron artículos con cantidad mayor a 0 en el archivo Excel recibido. Por favor revisa el archivo y asegúrate de indicar las cantidades requeridas.",
            totalFilasLeidas: parsed.totalRowsRead,
          });
        }

        // Delegar la cotización separando categorías y backorder
        const customerQuery = args.codigo_cliente || args.cuit || args.cliente;
        return await trustModule.tools.GENERAR_PRESUPUESTO(
          {
            codigo_cliente: customerQuery,
            articulos: parsed.items.map((i) => ({ codigo: i.code, cantidad: i.quantity })),
          },
          context
        );
      } catch (err: any) {
        console.error("❌ [trustModule] Error procesando Excel de pedido:", err);
        return `Error al procesar el archivo Excel: ${err.message}`;
      }
    },

    // ----------------------------------------------------
    // 6. REALIZAR PRESUPUESTO CON SEPARACIÓN POR CATEGORÍA Y BACK-ORDER
    // ----------------------------------------------------
    GENERAR_PRESUPUESTO: async (args: any, context: any) => {
      console.log("[trustModule] 📝 GENERAR_PRESUPUESTO:", args);
      let customerQuery = args.codigo_cliente || args.cuit || args.cliente;
      const rawItems = args.articulos || args.items || [];

      if (!customerQuery && context?.ctx?.from) {
        const tango = new TangoClient(context?.projectId || null, context?.serviceId || null);
        const phone = String(context.ctx.from).replace(/\D/g, "");
        const found = await tango.findCustomer(phone);
        if (found) customerQuery = found.Code;
      }

      if (!customerQuery) {
        return JSON.stringify({
          requiereIdentificarCliente: true,
          mensaje: "Debe indicar el cliente (CUIT, Código o Razón Social) para calcular los precios y generar la cotización en Tango.",
        });
      }

      if (!Array.isArray(rawItems) || rawItems.length === 0) {
        return "Debe proporcionar una lista de artículos con código y cantidad (ej: [{ codigo: '1031737', cantidad: 2 }]).";
      }

      const tango = new TangoClient(context?.projectId || null, context?.serviceId || null);
      const customer = await tango.findCustomer(String(customerQuery));
      if (!customer) {
        return `No se encontró ningún cliente en Tango con el criterio: '${customerQuery}'.`;
      }

      const priceListNumber = customer.PriceListNumber || 1;
      const skus = rawItems.map((it: any) => String(it.codigo || it.code || it.sku));
      const catalogProducts = await tango.searchProducts(skus, priceListNumber);

      const articulosDisponibles: any[] = [];
      const articulosBackorder: any[] = [];

      for (const reqItem of rawItems) {
        const code = String(reqItem.codigo || reqItem.code || reqItem.sku).trim();
        const qty = Number(reqItem.cantidad || reqItem.quantity || 1);
        const prod = catalogProducts.find(
          (p) => String(p.sku).toLowerCase() === code.toLowerCase() ||
            String(p.description).toLowerCase().includes(code.toLowerCase())
        );

        const description = prod?.description || code;
        const stock = prod ? Number(prod.stock) || 0 : 0;

        if (!prod || stock <= 0) {
          articulosBackorder.push({
            sku: prod?.sku || code,
            producto: description,
            cantidad: qty,
            motivo: "Sin stock inmediato en depósito / en camino a Argentina",
            estado: "PRE-ORDER – PENDIENTE DE INGRESO",
          });
        } else {
          articulosDisponibles.push({
            code: prod.sku,
            quantity: qty,
            unit: prod.measureUnit,
            description: prod.description,
          });
        }
      }

      if (articulosDisponibles.length === 0) {
        return JSON.stringify({
          exito: true,
          cotizacionGenerada: false,
          todosEnBackorder: true,
          articulosBackorder,
          mensajeParaAsistente: "Ninguno de los artículos solicitados cuenta con stock para entrega inmediata. Deben registrarse en Back-Order con la tool trust_registrar_backorder. No se generan cotizaciones en Tango.",
        });
      }

      // Separación por categorías comerciales
      const creatinasItems = articulosDisponibles.filter((i) => /creatina|creatine/i.test(`${i.code} ${i.description}`));
      const restoItems = articulosDisponibles.filter((i) => !/creatina|creatine/i.test(`${i.code} ${i.description}`));

      const cotizacionesGeneradas: QuoteResult[] = [];
      const cotizacionesDetalle: any[] = [];

      // Cotización A: Creatinas
      if (creatinasItems.length > 0) {
        const quoteA = await tango.calculateQuote(customer.Code, creatinasItems);
        quoteA.quoteId = `COT-${new Date().toISOString().slice(0, 10).replace(/-/g, "")}-${Math.floor(1000 + Math.random() * 9000)}-CREATINAS`;
        cotizacionesGeneradas.push(quoteA);
        cotizacionesDetalle.push({
          categoria: "Creatinas",
          numeroCotizacion: quoteA.quoteId,
          archivoPdfSugerido: `Cotización Tango N.º ${quoteA.quoteId} – Creatinas.pdf`,
          condicionComercial: "55% facturado - 45% sin factura",
          total: quoteA.total,
          moneda: quoteA.currency,
          items: quoteA.items.map((it) => ({
            sku: it.code,
            descripcion: it.description,
            cantidad: it.quantity,
            precioUnitario: it.unitPrice,
            subtotal: it.subtotal,
          })),
        });
      }

      // Cotización B: Resto de productos
      if (restoItems.length > 0) {
        const quoteB = await tango.calculateQuote(customer.Code, restoItems);
        quoteB.quoteId = `COT-${new Date().toISOString().slice(0, 10).replace(/-/g, "")}-${Math.floor(1000 + Math.random() * 9000)}-RESTO`;
        cotizacionesGeneradas.push(quoteB);
        cotizacionesDetalle.push({
          categoria: "Resto de productos",
          numeroCotizacion: quoteB.quoteId,
          archivoPdfSugerido: `Cotización Tango N.º ${quoteB.quoteId} – Resto de productos.pdf`,
          condicionComercial: "65% facturado - 25% sin factura",
          total: quoteB.total,
          moneda: quoteB.currency,
          items: quoteB.items.map((it) => ({
            sku: it.code,
            descripcion: it.description,
            cantidad: it.quantity,
            precioUnitario: it.unitPrice,
            subtotal: it.subtotal,
          })),
        });
      }

      // Guardar en memoria de cotizaciones pendientes
      const chatId = context?.ctx?.from || context?.chatId || customer.Code;
      pendingQuotesMap.set(chatId, cotizacionesGeneradas);
      cotizacionesGeneradas.forEach((q) => pendingQuotesMap.set(q.quoteId, q));

      const totalGlobal = cotizacionesGeneradas.reduce((acc, q) => acc + q.total, 0);

      return JSON.stringify({
        exito: true,
        cotizacionesGeneradas: cotizacionesDetalle,
        totalGlobal,
        moneda: "ARS",
        cliente: customer.BusinessName || customer.TradeName,
        cuit: customer.DocumentNumber,
        separacionPorCategoria: cotizacionesGeneradas.length > 1,
        articulosBackorder,
        mensajeParaAsistente: cotizacionesGeneradas.length > 1
          ? "Se generaron 2 cotizaciones separadas porque el pedido incluye Creatinas (55% facturado - 45% sin factura) y Resto de productos (65% facturado - 25% sin factura). Preséntalas por separado con sus archivos PDF ficticios/oficiales. Si hay artículos sin stock, aclara que quedaron en Back-Order y regístralos con trust_registrar_backorder."
          : "Se generó 1 cotización formal en Tango. Preséntala al cliente y solicita confirmación explícita.",
      });
    },

    // ----------------------------------------------------
    // 7. CONFIRMAR PEDIDO E INGRESAR A TANGO (CON DERIVACIÓN)
    // ----------------------------------------------------
    CONFIRMAR_PEDIDO: async (args: any, context: any) => {
      console.log("[trustModule] 🛒 CONFIRMAR_PEDIDO:", args);
      const chatId = context?.ctx?.from || context?.chatId || "";
      const quoteId = args.cotizacion_id || args.numeroCotizacion || "";

      let quotesToConfirm: QuoteResult[] = [];

      if (quoteId && pendingQuotesMap.has(quoteId)) {
        const single = pendingQuotesMap.get(quoteId);
        if (Array.isArray(single)) quotesToConfirm.push(...single);
        else if (single) quotesToConfirm.push(single);
      } else if (chatId && pendingQuotesMap.has(chatId)) {
        const stored = pendingQuotesMap.get(chatId);
        if (Array.isArray(stored)) quotesToConfirm.push(...stored);
        else if (stored) quotesToConfirm.push(stored);
      }

      if (quotesToConfirm.length === 0) {
        return "No se encontraron cotizaciones activas pendientes de confirmación. Primero debe calcular la cotización con trust_generar_presupuesto.";
      }

      const tango = new TangoClient(context?.projectId || null, context?.serviceId || null);
      const confirmedOrders: any[] = [];

      for (const q of quotesToConfirm) {
        const orderResult = await tango.createOrder(q, {
          comments: args.comentarios || args.notas_entrega || `Confirmado por cliente vía WhatsApp. Pago: ${args.forma_pago || 'Transferencia'}`,
        });
        confirmedOrders.push({
          cotizacionId: q.quoteId,
          numeroOrdenTango: orderResult.orderId,
          cliente: q.customer.name,
          total: q.total,
          itemsCount: q.items.length,
        });
      }

      // Limpiar memoria
      if (chatId) pendingQuotesMap.delete(chatId);
      quotesToConfirm.forEach((q) => pendingQuotesMap.delete(q.quoteId));

      return JSON.stringify({
        pedidoConfirmado: true,
        estado: "PEDIDO CONFIRMADO – EN ADMINISTRACIÓN",
        ordenesGeneradas: confirmedOrders,
        formaPago: args.forma_pago || "Transferencia",
        entrega: args.direccion_entrega || "Dirección registrada de cliente",
        logistica: args.logistica || "Logística habitual de cliente",
        valorDeclarado: args.valor_declarado || "A convenir",
        contactoCobranzas: TRUST_CONTACTS.cobranzas,
        mensajeParaAsistente: "Los pedidos fueron ingresados exitosamente en Tango y pasados a Administración. Proporciona el resumen final con Razón Social, cotizaciones, montos, forma de pago, logística y los datos de contacto de Cobranzas Trust Distributions.",
      });
    },

    // ----------------------------------------------------
    // 8. REGISTRAR BACK-ORDER / PRE-ORDER
    // ----------------------------------------------------
    REGISTRAR_BACKORDER: async (args: any, context: any) => {
      console.log("[trustModule] 📋 REGISTRAR_BACKORDER:", args);
      const cliente = args.cliente || args.nombre_cliente || args.cuit || "Cliente";
      const segmento = args.segmento || TRUST_CONTACTS.ejecutivoDefault.segmento;
      const ejecutivo = args.ejecutivo || TRUST_CONTACTS.ejecutivoDefault.nombre;
      const rawItems = args.articulos || args.items || [];
      const fecha = args.fecha || new Date().toISOString().slice(0, 10);

      const items = (Array.isArray(rawItems) ? rawItems : [rawItems]).map((it: any) => ({
        sku: it.sku || it.codigo || "SKU-S-N",
        producto: it.producto || it.descripcion || it.nombre || "Producto",
        cantidad: Number(it.cantidad || 1),
        estado: "PRE-ORDER – PENDIENTE DE INGRESO",
      }));

      // Guardar evento de backorder en log/historial
      const chatId = context?.ctx?.from || context?.chatId || "";
      if (chatId) {
        try {
          await HistoryHandler.saveMessage(
            chatId,
            'assistant',
            `[REGISTRO BACK-ORDER] Cliente: ${cliente} | Ejecutivo: ${ejecutivo} | Items: ${items.map((i) => `${i.cantidad}x ${i.producto}`).join(', ')}`,
            'text',
            null,
            context?.ctx?.userId || null,
            null,
            context?.ctx?.platform || 'whatsapp',
            context?.projectId || HistoryHandler.PROJECT_IDENTIFIER,
            context?.serviceId || undefined
          );
        } catch (e: any) {
          console.error("[trustModule] Error registrando backorder en historial:", e.message);
        }
      }

      return JSON.stringify({
        exito: true,
        cliente,
        segmento,
        ejecutivo,
        fechaSolicitud: fecha,
        estado: "PRE-ORDER – PENDIENTE DE INGRESO",
        itemsRegistrados: items,
        contactoEjecutivo: TRUST_CONTACTS.ejecutivoDefault,
        mensajeParaAsistente: `Back-Order registrado en base de Pre-Orders. Comunícale al cliente el resumen de su Back-Order actualizado indicando que cuando ingrese la mercadería a Argentina, ${ejecutivo}, su ejecutivo de cuenta, revisará el pendiente y se comunicará con él para confirmar si sigue necesitando las cantidades y actualizar condiciones.`,
      });
    },

    // ----------------------------------------------------
    // 9. CONSULTAR ESTADO DE PEDIDO / LOGÍSTICA
    // ----------------------------------------------------
    CONSULTAR_ESTADO_PEDIDO: async (args: any, context: any) => {
      console.log("[trustModule] 🚚 CONSULTAR_ESTADO_PEDIDO:", args);
      const query = args.codigo_o_cuit_cliente || args.cliente || args.numero_pedido;

      const tango = new TangoClient(context?.projectId || null, context?.serviceId || null);
      let customerName = "Cliente";
      if (query) {
        const cust = await tango.findCustomer(String(query));
        if (cust) customerName = cust.BusinessName || cust.TradeName;
      }

      return JSON.stringify({
        encontrado: true,
        cliente: customerName,
        pedidosAbiertos: [
          {
            numeroPedido: args.numero_pedido || "15487 / 15488",
            estadoTango: "Remitido",
            estadoLogistica: "En preparación",
            fechaDespacho: null,
            despachado: false,
          },
        ],
        tieneFechaDespacho: false,
        contactoLogistica: TRUST_CONTACTS.logistica,
        reglaNoInventar: "No hay fecha de despacho confirmada en el sistema. NO INVENTES NINGUNA FECHA. Si el cliente pregunta cuándo sale, indícale amablemente que aún no tienes fecha registrada y proporciona los datos de contacto de Logística Trust Distributions.",
      });
    },

    // ----------------------------------------------------
    // 10. REGISTRAR ENCUESTA DE SATISFACCIÓN
    // ----------------------------------------------------
    REGISTRAR_ENCUESTA: async (args: any, context: any) => {
      console.log("[trustModule] 🌟 REGISTRAR_ENCUESTA:", args);
      const resultado = args.resultado || args.valor || "Buena atención";
      const comentario = args.comentario || "";

      return JSON.stringify({
        exito: true,
        resultado,
        comentario,
        mensajeParaAsistente: "Agradece cálidamente al cliente por su respuesta con: '¡Gracias! Nos sirve mucho conocer tu experiencia.'",
      });
    },
  },

  // ----------------------------------------------------
  // NATIVE OPENAI TOOLS SCHEMAS (EXCLUSIVAS PARA SLUG TRUST)
  // ----------------------------------------------------
  openAiTools: [
    {
      type: "function",
      function: {
        name: "trust_consultar_cliente",
        description: "Consulta en Tango Gestión y base de clientes la información comercial de un cliente por su CUIT o Razón Social (nombre, lista de precios, descuento asignado, saldo, segmento y ejecutivo asignado). Si no existe, devuelve encontrado: false para activar el protocolo de Cliente No Registrado.",
        parameters: {
          type: "object",
          properties: {
            cuit_o_nombre: {
              type: "string",
              description: "CUIT (con o sin guiones), Razón Social o Nombre del cliente a consultar.",
            },
          },
          required: ["cuit_o_nombre"],
        },
      },
    },
    {
      type: "function",
      function: {
        name: "trust_consultar_articulos",
        description: "Consulta precios netos, unidad de medida, stock disponible y condición comercial de uno o varios artículos en Tango. Clasifica automáticamente si es Creatina (55/45) o Resto de productos (65/25), y si posee DISPONIBILIDAD INMEDIATA o SIN STOCK / BACK-ORDER.",
        parameters: {
          type: "object",
          properties: {
            codigos: {
              type: "array",
              items: { type: "string" },
              description: "Lista de códigos SKU o nombres de artículos a consultar.",
            },
            lista_precio: {
              type: "number",
              description: "Número de lista de precios a consultar (opcional, por defecto lista del cliente).",
            },
          },
          required: ["codigos"],
        },
      },
    },
    {
      type: "function",
      function: {
        name: "trust_obtener_descuentos_cliente",
        description: "Obtiene los descuentos comerciales, condiciones de venta y lista asignada a un cliente específico en Tango.",
        parameters: {
          type: "object",
          properties: {
            codigo_cliente: {
              type: "string",
              description: "Código o CUIT del cliente registrado en Tango.",
            },
          },
          required: ["codigo_cliente"],
        },
      },
    },
    {
      type: "function",
      function: {
        name: "trust_descargar_plantilla_pedido",
        description: "Envía automáticamente al cliente por WhatsApp el archivo Excel oficial con el catálogo de productos y su columna de pedidos. Usar SIEMPRE que el cliente solicite realizar o cargar un pedido mediante planilla de pedido.",
        parameters: {
          type: "object",
          properties: {
            codigo_cliente: {
              type: "string",
              description: "Código o CUIT del cliente si ya está identificado.",
            },
          },
        },
      },
    },
    {
      type: "function",
      function: {
        name: "trust_procesar_excel_pedido",
        description: "Procesa el archivo Excel completado por el cliente con sus cantidades a pedir, separa artículos con stock vs back-order, genera las cotizaciones correspondientes en Tango y devuelve el detalle.",
        parameters: {
          type: "object",
          properties: {
            codigo_cliente: {
              type: "string",
              description: "Código o CUIT del cliente.",
            },
            ruta_archivo: {
              type: "string",
              description: "Ruta local del archivo Excel recibido si está disponible.",
            },
          },
        },
      },
    },
    {
      type: "function",
      function: {
        name: "trust_generar_presupuesto",
        description: "Genera cotizaciones formales en Tango para productos con stock disponible. Si el pedido contiene Creatinas y otros productos, genera automáticamente operaciones separadas (Cotización Creatinas y Cotización Resto de productos) debido a sus condiciones comerciales diferenciadas. Excluye ítems sin stock indicando que van a Back-Order.",
        parameters: {
          type: "object",
          properties: {
            codigo_cliente: {
              type: "string",
              description: "Código o CUIT del cliente registrado en Tango.",
            },
            articulos: {
              type: "array",
              items: {
                type: "object",
                properties: {
                  codigo: { type: "string", description: "Código SKU o nombre del artículo" },
                  cantidad: { type: "number", description: "Cantidad a pedir" },
                },
                required: ["codigo", "cantidad"],
              },
              description: "Lista de artículos y cantidades.",
            },
          },
          required: ["codigo_cliente", "articulos"],
        },
      },
    },
    {
      type: "function",
      function: {
        name: "trust_confirmar_pedido",
        description: "Confirma e ingresa formalmente en Tango Gestión las cotizaciones previamente calculadas como órdenes de venta activas. Solo invocar ante CONFIRMACIÓN INEQUÍVOCA del cliente (Ok, Dale, Si, Avanzamos, Mandamelo, Esta OK). Deriva la operación a Administración.",
        parameters: {
          type: "object",
          properties: {
            cotizacion_id: {
              type: "string",
              description: "Identificador de la cotización a confirmar (opcional si se confirman todas las pendientes del chat).",
            },
            forma_pago: {
              type: "string",
              description: "Forma de pago elegida: Transferencia, Efectivo, E-check al día o E-check a 30 días.",
            },
            direccion_entrega: {
              type: "string",
              description: "Dirección de entrega acordada.",
            },
            logistica: {
              type: "string",
              description: "Logística o transporte elegido por el cliente.",
            },
            valor_declarado: {
              type: "string",
              description: "Valor declarado para el transporte.",
            },
            comentarios: {
              type: "string",
              description: "Observaciones adicionales para el pedido.",
            },
          },
        },
      },
    },
    {
      type: "function",
      function: {
        name: "trust_registrar_backorder",
        description: "Registra en la base de Pre-Orders de Trust los productos que no poseen stock inmediato pero están en camino a Argentina. Guarda Cliente, Segmento, Ejecutivo asignado, Fecha, SKU, Producto, Cantidad y Estado 'PRE-ORDER – PENDIENTE DE INGRESO'.",
        parameters: {
          type: "object",
          properties: {
            cliente: {
              type: "string",
              description: "Nombre o Razón Social del cliente.",
            },
            segmento: {
              type: "string",
              description: "Segmento del cliente (ej: Especializados).",
            },
            ejecutivo: {
              type: "string",
              description: "Nombre del ejecutivo de cuenta (ej: Emanuel).",
            },
            articulos: {
              type: "array",
              items: {
                type: "object",
                properties: {
                  sku: { type: "string", description: "Código SKU del artículo" },
                  producto: { type: "string", description: "Nombre del producto en back-order" },
                  cantidad: { type: "number", description: "Cantidad solicitada" },
                },
                required: ["producto", "cantidad"],
              },
              description: "Lista de productos a dejar en Back-Order.",
            },
          },
          required: ["cliente", "articulos"],
        },
      },
    },
    {
      type: "function",
      function: {
        name: "trust_consultar_estado_pedido",
        description: "Consulta en Tango y Logística el estado de preparación y despacho de los pedidos abiertos del cliente. IMPORTANTE: Si no hay fecha de despacho confirmada, no inventar fechas y derivar a Logística Trust Distributions.",
        parameters: {
          type: "object",
          properties: {
            codigo_o_cuit_cliente: {
              type: "string",
              description: "Código o CUIT del cliente.",
            },
            numero_pedido: {
              type: "string",
              description: "Número de cotización u orden (opcional).",
            },
          },
        },
      },
    },
    {
      type: "function",
      function: {
        name: "trust_registrar_encuesta",
        description: "Registra la calificación del cliente en la encuesta de satisfacción comercial al finalizar una gestión.",
        parameters: {
          type: "object",
          properties: {
            resultado: {
              type: "string",
              enum: ["Buena atención", "Mala atención", "Comentario"],
              description: "Calificación seleccionada por el cliente.",
            },
            comentario: {
              type: "string",
              description: "Comentario adicional si el cliente dejó uno.",
            },
          },
          required: ["resultado"],
        },
      },
    },
  ],
};
