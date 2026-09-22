// src/backend/apis/external/Trust/tangoClient.ts
import axios, { AxiosInstance } from "axios";
import { HistoryHandler } from "../../../db/historyHandler";

export interface TangoCustomer {
  Code: string;
  BusinessName: string;
  TradeName?: string;
  DocumentType?: string;
  DocumentNumber: string;
  PhoneNumbers?: string;
  MobilePhoneNumber?: string;
  Email?: string;
  PriceListNumber?: number;
  Discount?: number;
  SaleConditionCode?: number;
  SellerCode?: string;
  Address?: string;
  City?: string;
  ProvinceCode?: string;
  PostalCode?: string;
  IvaCategoryCode?: string;
  LocalAccountBalance?: number;
  ShippingAddresses?: any[];
}

export interface TangoProduct {
  Id?: number;
  SKUCode: string;
  Description: string;
  BarCode?: string;
  MeasureUnitCode?: string;
  SalesMeasureUnitCode?: string;
  SalesEquivalence?: number; // Cantidad por bulto/unidad de venta
  Discount?: number;
  Disabled?: boolean;
}

export interface TangoPrice {
  SKUCode: string;
  PriceListNumber: number;
  Price: number;
}

export interface TangoStock {
  SKUCode: string;
  WarehouseCode: string;
  Quantity: number;
  EngagedQuantity?: number;
}

export interface QuoteItem {
  code: string;
  description: string;
  quantity: number;
  measureUnit: string;
  salesEquivalence: number;
  unitPrice: number;
  discountPercentage: number;
  subtotal: number;
  stockAvailable?: number;
}

export interface QuoteResult {
  quoteId: string;
  date: string;
  customer: {
    code: string;
    name: string;
    document: string;
    priceListNumber: number;
    discountPercentage: number;
  };
  items: QuoteItem[];
  subtotal: number;
  totalDiscount: number;
  total: number;
  currency: string;
  notes?: string;
}

export class TangoClient {
  private projectId: string | null;
  private serviceId: string | null;
  private client: AxiosInstance | null = null;

  // Caché en memoria para optimizar velocidad conversacional
  private static customerCache: { timestamp: number; data: TangoCustomer[] } | null = null;
  private static productCache: { timestamp: number; data: TangoProduct[] } | null = null;
  private static priceCache: { timestamp: number; data: TangoPrice[] } | null = null;
  private static stockCache: { timestamp: number; data: TangoStock[] } | null = null;
  private static readonly CACHE_TTL_MS = 5 * 60 * 1000; // 5 minutos

  constructor(projectId: string | null = null, serviceId: string | null = null) {
    this.projectId = projectId;
    this.serviceId = serviceId;
  }

  /**
   * Obtiene la instancia de Axios configurada dinámicamente con las credenciales del servicio.
   */
  private async getAxios(): Promise<AxiosInstance> {
    if (this.client) return this.client;

    const baseUrl = (await HistoryHandler.getSetting("TRUST_TANGO_BASE_URL", this.projectId, this.serviceId)) ||
      process.env.TRUST_TANGO_BASE_URL ||
      "https://tiendas.axoft.com/api";

    const apiToken = (await HistoryHandler.getSetting("TRUST_TANGO_API_TOKEN", this.projectId, this.serviceId)) ||
      (await HistoryHandler.getSetting("TRUST_TANGO_API_KEY", this.projectId, this.serviceId)) ||
      process.env.TRUST_TANGO_API_TOKEN ||
      process.env.TRUST_TANGO_API_KEY;

    if (!apiToken) {
      throw new Error(
        "Faltan las credenciales de Tango Tiendas para Trust. Cargue 'TRUST_TANGO_API_TOKEN' y 'TRUST_TANGO_BASE_URL' en las variables del servicio."
      );
    }

    this.client = axios.create({
      baseURL: baseUrl.replace(/\/+$/, ""),
      headers: {
        accesstoken: apiToken.trim(),
        "Content-Type": "application/json",
      },
      timeout: 15000,
    });

    return this.client;
  }

