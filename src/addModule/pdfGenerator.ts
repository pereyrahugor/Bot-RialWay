import PDFDocument from "pdfkit";
import fs from "fs";
import path from "path";
import moment from "moment";
import { ResumenData } from "~/utils/googleSheetsResumen";
import { extraerDatosResumen } from "~/utils/extractJsonData";

/**
 * Genera un PDF con la información de ResumenData
 * @param resumen - Resumen en formato JSON
 * @param userId - ID del usuario
 * @returns La ruta del archivo PDF generado
 */
export const generarPDF = async (resumen: string, userId: string): Promise<string> => {
    return new Promise((resolve, reject) => {
        try {
            // Extraer datos del resumen
            const data: ResumenData = extraerDatosResumen(resumen);

            // Obtener la fecha actual
            const currentDate = moment().format('YYYYMMDD_HHmmss');

            // Determinar el nombre del archivo
            const nombreArchivo = data.facturacion?.razon_social || data.cliente.nombre || userId;
            const fileName = `${nombreArchivo}_${currentDate}.pdf`.replace(/[^a-zA-Z0-9_\-.]/g, '_'); // Reemplazar caracteres no válidos
            const dirPath = path.resolve("../../temp/data");
            const filePath = path.join(dirPath, fileName);

            // Asegurarse de que el directorio exista
            if (!fs.existsSync(dirPath)) {
                fs.mkdirSync(dirPath, { recursive: true });
            }

            // Crear un nuevo documento PDF
            const doc = new PDFDocument({ margin: 30 });
            const stream = fs.createWriteStream(filePath);
            doc.pipe(stream);

            // Establecer una fuente que soporte caracteres especiales
            doc.font('Helvetica');

            // Agregar contenido al PDF
            doc.fontSize(20).text("ORDEN DE COMPRA", { align: "center" });
            doc.moveDown();

            // Datos generales en la parte superior (igual que Excel)
            doc.fontSize(14).text(`Cliente Nombre: ${data.cliente.nombre}`);
            doc.text(`Cliente Contacto: ${data.cliente.contacto}`);
            if (data.entrega?.tipo) doc.text(`Entrega Tipo: ${data.entrega.tipo}`);
            if (data.entrega?.fecha_entrega) doc.text(`Fecha Entrega/Retiro: ${data.entrega.fecha_entrega}`);
            if (data.entrega?.direccion) doc.text(`Entrega Dirección: ${data.entrega.direccion}`);
            if (data.entrega?.costo_envio) doc.text(`Costo Envio: ${data.entrega.costo_envio}`);
            if (data.facturacion) {
                doc.text(`Facturación Requiere Factura: ${data.facturacion.requiere_factura ? 'Sí' : 'No'}`);
                doc.text(`Facturación Razón Social: ${data.facturacion.razon_social || ''}`);
                doc.text(`Facturación CUIT: ${data.facturacion.CUIT || ''}`);
                doc.text(`Facturación Condición Fiscal: ${data.facturacion.condicion_fiscal || ''}`);
            }
            doc.moveDown();

            // Encabezados de artículos igual que Excel
            doc.fontSize(12).text('Artículo | Variedad | Marca | Descripción | Cantidad | Precio Unitario | Subtotal');
            doc.moveDown(0.5);
            data.pedido.forEach((item) => {
                doc.text(`${item.articulo} | ${item.variedad} | ${item.marca} | ${item.descripcion} | ${item.cantidad} | ${item.precio_unitario} | ${item.subtotal}`);
            });
            doc.moveDown();

            // Totales igual que Excel
            doc.fontSize(14).text(`Total Final: ${data.total_final}`);
            doc.moveDown();

            // Información de contacto
            doc.fontSize(14).text(`📲 WhatsApp: ${data.linkWS || "No disponible"}`);

            // Finalizar y cerrar
            doc.end();

            // Resolver la promesa cuando termine la escritura
            stream.on("finish", () => resolve(filePath));
            stream.on("error", (err) => reject(err));
        } catch (error) {
            reject(error);
        }
    });
};