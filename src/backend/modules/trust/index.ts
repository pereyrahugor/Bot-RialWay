// src/backend/modules/trust/index.ts
import { TangoClient, QuoteResult } from "../../apis/external/Trust/tangoClient";

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
          unidadesPorBulto: p.salesEquivalence, // Cómo se vende por unidad o bulto y cantidad
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
    // 4. REALIZAR PRESUPUESTO / COTIZACIÓN
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
    // 5. ESPERAR CONFIRMACIÓN Y PASAR A PEDIDO
    // ----------------------------------------------------
    CONFIRMAR_PEDIDO: async (args: any, context: any) => {
      console.log("[trustModule] 🛒 CONFIRMAR_PEDIDO:", args);
      const chatId = context?.ctx?.from || context?.chatId || "";
      const quoteId = args.cotizacion_id || args.numeroCotizacion || "";

      // Recuperar cotización guardada previamente
      let quote: QuoteResult | undefined = undefined;
      if (quoteId && pendingQuotesMap.has(quoteId)) {
        quote = pendingQuotesMap.get(quoteId);
      } else if (chatId && pendingQuotesMap.has(chatId)) {
        quote = pendingQuotesMap.get(chatId);
      }

      const tango = new TangoClient(context?.projectId || null, context?.serviceId || null);

      // Si no estaba en caché pero se pasaron los artículos directamente
      if (!quote && args.codigo_cliente && Array.isArray(args.articulos)) {
        quote = await tango.calculateQuote(args.codigo_cliente, args.articulos);
      }

      if (!quote) {
        return "No se encontró un presupuesto activo para confirmar. Primero debe generar un presupuesto con 'generar_presupuesto'.";
      }

      // Enviar la orden a Tango Tiendas
      const orderResult = await tango.createOrder(quote, {
        comments: args.comentarios || args.notas_entrega || "Confirmado por cliente vía WhatsApp",
      });

      // Limpiar cotización pendiente
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
};