  /**
   * Verifica la conectividad con la API de Tango Tiendas.
   */
  async checkConnection(): Promise<boolean> {
    try {
      const http = await this.getAxios();
      const res = await http.post("/Aperture/dummy", {});
      return res.status === 200 && (res.data?.isOk === true || res.data?.Status === 0);
    } catch (e: any) {
      console.error("[TangoClient] Error en checkConnection:", e.message);
      return false;
    }
  }

  /**
   * Obtiene el catálogo de clientes de Tango Tiendas (con caché en memoria).
   */
  async getAllCustomers(forceRefresh = false): Promise<TangoCustomer[]> {
    const now = Date.now();
    if (!forceRefresh && TangoClient.customerCache && (now - TangoClient.customerCache.timestamp < TangoClient.CACHE_TTL_MS)) {
      return TangoClient.customerCache.data;
    }

    try {
      const http = await this.getAxios();
      let all: TangoCustomer[] = [];
      let pageNumber = 1;
      const pageSize = 100;
      let hasMore = true;

      // Traer hasta 300 clientes para consultas rápidas
      while (hasMore && pageNumber <= 3) {
        const res = await http.get(`/Aperture/Customer?pageSize=${pageSize}&pageNumber=${pageNumber}`);
        const data = res.data?.Data || [];
        all = all.concat(data);
        hasMore = res.data?.Paging?.MoreData === true && data.length === pageSize;
        pageNumber++;
      }

      TangoClient.customerCache = { timestamp: now, data: all };
      return all;
    } catch (e: any) {
      console.error("[TangoClient] Error obteniendo clientes:", e.message);
      if (TangoClient.customerCache) return TangoClient.customerCache.data;
      throw e;
    }
  }

  /**
   * Busca un cliente por CUIT/DNI, Razón Social, Código o Teléfono.
   */
  async findCustomer(query: string): Promise<TangoCustomer | null> {
    if (!query || typeof query !== "string") return null;
    const cleanQuery = query.trim().toLowerCase();
    const cleanDigits = query.replace(/\D/g, "");

    const customers = await this.getAllCustomers();

    // 1. Coincidencia exacta por CUIT / Documento (sin guiones)
    if (cleanDigits.length >= 7) {
      const foundByDoc = customers.find((c) => {
        const docDigits = String(c.DocumentNumber || "").replace(/\D/g, "");
        return docDigits === cleanDigits || docDigits.includes(cleanDigits);
      });
      if (foundByDoc) return foundByDoc;
    }

    // 2. Coincidencia exacta por Código de cliente
    const foundByCode = customers.find((c) => String(c.Code || "").toLowerCase() === cleanQuery);
    if (foundByCode) return foundByCode;

    // 3. Coincidencia por Teléfono
    if (cleanDigits.length >= 8) {
      const foundByPhone = customers.find((c) => {
        const phone1 = String(c.PhoneNumbers || "").replace(/\D/g, "");
        const mobile = String(c.MobilePhoneNumber || "").replace(/\D/g, "");
        return phone1.includes(cleanDigits) || mobile.includes(cleanDigits) || cleanDigits.includes(phone1) || cleanDigits.includes(mobile);
      });
      if (foundByPhone) return foundByPhone;
    }

    // 4. Coincidencia parcial por Razón Social o Nombre de Fantasía
    const foundByName = customers.find((c) => {
      const bName = String(c.BusinessName || "").toLowerCase();
      const tName = String(c.TradeName || "").toLowerCase();
      return bName.includes(cleanQuery) || tName.includes(cleanQuery);
    });

    return foundByName || null;
  }

