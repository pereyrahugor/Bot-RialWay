import { swsClient } from './swsClient';

export class AdministracionApi {

  static async obtenerServiciosTecnicosCliente(clienteId: number, desde: string, hasta?: string) {
    const url = `/UsuariosClientes/ObtenerServiciosTecnicos`;
    const _hasta = hasta || new Date().toLocaleDateString('es-AR');
    const params = { clienteId, desde, hasta: _hasta };
    return swsClient.get(url, { params });
  }

  static async descargarRemitoPorVenta(idVenta: number) {
    const url = `/VentasEntregas/ObtenerRemitoPorVenta`;
    const params = { idVenta };
    return swsClient.get(url, { params, responseType: 'blob' });
  }

  static async historialFacturasCliente(cliente_id: number, fechaDesde: string, fechaHasta: string, saldoPendiente: boolean = false) {
    const url = `/Facturacion/ObtenerHistorialDeFacturas`;
    const _fechaHasta = fechaHasta || new Date().toLocaleDateString('es-AR');
    const data = { cliente_id, fechaDesde, fechaHasta: _fechaHasta, saldoPendiente };
    return swsClient.post(url, data);
  }

  static async recibosPagoCliente(clienteId: number, fechaReciboDesde: string, fechaReciboHasta: string, saldoDisponible: boolean = false) {
    const url = `/Recibos/ObtenerRecibosDeCobros`;
    const _fechaReciboHasta = fechaReciboHasta || new Date().toLocaleDateString('es-AR');
    const data = { clienteId, fechaReciboDesde, fechaReciboHasta: _fechaReciboHasta, saldoDisponible };
    return swsClient.post(url, data);
  }

  static async resumenCuentaCliente(clienteId: number, desde: string, hasta: string) {
    const url = `/Movimientos/BuscarMovimientos`;
    const _hasta = hasta || new Date().toLocaleDateString('es-AR');
    const data = { clienteId, desde, hasta: _hasta };
    return swsClient.post(url, data);
  }

  static async remitosEntrega(cliente_id: number, fechaDesde: string, fechaHasta: string, consumosSinFacturar: boolean = false) {
    const url = `/Movimientos/ObtenerVentasPorCliente`;
    const _fechaHasta = fechaHasta || new Date().toLocaleDateString('es-AR');
    const data = { cliente_id, fechaDesde, fechaHasta: _fechaHasta, consumosSinFacturar };
    return swsClient.post(url, data);
  }

  static async descargarRemito(remito_id: number) {
    const url = `/Remitos/Descargar`;
    const params = { remito_id };
    return swsClient.get(url, { params, responseType: 'blob' });
  }

  static async descargarArchivo(archivo_id: number) {
    const url = `/Archivos/Descargar`;
    const params = { archivo_id };
    return swsClient.get(url, { params, responseType: 'blob' });
  }

  static async reenviarFacturaPorMail(facturaId: number) {
    const url = `/Facturacion/EnviarFacturaPorMail`;
    const data = { facturaId };
    return swsClient.post(url, data);
  }

  static async reenviarRemitoPorMail(remitoId: number) {
    const url = `/Facturacion/EnviarRemitoPorMail`;
    const data = { remitoId };
    return swsClient.post(url, data);
  }

  static async reenviarReciboPorMail(reciboId: number) {
    const url = `/Recibos/EnviarPorMail`;
    const data = { reciboId };
    return swsClient.post(url, data);
  }

  static async obtenerLinkPago(cliente_id: number, monto: number) {
    const url = `/Sync/ObtenerLinkMP`;
    const data = { cliente_id, monto };
    return swsClient.post(url, data);
  }
}
