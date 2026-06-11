// src/apis/external/Aquavita/FacturacionApi.ts
import axios from 'axios';
import { getSessionToken, ensureValidToken } from './SessionApi';

const BASE_URL = {
  toString() {
    return process.env.AQUAVITA_SWS_BASE_URL || process.env.SWS_BASE_URL || '';
  }
} as unknown as string;

export class AdministracionApi {

  static async obtenerServiciosTecnicosCliente(clienteId: number, desde: string, hasta?: string) {
    await ensureValidToken();
    const url = `${BASE_URL}/UsuariosClientes/ObtenerServiciosTecnicos`;
    const headers = { 'CURRENTTOKENVALUE': getSessionToken() || '' };
    const _hasta = hasta || new Date().toLocaleDateString('es-AR');
    const params = { clienteId, desde, hasta: _hasta };
    return axios.get(url, { headers, params });
  }

  static async descargarRemitoPorVenta(idVenta: number) {
    await ensureValidToken();
    const url = `${BASE_URL}/VentasEntregas/ObtenerRemitoPorVenta`;
    const headers = { 'CURRENTTOKENVALUE': getSessionToken() || '' };
    const params = { idVenta };
    return axios.get(url, { headers, params, responseType: 'blob' });
  }

  static async historialFacturasCliente(cliente_id: number, fechaDesde: string, fechaHasta: string, saldoPendiente: boolean = false) {
    await ensureValidToken();
    const url = `${BASE_URL}/Facturacion/ObtenerHistorialDeFacturas`;
    const headers = { 'CURRENTTOKENVALUE': getSessionToken() || '', 'Content-Type': 'application/json' };
    const _fechaHasta = fechaHasta || new Date().toLocaleDateString('es-AR');
    const data = { cliente_id, fechaDesde, fechaHasta: _fechaHasta, saldoPendiente };
    return axios.post(url, data, { headers });
  }

  static async recibosPagoCliente(clienteId: number, fechaReciboDesde: string, fechaReciboHasta: string, saldoDisponible: boolean = false) {
    await ensureValidToken();
    const url = `${BASE_URL}/Recibos/ObtenerRecibosDeCobros`;
    const headers = { 'CURRENTTOKENVALUE': getSessionToken() || '', 'Content-Type': 'application/json' };
    const _fechaReciboHasta = fechaReciboHasta || new Date().toLocaleDateString('es-AR');
    const data = { clienteId, fechaReciboDesde, fechaReciboHasta: _fechaReciboHasta, saldoDisponible };
    return axios.post(url, data, { headers });
  }

  static async resumenCuentaCliente(clienteId: number, desde: string, hasta: string) {
    await ensureValidToken();
    const url = `${BASE_URL}/Movimientos/BuscarMovimientos`;
    const headers = { 'CURRENTTOKENVALUE': getSessionToken() || '', 'Content-Type': 'application/json' };
    const _hasta = hasta || new Date().toLocaleDateString('es-AR');
    const data = { clienteId, desde, hasta: _hasta };
    return axios.post(url, data, { headers });
  }

  static async remitosEntrega(cliente_id: number, fechaDesde: string, fechaHasta: string, consumosSinFacturar: boolean = false) {
    await ensureValidToken();
    const url = `${BASE_URL}/Movimientos/ObtenerVentasPorCliente`;
    const headers = { 'CURRENTTOKENVALUE': getSessionToken() || '', 'Content-Type': 'application/json' };
    const _fechaHasta = fechaHasta || new Date().toLocaleDateString('es-AR');
    const data = { cliente_id, fechaDesde, fechaHasta: _fechaHasta, consumosSinFacturar };
    return axios.post(url, data, { headers });
  }

  static async descargarRemito(remito_id: number) {
    await ensureValidToken();
    const url = `${BASE_URL}/Remitos/Descargar`;
    const headers = { 'CURRENTTOKENVALUE': getSessionToken() || '' };
    const params = { remito_id };
    return axios.get(url, { headers, params, responseType: 'blob' });
  }

  static async descargarArchivo(archivo_id: number) {
    await ensureValidToken();
    const url = `${BASE_URL}/Archivos/Descargar`;
    const headers = { 'CURRENTTOKENVALUE': getSessionToken() || '' };
    const params = { archivo_id };
    return axios.get(url, { headers, params, responseType: 'blob' });
  }

  static async reenviarFacturaPorMail(facturaId: number) {
    await ensureValidToken();
    const url = `${BASE_URL}/Facturacion/EnviarFacturaPorMail`;
    const headers = { 'CURRENTTOKENVALUE': getSessionToken() || '', 'Content-Type': 'application/json' };
    const data = { facturaId };
    return axios.post(url, data, { headers });
  }

  static async reenviarRemitoPorMail(remitoId: number) {
    await ensureValidToken();
    const url = `${BASE_URL}/Facturacion/EnviarRemitoPorMail`;
    const headers = { 'CURRENTTOKENVALUE': getSessionToken() || '', 'Content-Type': 'application/json' };
    const data = { remitoId };
    return axios.post(url, data, { headers });
  }

  static async reenviarReciboPorMail(reciboId: number) {
    await ensureValidToken();
    const url = `${BASE_URL}/Recibos/EnviarPorMail`;
    const headers = { 'CURRENTTOKENVALUE': getSessionToken() || '', 'Content-Type': 'application/json' };
    const data = { reciboId };
    return axios.post(url, data, { headers });
  }

  static async obtenerLinkPago(cliente_id: number, monto: number) {
    await ensureValidToken();
    const url = `${BASE_URL}/Sync/ObtenerLinkMP`;
    const headers = { 'CURRENTTOKENVALUE': getSessionToken() || '', 'Content-Type': 'application/json' };
    const data = { cliente_id, monto };
    return axios.post(url, data, { headers });
  }
}