  /**
   * Obtiene el catálogo de artículos (con caché en memoria).
   */
  async getAllProducts(forceRefresh = false): Promise<TangoProduct[]> {
    const now = Date.now();
    if (!forceRefresh && TangoClient.productCache && (now - TangoClient.productCache.timestamp < TangoClient.CACHE_TTL_MS)) {
      return TangoClient.productCache.data;
    }

    try {
      const http = await this.getAxios();
      let all: TangoProduct[] = [];
      let pageNumber = 1;
      const pageSize = 100;
      let hasMore = true;

      // Traer hasta 3 páginas (300 artículos)
      while (hasMore && pageNumber <= 3) {
        const res = await http.get(`/Aperture/Product?pageSize=${pageSize}&pageNumber=${pageNumber}`);
        const data = res.data?.Data || [];
        all = all.concat(data);
        hasMore = res.data?.Paging?.MoreData === true && data.length === pageSize;
        pageNumber++;
      }

      TangoClient.productCache = { timestamp: now, data: all };
      return all;
    } catch (e: any) {
      console.error("[TangoClient] Error obteniendo artículos:", e.message);
      if (TangoClient.productCache) return TangoClient.productCache.data;
      throw e;
    }
  }

  /**
   * Obtiene precios vigentes de Tango.
   */
  async getPrices(): Promise<TangoPrice[]> {
    const now = Date.now();
    if (TangoClient.priceCache && (now - TangoClient.priceCache.timestamp < TangoClient.CACHE_TTL_MS)) {
      return TangoClient.priceCache.data;
    }

    try {
      const http = await this.getAxios();
      const res = await http.get("/Aperture/Price?pageSize=300&pageNumber=1");
      const data: TangoPrice[] = res.data?.Data || [];
      TangoClient.priceCache = { timestamp: now, data };
      return data;
    } catch (e: any) {
      console.error("[TangoClient] Error obteniendo precios:", e.message);
      return TangoClient.priceCache ? TangoClient.priceCache.data : [];
    }
  }

  /**
   * Obtiene stock vigente de Tango.
   */
  async getStock(): Promise<TangoStock[]> {
    const now = Date.now();
    if (TangoClient.stockCache && (now - TangoClient.stockCache.timestamp < TangoClient.CACHE_TTL_MS)) {
      return TangoClient.stockCache.data;
    }

    try {
      const http = await this.getAxios();
      const res = await http.get("/Aperture/Stock?pageSize=300&pageNumber=1");
      const data: TangoStock[] = res.data?.Data || [];
      TangoClient.stockCache = { timestamp: now, data };
      return data;
    } catch (e: any) {
      console.error("[TangoClient] Error obteniendo stock:", e.message);
      return TangoClient.stockCache ? TangoClient.stockCache.data : [];
    }
  }

  /**
   * Busca artículos por código, SKU o palabras clave, enriqueciendo con precio y stock.
   */
  async searchProducts(queries: string[], priceListNumber = 1, warehouseCode?: string): Promise<any[]> {
    const [products, prices, stocks] = await Promise.all([
      this.getAllProducts(),
      this.getPrices(),
      this.getStock(),
    ]);

    const results: any[] = [];
    const normalizedQueries = queries.map((q) => String(q).trim().toLowerCase());

    for (const q of normalizedQueries) {
      const matched = products.filter((p) => {
        const sku = String(p.SKUCode || "").toLowerCase();
        const barcode = String(p.BarCode || "").toLowerCase();
        const desc = String(p.Description || "").toLowerCase();
        return sku === q || barcode === q || desc.includes(q);
      });

      for (const prod of matched) {
        // Buscar precio para la lista solicitada (o fallback a lista disponible)
        const priceItem = prices.find((pr) => pr.SKUCode === prod.SKUCode && pr.PriceListNumber === priceListNumber) ||
          prices.find((pr) => pr.SKUCode === prod.SKUCode);

        // Buscar stock
        const stockItems = stocks.filter((s) => s.SKUCode === prod.SKUCode);
        const warehouseStock = warehouseCode
          ? stockItems.find((s) => s.WarehouseCode === warehouseCode)
          : null;

        const totalStock = stockItems.reduce((acc, s) => acc + (Number(s.Quantity) || 0), 0);

        results.push({
          sku: prod.SKUCode,
          description: prod.Description,
          barcode: prod.BarCode || "",
          measureUnit: prod.SalesMeasureUnitCode || prod.MeasureUnitCode || "UNI",
          salesEquivalence: prod.SalesEquivalence || 1, // Ej: si se vende por bulto de 6, 12, etc.
          price: priceItem ? priceItem.Price : 0,
          priceListNumber: priceItem ? priceItem.PriceListNumber : priceListNumber,
          stock: warehouseStock ? warehouseStock.Quantity : totalStock,
          totalStockAcrossWarehouses: totalStock,
        });
      }
    }

    // Deduplicar resultados por SKU
    const uniqueMap = new Map();
    results.forEach((r) => {
      if (!uniqueMap.has(r.sku)) uniqueMap.set(r.sku, r);
    });

    return Array.from(uniqueMap.values());
  }

