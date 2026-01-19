# 📊 Google Integration

El bot integra múltiples servicios de la Suite de Google para enriquecer la experiencia y automatizar el flujo de datos.

## 📂 Módulos de Google

### Google Sheets (`googleSheetsResumen.ts`)
Utilizado para:
- Registrar cada interacción o consulta relevante.
- Guardar resúmenes de cierre de conversación para análisis posterior (CRM).
- **Variables Relacionadas**: `SHEET_ID_RESUMEN`, `SHEET_ID_UPDATE`.

### Google Calendar
Integración para consultar disponibilidad y agendar turnos de manera automática basada en la conversación con el asistente de IA.
- **Variables Relacionadas**: `GOOGLE_CALENDAR_ID`.

### Google Maps (via SDK)
Búsqueda de direcciones y geocodificación inversa para el flujo de ubicación.

---

## 🔑 Autenticación
La conexión se realiza mediante una **Service Account**. Asegúrate de:
1. Haber compartido los documentos (Sheets/Calendar) con el correo de la Service Account (`GOOGLE_CLIENT_EMAIL`).
2. Tener habilitadas las APIs correspondientes en [Google Cloud Console](https://console.cloud.google.com/).

---

## 🔗 Enlaces Cruzados
- [Variables de Entorno](../configuracion/variables-entorno.md)
- [Ubicación y Google Maps](../whatsapp/flujo-ubicacion.md)
