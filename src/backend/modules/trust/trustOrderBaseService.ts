// src/backend/modules/trust/trustOrderBaseService.ts
import fs from 'fs';
import path from 'path';
import * as XLSX from 'xlsx';
import { supabase, HistoryHandler } from '../../db/historyHandler';

export interface ProcessedOrderItem {
  code: string;
  quantity: number;
  description?: string;
  unitPrice?: number;
  rawData?: any;
}

export class TrustOrderBaseService {
  /**
   * Guarda el archivo Excel original en Supabase (tabla settings) en formato Base64.
   * Esto garantiza la persistencia indestructible ante reinicios del contenedor en Railway.
   */
  static async saveOriginalTemplate(
    fileBuffer: Buffer,
    fileName: string,
    projectId: string,
    serviceId: string
  ): Promise<void> {
    const base64Data = fileBuffer.toString('base64');
    const { error } = await supabase.from('settings').upsert({
      project_id: projectId,
      service_id: serviceId,
      key: 'TRUST_ORIGINAL_EXCEL_TEMPLATE',
      value: JSON.stringify({
        fileName: fileName || 'Planilla_Pedido_Trust.xlsx',
        base64: base64Data,
        uploadedAt: new Date().toISOString(),
        size: fileBuffer.length
      }),
      updated_at: new Date().toISOString()
    }, { onConflict: 'project_id,service_id,key' });

    if (error) {
      console.error('[TrustOrderBaseService] Error al guardar plantilla en Supabase:', error);
      throw new Error(`Error al persistir archivo Excel original: ${error.message}`);
    }
    console.log(`[TrustOrderBaseService] 💾 Plantilla original guardada en Supabase (${(fileBuffer.length / 1024).toFixed(1)} KB).`);
  }

  /**
   * Recupera el archivo Excel original desde Supabase (Base64).
   */
  static async getOriginalTemplate(
    projectId: string,
    serviceId: string
  ): Promise<{ fileName: string; base64: string; uploadedAt: string; size?: number } | null> {
    const { data, error } = await supabase
      .from('settings')
      .select('value')
      .eq('project_id', projectId)
      .eq('service_id', serviceId)
      .eq('key', 'TRUST_ORIGINAL_EXCEL_TEMPLATE')
      .maybeSingle();

    if (error) {
      console.warn('[TrustOrderBaseService] Error al consultar plantilla original en Supabase:', error.message);
      return null;
    }

    if (data?.value) {
      try {
        return JSON.parse(data.value);
      } catch (e) {
        console.error('[TrustOrderBaseService] Error parseando JSON de plantilla original:', e);
        return null;
      }
    }
    return null;
  }