  /**
   * Genera un presupuesto detallado para un cliente y lista de ítems.
   */
  async calculateQuote(
    customerQuery: string,
    itemsToQuote: Array<{ code: string; quantity: number; unit?: string }>
  ): Promise<QuoteResult> {
    const customer = await this.findCustomer(customerQuery);
    if (!customer) {
      throw new Error(`No se encontró ningún cliente en Tango con el criterio: '${customerQuery}'.`);
    }

    const priceListNumber = customer.PriceListNumber || 1;
    const customerDiscount = Number(customer.Discount) || 0;

    const skus = itemsToQuote.map((i) => i.code);
    const catalogProducts = await this.searchProducts(skus, priceListNumber);

    const quoteItems: QuoteItem[] = [];
    let subtotal = 0;
    let totalDiscount = 0;

    for (const reqItem of itemsToQuote) {
      const prod = catalogProducts.find(
        (p) => String(p.sku).toLowerCase() === String(reqItem.code).toLowerCase() ||
          String(p.description).toLowerCase().includes(String(reqItem.code).toLowerCase())
      );

      if (!prod) {
        throw new Error(`Artículo no encontrado o no disponible en lista ${priceListNumber}: '${reqItem.code}'`);
      }

      const qty = Number(reqItem.quantity) || 1;
      const unitPrice = Number(prod.price) || 0;
      const lineGross = qty * unitPrice;
      const lineDiscount = lineGross * (customerDiscount / 100);
      const lineSubtotal = lineGross - lineDiscount;

      subtotal += lineGross;
      totalDiscount += lineDiscount;

      quoteItems.push({
        code: prod.sku,
        description: prod.description,
        quantity: qty,
        measureUnit: reqItem.unit || prod.measureUnit || "UNI",
        salesEquivalence: prod.salesEquivalence || 1,
        unitPrice: unitPrice,
        discountPercentage: customerDiscount,
        subtotal: Math.round(lineSubtotal * 100) / 100,
        stockAvailable: prod.stock,
      });
    }

    const total = Math.round((subtotal - totalDiscount) * 100) / 100;
    const nowStr = new Date().toISOString();
    const randomSuffix = Math.floor(1000 + Math.random() * 9000);
    const quoteId = `COT-${nowStr.slice(0, 10).replace(/-/g, "")}-${randomSuffix}`;

    return {
      quoteId,
      date: nowStr,
      customer: {
        code: customer.Code,
        name: customer.BusinessName || customer.TradeName || "Cliente",
        document: customer.DocumentNumber,
        priceListNumber,
        discountPercentage: customerDiscount,
      },
      items: quoteItems,
      subtotal: Math.round(subtotal * 100) / 100,
      totalDiscount: Math.round(totalDiscount * 100) / 100,
      total,
      currency: "ARS",
    };
  }

