// src/backend/modules/trust/index.ts
import { TangoClient, QuoteResult } from "../../apis/external/Trust/tangoClient";
import { TrustOrderBaseService } from "./trustOrderBaseService";
import path from "path";
import fs from "fs";

// Memoria volátil para cotizaciones pendientes de confirmación por chat
const pendingQuotesMap = new Map<string, QuoteResult>();

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

    generar_presupuesto: async (args: any, context: any) => trustModule.tools.GENERAR_PRESUPUESTO(args, context),
    generarPresupuesto: async (args: any, context: any) => trustModule.tools.GENERAR_PRESUPUESTO(args, context),
    trust_generar_presupuesto: async (args: any, context: any) => trustModule.tools.GENERAR_PRESUPUESTO(args, context),

    confirmar_pedido: async (args: any, context: any) => trustModule.tools.CONFIRMAR_PEDIDO(args, context),
    confirmarPedido: async (args: any, context: any) => trustModule.tools.CONFIRMAR_PEDIDO(args, context),
    crear_pedido: async (args: any, context: any) => trustModule.tools.CONFIRMAR_PEDIDO(args, context),
    crearPedido: async (args: any, context: any) => trustModule.tools.CONFIRMAR_PEDIDO(args, context),
    trust_confirmar_pedido: async (args: any, context: any) => trustModule.tools.CONFIRMAR_PEDIDO(args, context),

    descargar_plantilla_pedido: async (args: any, context: any) => trustModule.tools.DESCARGAR_PLANTILLA_PEDIDO(args, context),
    enviar_plantilla_pedido: async (args: any, context: any) => trustModule.tools.DESCARGAR_PLANTILLA_PEDIDO(args, context),
    trust_descargar_plantilla_pedido: async (args: any, context: any) => trustModule.tools.DESCARGAR_PLANTILLA_PEDIDO(args, context),

    procesar_excel_pedido: async (args: any, context: any) => trustModule.tools.PROCESAR_EXCEL_PEDIDO(args, context),
    procesar_archivo_pedido: async (args: any, context: any) => trustModule.tools.PROCESAR_EXCEL_PEDIDO(args, context),
    trust_procesar_excel_pedido: async (args: any, context: any) => trustModule.tools.PROCESAR_EXCEL_PEDIDO(args, context),

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
        return `No se encontró ningún cliente en Tango con el criterio: '${query}'. Verifique el CUIT o Razón Social.`;
      }

      return JSON.stringify({
        encontrado: true,
        codigo: customer.Code,
        razonSocial: customer.BusinessName || customer.TradeName,
        cuit: customer.DocumentNumber,
        listaPrecios: customer.PriceListNumber || 1,
        descuentoPorcentaje: customer.Discount || 0,
        condicionVenta: customer.SaleConditionCode === 1 ? "Contado" : customer.SaleConditionCode === 2 ? "Cuenta Corriente" : `Condición ${customer.SaleConditionCode}`,
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
        articulos: products.map((p) => ({
          codigo: p.sku,
          descripcion: p.description,
          precioUnitario: p.price,
          unidadMedida: p.measureUnit,
          unidadesPorBulto: p.salesEquivalence,
          stockDisponible: p.stock,
          stockTotal: p.totalStockAcrossWarehouses,
        })),
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
      const projectId = context?.projectId || null;
      const serviceId = context?.serviceId || null;

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

        // Si tenemos flowDynamic o provider en el contexto, enviamos el archivo por WhatsApp
        const flowDynamic = context?.flowDynamic;
        if (typeof flowDynamic === "function" && fs.existsSync(templateResult.filePath)) {
          console.log(`[trustModule] 📤 Enviando archivo Excel al cliente vía flowDynamic: ${templateResult.filePath}`);
          await flowDynamic([
            {
              body: "📄 Aquí tienes la plantilla actualizada para confeccionar tu pedido. Completa la columna *CANTIDAD A PEDIR* con los artículos que necesitas y envíanos el archivo de vuelta por este chat para procesarlo inmediatamente.",
              media: templateResult.filePath,
            },
          ]);
        }

        return JSON.stringify({
          exito: true,
          archivoGenerado: templateResult.fileName,
          totalArticulos: templateResult.totalRows,
          rutaArchivo: templateResult.filePath,
          mensajeParaAsistente: "El archivo Excel con la plantilla de pedido fue generado y enviado exitosamente al cliente por WhatsApp. Indícale que complete la columna 'CANTIDAD A PEDIR' y reenvíe el archivo por este chat cuando esté listo.",
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

        // Si no vino en los args, intentar obtenerlo del estado de la conversación
        if (!filePath && context?.state) {
          if (typeof context.state.get === "function") {
            filePath = context.state.get("lastReceivedExcelPath");
          }
        }

        // Si aún no está, buscar el último archivo Excel en ./tmp/pedidos_recibidos/
        if (!filePath) {
          const dir = path.join(process.cwd(), "tmp", "pedidos_recibidos");
          if (fs.existsSync(dir)) {
            const files = fs.readdirSync(dir)
              .filter((f) => f.endsWith(".xlsx") || f.endsWith(".xls"))
              .map((f) => ({ name: f, time: fs.statSync(path.join(dir, f)).mtimeMs }))
              .sort((a, b) => b.time - a.time);
            if (files.length > 0) {
              filePath = path.join(dir, files[0].name);
              console.log(`[trustModule] Archivo Excel resuelto desde carpeta recibidos: ${filePath}`);
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
            mensaje: "No se encontraron artículos con cantidad mayor a 0 en la columna 'CANTIDAD A PEDIR' del archivo Excel recibido. Por favor revisa el archivo y asegúrate de indicar las cantidades requeridas.",
            totalFilasLeidas: parsed.totalRowsRead,
          });
        }

        // Determinar cliente para cotizar
        const tango = new TangoClient(projectId, serviceId);
        let customerQuery = args.codigo_cliente || args.cuit || args.cliente;

        if (!customerQuery && context?.ctx?.from) {
          const phone = String(context.ctx.from).replace(/\D/g, "");
          const found = await tango.findCustomer(phone);
          if (found) {
            customerQuery = found.Code;
          }
        }

        if (!customerQuery) {
          return JSON.stringify({
            exito: true,
            requiereIdentificarCliente: true,
            totalItemsDetectados: parsed.items.length,
            items: parsed.items,
            mensaje: `Se detectaron ${parsed.items.length} artículos en el archivo Excel. Por favor indícame tu CUIT o Código de Cliente para calcular los precios y descuentos correspondientes de tu cuenta en Tango.`,
          });
        }

        // Calcular presupuesto con Tango
        const quote = await tango.calculateQuote(String(customerQuery), parsed.items);

        // Guardar cotización pendiente en memoria
        const chatId = context?.ctx?.from || context?.chatId || quote.customer.code;
        pendingQuotesMap.set(chatId, quote);
        pendingQuotesMap.set(quote.quoteId, quote);

        return JSON.stringify({
          exito: true,
          cotizacionGenerada: true,
          numeroCotizacion: quote.quoteId,
          cliente: quote.customer.name,
          cuit: quote.customer.document,
          listaPrecios: quote.customer.priceListNumber,
          descuentoCliente: `${quote.customer.discountPercentage}%`,
          totalArticulosPedios: quote.items.length,
          items: quote.items.map((i) => ({
            codigo: i.code,
            descripcion: i.description,
            cantidad: i.quantity,
            unidad: i.measureUnit,
            precioUnitario: i.unitPrice,
            descuento: `${i.discountPercentage}%`,
            subtotal: i.subtotal,
          })),
          subtotalBruto: quote.subtotal,
          totalDescuento: quote.totalDiscount,
          totalFinal: quote.total,
          moneda: quote.currency,
          mensajeParaCliente: `✅ Hemos procesado tu archivo Excel. Se cotizaron *${quote.items.length} productos* por un total final de *$${quote.total.toLocaleString("es-AR")}* (Cotización #${quote.quoteId}). ¿Deseas confirmar este pedido para ingresarlo al sistema?`,
        });
      } catch (err: any) {
        console.error("❌ [trustModule] Error procesando Excel de pedido:", err);
        return `Error al procesar el archivo Excel: ${err.message}`;
      }
    },

    // ----------------------------------------------------
    // 6. REALIZAR PRESUPUESTO / COTIZACIÓN DIRECTA
    // ----------------------------------------------------
    GENERAR_PRESUPUESTO: async (args: any, context: any) => {
      console.log("[trustModule] 📝 GENERAR_PRESUPUESTO:", args);
      const customerQuery = args.codigo_cliente || args.cuit || args.cliente;
      const rawItems = args.articulos || args.items || [];

      if (!customerQuery) {
        return "Debe indicar el cliente (CUIT o código) para generar el presupuesto.";
      }
      if (!Array.isArray(rawItems) || rawItems.length === 0) {
        return "Debe proporcionar una lista de artículos con código y cantidad (ej: [{ codigo: '1031737', cantidad: 2 }]).";
      }

      const items = rawItems.map((it: any) => ({
        code: String(it.codigo || it.code || it.sku),
        quantity: Number(it.cantidad || it.quantity || 1),
        unit: it.unidad || it.measureUnit || undefined,
      }));

      const tango = new TangoClient(context?.projectId || null, context?.serviceId || null);
      const quote = await tango.calculateQuote(String(customerQuery), items);

      // Guardar en caché de cotizaciones pendientes asociadas al chat
      const chatId = context?.ctx?.from || context?.chatId || quote.customer.code;
      pendingQuotesMap.set(chatId, quote);
      pendingQuotesMap.set(quote.quoteId, quote);

      return JSON.stringify({
        presupuestoGenerado: true,
        numeroCotizacion: quote.quoteId,
        cliente: quote.customer.name,
        cuit: quote.customer.document,
        listaPrecios: quote.customer.priceListNumber,
        descuentoAplicado: `${quote.customer.discountPercentage}%`,
        items: quote.items.map((i) => ({
          codigo: i.code,
          descripcion: i.description,
          cantidad: i.quantity,
          unidad: i.measureUnit,
          unidadesPorBulto: i.salesEquivalence,
          precioUnitario: i.unitPrice,
          descuento: `${i.discountPercentage}%`,
          subtotal: i.subtotal,
        })),
        subtotalBruto: quote.subtotal,
        totalDescuentos: quote.totalDiscount,
        totalFinal: quote.total,
        moneda: quote.currency,
        mensajeParaCliente: `✅ Presupuesto *${quote.quoteId}* generado con éxito por un total de $${quote.total.toLocaleString("es-AR")}. Por favor confirme si desea proceder a confirmar el pedido.`,
      });
    },

    // ----------------------------------------------------
    // 7. ESPERAR CONFIRMACIÓN Y PASAR A PEDIDO
    // ----------------------------------------------------
    CONFIRMAR_PEDIDO: async (args: any, context: any) => {
      console.log("[trustModule] 🛒 CONFIRMAR_PEDIDO:", args);
      const chatId = context?.ctx?.from || context?.chatId || "";
      const quoteId = args.cotizacion_id || args.numeroCotizacion || "";

      let quote: QuoteResult | undefined = undefined;
      if (quoteId && pendingQuotesMap.has(quoteId)) {
        quote = pendingQuotesMap.get(quoteId);
      } else if (chatId && pendingQuotesMap.has(chatId)) {
        quote = pendingQuotesMap.get(chatId);
      }

      const tango = new TangoClient(context?.projectId || null, context?.serviceId || null);

      if (!quote && args.codigo_cliente && Array.isArray(args.articulos)) {
        quote = await tango.calculateQuote(args.codigo_cliente, args.articulos);
      }

      if (!quote) {
        return "No se encontró un presupuesto activo para confirmar. Primero debe generar un presupuesto o procesar el archivo Excel del pedido.";
      }

      const orderResult = await tango.createOrder(quote, {
        comments: args.comentarios || args.notas_entrega || "Confirmado por cliente vía WhatsApp",
      });

      if (chatId) pendingQuotesMap.delete(chatId);
      if (quote.quoteId) pendingQuotesMap.delete(quote.quoteId);

      return JSON.stringify({
        pedidoCreado: true,
        numeroOrdenTango: orderResult.orderId,
        cliente: quote.customer.name,
        total: quote.total,
        mensajeExito: `🎉 ¡El pedido *${orderResult.orderId}* ha sido ingresado correctamente en el sistema Tango!`,
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
        description: "Consulta en Tango Gestión la información comercial de un cliente por su CUIT o Razón Social (lista de precios, descuento asignado, saldo de cuenta corriente y condición de venta).",
        parameters: {
          type: "object",
          properties: {
            cuit_o_nombre: {
              type: "string",
              description: "CUIT (sin guiones o con guiones) o Razón Social / Nombre del cliente a buscar.",
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
        description: "Consulta precios netos, unidad de medida, equivalencia de bulto y stock disponible de uno o varios artículos en Tango Gestión.",
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
              description: "Número de lista de precios a consultar (opcional, por defecto lista 1).",
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
        description: "Genera y envía automáticamente al cliente por WhatsApp una plantilla de Excel personalizada con todos los productos disponibles en la base para que complete la columna 'CANTIDAD A PEDIR'. Usar cuando el cliente solicite pasar un pedido o pida el listado/planilla de pedidos.",
        parameters: {
          type: "object",
          properties: {
            codigo_cliente: {
              type: "string",
              description: "Código o CUIT del cliente si ya está identificado (opcional).",
            },
          },
        },
      },
    },
    {
      type: "function",
      function: {
        name: "trust_procesar_excel_pedido",
        description: "Procesa el archivo Excel completado por el cliente con sus cantidades a pedir, calcula la cotización en Tango Gestión con sus descuentos comerciales y devuelve el resumen para confirmación. Usar cuando el cliente haya enviado un archivo Excel de pedido.",
        parameters: {
          type: "object",
          properties: {
            codigo_cliente: {
              type: "string",
              description: "Código o CUIT del cliente para aplicar sus precios y descuentos de Tango.",
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
        description: "Genera una cotización o presupuesto formal en Tango Gestión para una lista de productos y cantidades específicas.",
        parameters: {
          type: "object",
          properties: {
            codigo_cliente: {
              type: "string",
              description: "Código o CUIT del cliente.",
            },
            articulos: {
              type: "array",
              items: {
                type: "object",
                properties: {
                  codigo: { type: "string", description: "Código SKU del artículo" },
                  cantidad: { type: "number", description: "Cantidad a pedir" },
                },
                required: ["codigo", "cantidad"],
              },
              description: "Lista de artículos con sus cantidades.",
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
        description: "Confirma e ingresa formalmente en Tango Gestión un presupuesto previamente cotizado como una orden/pedido de venta activo. Solo invocar una vez que el cliente haya confirmado explícitamente la cotización.",
        parameters: {
          type: "object",
          properties: {
            cotizacion_id: {
              type: "string",
              description: "Identificador de la cotización calculada previamente.",
            },
            comentarios: {
              type: "string",
              description: "Comentarios o notas de entrega para el pedido en Tango.",
            },
          },
        },
      },
    },
  ],
};