  /**
   * Importa un archivo Excel:
   * 1. Persiste el archivo original idéntico en Supabase (Base64).
   * 2. Puebla la tabla 'base_para_pedido' para las consultas, KPIs y vistas previas.
   */
  static async importExcelToBaseParaPedido(
    fileSource: string | Buffer,
    projectId: string,
    serviceId: string,
    originalFileName?: string
  ): Promise<{ count: number; headers: string[]; preview: any[]; sample: any[] }> {
    let fileBuffer: Buffer;
    let fileName: string = originalFileName || 'Planilla_Pedido.xlsx';

    if (Buffer.isBuffer(fileSource)) {
      fileBuffer = fileSource;
    } else if (typeof fileSource === 'string') {
      if (!fs.existsSync(fileSource)) {
        throw new Error(`El archivo ${fileSource} no existe.`);
      }
      fileBuffer = fs.readFileSync(fileSource);
      if (!originalFileName) {
        fileName = path.basename(fileSource);
      }
    } else {
      throw new Error('Fuente de archivo inválida.');
    }

    // 1. Guardar el archivo binario original en Supabase para persistencia ante reinicios
    await this.saveOriginalTemplate(fileBuffer, fileName, projectId, serviceId);

    // 2. Leer con SheetJS para poblar base_para_pedido
    const workbook = XLSX.read(fileBuffer, { type: 'buffer' });
    const sheetName = workbook.SheetNames[0];
    if (!sheetName) {
      throw new Error('El archivo Excel no contiene ninguna hoja.');
    }

    const sheet = workbook.Sheets[sheetName];
    // Obtener las filas como arrays para identificar con precisión los encabezados
    const rawMatrix: any[][] = XLSX.utils.sheet_to_json(sheet, { header: 1 });
    if (!rawMatrix || rawMatrix.length < 2) {
      throw new Error('El archivo Excel está vacío o no contiene datos.');
    }

    // Identificar fila de encabezados (primera fila con al menos 2 columnas no vacías)
    let headerRowIdx = 0;
    for (let i = 0; i < Math.min(rawMatrix.length, 5); i++) {
      const nonEmpty = (rawMatrix[i] || []).filter(c => c !== undefined && c !== null && String(c).trim() !== '').length;
      if (nonEmpty >= 2) {
        headerRowIdx = i;
        break;
      }
    }

    const rawHeaders = rawMatrix[headerRowIdx] || [];
    const headers: string[] = rawHeaders
      .map((h, i) => (h !== undefined && h !== null && String(h).trim() !== '' ? String(h).trim() : `Columna_${i + 1}`));

    // Obtener las filas como objetos usando los encabezados detectados
    const rows: any[] = XLSX.utils.sheet_to_json(sheet, { range: headerRowIdx, defval: '' });

    if (rows.length === 0) {
      throw new Error('No se encontraron filas con datos en el archivo.');
    }

    // Detectar heurísticamente qué columna corresponde al Código y Descripción para facilitar consultas
    const codeKey = headers.find(h => /^(c[oó]d|sku|art[ií]culo|item|c[oó]digo)/i.test(h.trim())) || headers[0];
    const descKey = headers.find(h => /(descrip|nombre|detalle|producto|denominaci[oó]n)/i.test(h.trim())) || headers[1] || headers[0];

    // Limpiar registros previos exclusivamente de este proyecto y servicio (aislamiento estricto)
    const { error: deleteErr } = await supabase
      .from('base_para_pedido')
      .delete()
      .eq('project_id', projectId)
      .eq('service_id', serviceId);

    if (deleteErr) {
      console.error('[TrustOrderBaseService] Error al limpiar base anterior:', deleteErr);
      throw new Error(`Error al limpiar base previa: ${deleteErr.message}`);
    }

    // Formatear filas para inserción
    const rowsToInsert = rows.map((r, index) => {
      const codeVal = r[codeKey] !== undefined ? String(r[codeKey]).trim() : '';
      const descVal = r[descKey] !== undefined ? String(r[descKey]).trim() : '';
      return {
        project_id: projectId,
        service_id: serviceId,
        row_index: index + 1,
        codigo: codeVal || `ROW_${index + 1}`,
        descripcion: descVal || '',
        data: r,
        headers: headers,
        created_at: new Date().toISOString(),
        updated_at: new Date().toISOString()
      };
    });

    // Inserción en bloques (batches) de 250 para evitar exceder límites de payload
    const batchSize = 250;
    for (let i = 0; i < rowsToInsert.length; i += batchSize) {
      const batch = rowsToInsert.slice(i, i + batchSize);
      const { error: insertErr } = await supabase.from('base_para_pedido').insert(batch);
      if (insertErr) {
        console.error(`[TrustOrderBaseService] Error al insertar lote [${i} - ${i + batch.length}]:`, insertErr);
        throw new Error(`Error insertando filas en base_para_pedido: ${insertErr.message}`);
      }
    }

    // Guardar timestamp de última actualización en settings
    await HistoryHandler.saveSetting(
      'TRUST_BASE_PEDIDO_LAST_UPDATE',
      JSON.stringify({
        updatedAt: new Date().toISOString(),
        totalRows: rowsToInsert.length,
        headers: headers,
        fileName: fileName
      }),
      projectId,
      serviceId
    );

    console.log(`[TrustOrderBaseService] ✅ Base de pedidos actualizada con éxito. Total filas: ${rowsToInsert.length} (Project: ${projectId}, Service: ${serviceId})`);

    const sampleData = rowsToInsert.slice(0, 5).map(r => r.data);
    return {
      count: rowsToInsert.length,
      headers,
      preview: sampleData,
      sample: sampleData
    };
  }