  /**
   * Envía la orden confirmada a Tango Tiendas (POST /Aperture/Order).
   */
  async createOrder(quote: QuoteResult, options: { comments?: string; warehouseCode?: string; sellerCode?: string } = {}): Promise<any> {
    const http = await this.getAxios();

    const warehouseCode = options.warehouseCode ||
      (await HistoryHandler.getSetting("TRUST_DEFAULT_WAREHOUSE", this.projectId, this.serviceId)) ||
      "01";

    const sellerCode = options.sellerCode ||
      (await HistoryHandler.getSetting("TRUST_DEFAULT_SELLER", this.projectId, this.serviceId)) ||
      "BOT";

    const orderCounterfoil = Number(
      (await HistoryHandler.getSetting("TRUST_DEFAULT_COUNTERFOIL", this.projectId, this.serviceId)) || 1
    );

    const fullCustomer = await this.findCustomer(quote.customer.code);

    const payload = {
      SituacionOrden: "VIGENTE",
      Date: new Date().toISOString().slice(0, 19),
      Total: quote.total,
      TotalDiscount: quote.totalDiscount,
      PaidTotal: 0.0,
      FinancialSurcharge: 0.0,
      WarehouseCode: warehouseCode,
      SellerCode: sellerCode,
      TransportCode: fullCustomer?.TransportCode || null,
      SaleConditionCode: fullCustomer?.SaleConditionCode || 1,
      InvoiceCounterfoil: 0,
      OrderCounterfoil: orderCounterfoil,
      PriceListNumber: quote.customer.priceListNumber || 1,
      AgreedWithSeller: false,
      IvaIncluded: true,
      InternalTaxIncluded: false,
      OrderID: quote.quoteId,
      OrderNumber: quote.quoteId,
      ValidateTotalWithPaidTotal: false,
      ValidateTotalWithItems: false,
      Comment: options.comments || `Pedido generado automáticamente por WhatsApp Bot para ${quote.customer.name}`,
      Customer: {
        CustomerID: 0,
        Code: quote.customer.code,
        DocumentType: fullCustomer?.DocumentType || "DNI",
        DocumentNumber: quote.customer.document || "0",
        IVACategoryCode: fullCustomer?.IvaCategoryCode || "CF",
        PayInternalTax: false,
        User: fullCustomer?.Email || "whatsapp@trust.com.ar",
        Email: fullCustomer?.Email || "whatsapp@trust.com.ar",
        FirstName: quote.customer.name,
        LastName: "",
        BusinessName: quote.customer.name,
        Street: fullCustomer?.Address || "",
        HouseNumber: "",
        City: fullCustomer?.City || "",
        ProvinceCode: fullCustomer?.ProvinceCode || "1",
        PostalCode: fullCustomer?.PostalCode || "",
        PhoneNumber1: fullCustomer?.MobilePhoneNumber || fullCustomer?.PhoneNumbers || "",
        Bonus: quote.customer.discountPercentage || 0.0,
        MobilePhoneNumber: fullCustomer?.MobilePhoneNumber || "",
        NumberListPrice: quote.customer.priceListNumber || 1,
      },
      CancelOrder: false,
      OrderItems: quote.items.map((it) => ({
        ProductCode: it.code,
        SKUCode: it.code,
        Description: it.description,
        Quantity: it.quantity,
        MeasureCode: it.measureUnit,
        UnitPrice: it.unitPrice,
        DiscountPercentage: it.discountPercentage,
        WarehouseCode: warehouseCode,
      })),
      Payments: [],
    };

    console.log(`[TangoClient] 🚀 Enviando orden '${quote.quoteId}' a Tango Tiendas (/Aperture/Order)...`);
    const res = await http.post("/Aperture/Order", payload);

    if (res.data?.isOk === false || (res.data?.Status && res.data.Status !== 0)) {
      throw new Error(res.data?.Message || "Error al procesar la orden en Tango Tiendas.");
    }

    return {
      success: true,
      orderId: quote.quoteId,
      tangoStatus: res.data?.Status || 0,
      tangoMessage: res.data?.Message || "Orden creada con éxito",
      data: res.data?.Data || null,
    };
  }
}
