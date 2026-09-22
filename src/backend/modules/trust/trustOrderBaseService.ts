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
   * Importa un archivo Excel a la tabla 'base_para_pedido' de forma dinámica.
   * Las columnas quedan definidas por los encabezados del archivo del cliente.
   */
  static async importExcelToBaseParaPedido(
    filePath: string,
    projectId: string,
    serviceId: string
  ): Promise<{ count: number; headers: string[]; preview: any[]; sample: any[] }> {
    if (!fs.existsSync(filePath)) {
      throw new Error(`El archivo ${filePath} no existe.`);
    }

    const workbook = XLSX.readFile(filePath);
    const sheetName = workbook.SheetNames[0];
    if (!sheetName) {
      throw new Error('El archivo Excel no contiene ninguna hoja.');
    }

    const sheet = workbook.Sheets[sheetName];
    // Obtener las filas como arrays para identificar con precisión los encabezados de la fila 1
    const rawMatrix: any[][] = XLSX.utils.sheet_to_json(sheet, { header: 1 });
    if (!rawMatrix || rawMatrix.length < 2) {
      throw new Error('El archivo Excel está vacío o no contiene datos.');
    }

    const rawHeaders = rawMatrix[0];
    const headers: string[] = rawHeaders
      .map((h, i) => (h !== undefined && h !== null && String(h).trim() !== '' ? String(h).trim() : `Columna_${i + 1}`));

    // Obtener las filas como objetos usando los encabezados detectados
    const rows: any[] = XLSX.utils.sheet_to_json(sheet, { defval: '' });

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
        fileName: path.basename(filePath)
      }),
      projectId,
      serviceId
    );

    console.log(`[TrustOrderBaseService] ✅ Base de pedidos actualizada con éxito. Total filas: ${rowsToInsert.length} (Project: ${projectId}, Service: ${serviceId})`);

    const sampleData = rowsToInsert.slice(0, 3).map(r => r.data);
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
  ): Promise<{ count: number; headers: string[]; lastUpdate: any }> {
    const { count, error } = await supabase
      .from('base_para_pedido')
      .select('*', { count: 'exact', head: true })
      .eq('project_id', projectId)
      .eq('service_id', serviceId);

    if (error) {
      console.warn('[TrustOrderBaseService] Error al consultar conteo de base_para_pedido:', error.message);
    }

    let headers: string[] = [];
    if (count && count > 0) {
      const { data: sample } = await supabase
        .from('base_para_pedido')
        .select('headers')
        .eq('project_id', projectId)
        .eq('service_id', serviceId)
        .limit(1)
        .maybeSingle();

      if (sample && sample.headers && Array.isArray(sample.headers)) {
        headers = sample.headers;
      }
    }

    const lastUpdateSetting = await HistoryHandler.getSetting('TRUST_BASE_PEDIDO_LAST_UPDATE', projectId, serviceId);
    let lastUpdate = null;
    if (lastUpdateSetting) {
      try { lastUpdate = JSON.parse(lastUpdateSetting); } catch (_) { lastUpdate = lastUpdateSetting; }
    }

    return {
      count: count || 0,
      headers,
      lastUpdate
    };
  }

  /**
   * Genera el archivo Excel de la plantilla de pedidos para enviarle al cliente.
   * Mantiene exactamente todas las columnas originales del Excel cargado y
   * le agrega una columna destacada final: "CANTIDAD A PEDIR".
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

    // Tomar los encabezados dinámicos
    const originalHeaders: string[] = rows[0]?.headers || (rows[0]?.data ? Object.keys(rows[0].data) : []);
    const quantityColName = "CANTIDAD A PEDIR";

    // Reconstruir cada fila asegurando el orden exacto de columnas + la columna para pedir
    const excelRows = rows.map(r => {
      const rowData = r.data || {};
      const newRow: Record<string, any> = {};
      
      for (const h of originalHeaders) {
        newRow[h] = rowData[h] !== undefined ? rowData[h] : '';
      }
      
      // Columna donde el cliente ingresa su pedido
      newRow[quantityColName] = ''; 
      return newRow;
    });

    const worksheet = XLSX.utils.json_to_sheet(excelRows);

    // Ajuste de ancho de columnas automático para presentación profesional
    const allHeaders = [...originalHeaders, quantityColName];
    worksheet['!cols'] = allHeaders.map(h => {
      const maxLen = Math.max(
        h.length,
        ...excelRows.slice(0, 30).map(r => String(r[h] || '').length)
      );
      return { wch: Math.min(Math.max(maxLen + 3, 12), 50) };
    });

    const workbook = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(workbook, worksheet, "Planilla de Pedido");

    const tmpDir = path.resolve("./tmp/plantillas_pedido");
    if (!fs.existsSync(tmpDir)) {
      fs.mkdirSync(tmpDir, { recursive: true });
    }

    const customerSuffix = options?.customerCode ? `_${options.customerCode}` : '';
    const fileName = `Planilla_Pedido_Trust${customerSuffix}_${Date.now()}.xlsx`;
    const filePath = path.join(tmpDir, fileName);

    XLSX.writeFile(workbook, filePath);
    console.log(`[TrustOrderBaseService] 📄 Planilla Excel generada exitosamente en: ${filePath}`);

    return {
      filePath,
      fileName,
      totalItems: rows.length,
      totalRows: rows.length
    };
  }

  /**
   * Procesa la planilla Excel que completó y devolvió el cliente por WhatsApp.
   * Detecta la columna de cantidad y extrae todos los artículos donde la cantidad > 0.
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
      || columnKeys[columnKeys.length - 1]; // Fallback a la última columna agregada

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
        // Limpiar caracteres no numéricos excepto punto o coma
        const cleanQtyStr = String(rawQty).trim().replace(',', '.');
        const qtyNum = parseFloat(cleanQtyStr);

        if (!isNaN(qtyNum) && qtyNum > 0) {
          const codeVal = r[codeKey] !== undefined ? String(r[codeKey]).trim() : '';
          const descVal = r[descKey] !== undefined ? String(r[descKey]).trim() : '';

          if (codeVal) {
            items.push({
              code: codeVal,
              quantity: Math.round(qtyNum), // o decimal si admite fraccionados
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