  /**
   * Obtiene el estado actual de la tabla 'base_para_pedido' para el proyecto y servicio.
   */
  static async getBaseParaPedidoStatus(
    projectId: string,
    serviceId: string
  ): Promise<{ count: number; headers: string[]; lastUpdate: any; sample: any[] }> {
    const { count, error } = await supabase
      .from('base_para_pedido')
      .select('*', { count: 'exact', head: true })
      .eq('project_id', projectId)
      .eq('service_id', serviceId);

    if (error) {
      console.warn('[TrustOrderBaseService] Error al consultar conteo de base_para_pedido:', error.message);
    }

    let headers: string[] = [];
    let sample: any[] = [];

    if (count && count > 0) {
      const { data: rows } = await supabase
        .from('base_para_pedido')
        .select('row_index, codigo, descripcion, data, headers')
        .eq('project_id', projectId)
        .eq('service_id', serviceId)
        .order('row_index', { ascending: true })
        .limit(25);

      if (rows && rows.length > 0) {
        if (rows[0].headers && Array.isArray(rows[0].headers)) {
          headers = rows[0].headers;
        } else if (rows[0].data) {
          headers = Object.keys(rows[0].data);
        }
        sample = rows.map(r => r.data || { codigo: r.codigo, descripcion: r.descripcion });
      }
    }

    const lastUpdateSetting = await HistoryHandler.getSetting('TRUST_BASE_PEDIDO_LAST_UPDATE', projectId, serviceId, true);
    let lastUpdate = null;
    if (lastUpdateSetting) {
      try { lastUpdate = JSON.parse(lastUpdateSetting); } catch (_) { lastUpdate = lastUpdateSetting; }
    }

    return {
      count: count || 0,
      headers,
      lastUpdate,
      sample
    };
  }

  /**
   * Elimina todos los registros de la base de pedidos y la plantilla original persistida.
   */
  static async clearBaseParaPedido(
    projectId: string,
    serviceId: string
  ): Promise<void> {
    const { error } = await supabase
      .from('base_para_pedido')
      .delete()
      .eq('project_id', projectId)
      .eq('service_id', serviceId);

    if (error) throw error;

    // Eliminar también la plantilla original persistida y el timestamp de actualización
    await supabase
      .from('settings')
      .delete()
      .eq('project_id', projectId)
      .eq('service_id', serviceId)
      .in('key', ['TRUST_ORIGINAL_EXCEL_TEMPLATE', 'TRUST_BASE_PEDIDO_LAST_UPDATE']);

    console.log(`[TrustOrderBaseService] 🗑️ Base de pedidos y plantilla original eliminadas para ${projectId} / ${serviceId}`);
  }

  /**
   * Entrega la plantilla de pedidos para enviarle al cliente.
   * Recupera el archivo original exacto desde Supabase (Base64) con todos sus colores,
   * fuentes, celdas combinadas de categorías y columna de pedido original 100% intactas.
   */
  static async generatePlantillaExcel(
    projectId: string | null,
    serviceId: string | null,
    options?: {
      customerCode?: string;
      customerName?: string;
      priceList?: number;
    }
  ): Promise<{ filePath: string; fileName: string; totalItems: number; totalRows: number }> {
    if (!projectId || !serviceId) {
      throw new Error("projectId y serviceId son requeridos para generar la plantilla de pedidos.");
    }

    const tmpDir = path.resolve("./tmp/plantillas_pedido");
    if (!fs.existsSync(tmpDir)) {
      fs.mkdirSync(tmpDir, { recursive: true });
    }

    // 1. Intentar recuperar la plantilla original exacta almacenada en Supabase (Base64)
    const originalTemplate = await this.getOriginalTemplate(projectId, serviceId);
    if (originalTemplate && originalTemplate.base64) {
      const buffer = Buffer.from(originalTemplate.base64, 'base64');
      const customerSuffix = options?.customerCode ? `_${options.customerCode}` : '';
      const parsedName = originalTemplate.fileName ? path.parse(originalTemplate.fileName) : { name: 'Planilla_Pedido', ext: '.xlsx' };
      const fileName = `${parsedName.name}${customerSuffix}${parsedName.ext || '.xlsx'}`;
      const filePath = path.join(tmpDir, `${Date.now()}_${fileName}`);

      fs.writeFileSync(filePath, buffer);
      console.log(`[TrustOrderBaseService] 📄 Entregando plantilla original exacta desde Supabase: ${filePath}`);

      const { count } = await supabase
        .from('base_para_pedido')
        .select('*', { count: 'exact', head: true })
        .eq('project_id', projectId)
        .eq('service_id', serviceId);

      return {
        filePath,
        fileName,
        totalItems: count || 0,
        totalRows: count || 0
      };
    }

    // 2. Fallback: Si no hay plantilla original guardada en Supabase, generar desde base_para_pedido
    const { data: rows, error } = await supabase
      .from('base_para_pedido')
      .select('row_index, codigo, descripcion, data, headers')
      .eq('project_id', projectId)
      .eq('service_id', serviceId)
      .order('row_index', { ascending: true });

    if (error) throw error;
    if (!rows || rows.length === 0) {
      return {
        filePath: '',
        fileName: '',
        totalItems: 0,
        totalRows: 0,
      };
    }

    const originalHeaders: string[] = rows[0]?.headers || (rows[0]?.data ? Object.keys(rows[0].data) : []);
    const excelRows = rows.map(r => {
      const rowData = r.data || {};
      const newRow: Record<string, any> = {};
      for (const h of originalHeaders) {
        newRow[h] = rowData[h] !== undefined ? rowData[h] : '';
      }
      return newRow;
    });

    const worksheet = XLSX.utils.json_to_sheet(excelRows);
    const workbook = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(workbook, worksheet, "Planilla de Pedido");

    const customerSuffix = options?.customerCode ? `_${options.customerCode}` : '';
    const fileName = `Planilla_Pedido_Trust${customerSuffix}_${Date.now()}.xlsx`;
    const filePath = path.join(tmpDir, fileName);

    XLSX.writeFile(workbook, filePath);
    console.log(`[TrustOrderBaseService] 📄 Planilla Excel generada desde base_para_pedido: ${filePath}`);

    return {
      filePath,
      fileName,
      totalItems: rows.length,
      totalRows: rows.length
    };
  }

