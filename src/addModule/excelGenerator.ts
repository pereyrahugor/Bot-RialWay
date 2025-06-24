import ExcelJS from 'exceljs';
import path from 'path';
import fs from 'fs';
import { ResumenData } from '~/utils/googleSheetsResumen';

export default class ExcelGenerator {
    private resumenData: ResumenData;

    constructor(resumenData: ResumenData) {
        this.resumenData = resumenData;
    }

    async generateExcel(): Promise<string> {
        const workbook = new ExcelJS.Workbook();
        const sheet = workbook.addWorksheet('Resumen Pedido');

        // Agregar datos generales en la parte superior
        sheet.addRow(['Cliente Nombre', this.resumenData.cliente.nombre]);
        sheet.addRow(['Cliente Contacto', this.resumenData.cliente.contacto]);
        sheet.addRow(['Entrega Tipo', this.resumenData.entrega?.tipo || '']);
        sheet.addRow(['Fecha Entrega/Retiro', this.resumenData.entrega?.fecha_entrega || '']);
        sheet.addRow(['Entrega Dirección', this.resumenData.entrega?.direccion || '']);
        sheet.addRow(['Costo Envio', this.resumenData.entrega?.costo_envio || '']);
        sheet.addRow(['Facturación Requiere Factura', this.resumenData.facturacion?.requiere_factura ? 'Sí' : 'No']);
        sheet.addRow(['Facturación Razón Social', this.resumenData.facturacion?.razon_social || '']);
        sheet.addRow(['Facturación CUIT', this.resumenData.facturacion?.CUIT || '']);
        sheet.addRow(['Facturación Condición Fiscal', this.resumenData.facturacion?.condicion_fiscal || '']);
        sheet.addRow([]); // Línea en blanco

        // Agregar encabezados de los artículos
        sheet.addRow(['Artículo', 'Variedad', 'Marca', 'Descripción', 'Cantidad', 'Precio Unitario', 'Subtotal']);
        // Agregar datos del pedido
        this.resumenData.pedido.forEach((item) => {
            sheet.addRow([
                item.articulo,
                item.variedad,
                item.marca,
                item.descripcion,
                item.cantidad,
                item.precio_unitario,
                item.subtotal,
            ]);
        });

        // Agregar totales
        sheet.addRow([]);
        sheet.addRow(['Total', '', '', '', '', '', this.resumenData.total_final]);

        // Formatear fecha
        const now = new Date();
        const fecha = `${now.getFullYear()}${String(now.getMonth() + 1).padStart(2, '0')}${String(now.getDate()).padStart(2, '0')}`;

        // Generar nombre de archivo: pedido_(numero contacto)_fecha.xlsx
        const contacto = this.resumenData.cliente.contacto.replace(/\D/g, '');
        const fileName = `pedido_${contacto}_${fecha}.xlsx`;
        const filePath = path.join('temp', fileName);

        // Asegurarse de que la carpeta temp existe
        if (!fs.existsSync('temp')) {
            fs.mkdirSync('temp', { recursive: true });
        }

        await workbook.xlsx.writeFile(filePath);
        console.log(`📂 Archivo Excel guardado en: ${filePath}`);
        return filePath;
    }
}