  /**
   * Procesa la planilla Excel que completó y devolvió el cliente por WhatsApp.
   * Detecta la columna de cantidad existente y extrae todos los artículos donde la cantidad > 0.
   * Filtra automáticamente títulos, encabezados y categorías combinadas.
   */
  static async processIncomingOrderExcel(
    filePath: string
  ): Promise<{ items: ProcessedOrderItem[]; totalItems: number; rawRowsRead: number; totalRowsRead: number }> {
    if (!fs.existsSync(filePath)) {
      throw new Error(`El archivo recibido no se encuentra en el servidor: ${filePath}`);
    }

    const workbook = XLSX.readFile(filePath);
    const sheetName = workbook.SheetNames[0];
    if (!sheetName) {
      throw new Error('El archivo recibido no contiene hojas de cálculo válidas.');
    }

    const sheet = workbook.Sheets[sheetName];
    const rows: any[] = XLSX.utils.sheet_to_json(sheet, { defval: '' });

    if (rows.length === 0) {
      throw new Error('La planilla recibida está vacía.');
    }

    const sampleRow = rows[0];
    const columnKeys = Object.keys(sampleRow);

    // 1. Detectar la columna de cantidad a pedir
    const quantityKey = columnKeys.find(k => /(cantidad|pedir|pedido|solicitad|cant|unidades_a_pedir|qty)/i.test(k.trim()))
      || columnKeys[columnKeys.length - 1];

    // 2. Detectar la columna de código/SKU
    const codeKey = columnKeys.find(k => /^(c[oó]d|sku|art[ií]culo|item|c[oó]digo)/i.test(k.trim()))
      || columnKeys[0];

    // 3. Detectar columna de descripción
    const descKey = columnKeys.find(k => /(descrip|nombre|detalle|producto|denominaci[oó]n)/i.test(k.trim()))
      || columnKeys[1] || columnKeys[0];

    console.log(`[TrustOrderBaseService] 🔍 Columnas detectadas para lectura de pedido:`, {
      codeKey,
      descKey,
      quantityKey
    });

    const items: ProcessedOrderItem[] = [];

    for (const r of rows) {
      const rawQty = r[quantityKey];
      if (rawQty !== undefined && rawQty !== null && String(rawQty).trim() !== '') {
        const cleanQtyStr = String(rawQty).trim().replace(',', '.');
        const qtyNum = parseFloat(cleanQtyStr);

        if (!isNaN(qtyNum) && qtyNum > 0) {
          const codeVal = r[codeKey] !== undefined ? String(r[codeKey]).trim() : '';
          const descVal = r[descKey] !== undefined ? String(r[descKey]).trim() : '';

          // Filtrar encabezados y filas que no tengan código real (ej. categorías combinadas)
          const isHeaderOrCategory = !codeVal ||
            codeVal.toLowerCase() === 'código' ||
            codeVal.toLowerCase() === 'codigo' ||
            codeVal.toLowerCase() === 'sku' ||
            codeVal.toLowerCase() === 'artículo' ||
            codeVal.toLowerCase() === 'articulo';

          if (!isHeaderOrCategory) {
            items.push({
              code: codeVal,
              quantity: Math.round(qtyNum),
              description: descVal,
              rawData: r
            });
          }
        }
      }
    }

    return {
      items,
      totalItems: items.length,
      rawRowsRead: rows.length,
      totalRowsRead: rows.length
    };
  }
}
