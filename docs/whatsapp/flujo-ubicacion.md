# 📍 Ubicación y Google Maps

El bot tiene la capacidad de procesar ubicaciones compartidas por los usuarios de WhatsApp para realizar búsquedas inteligentes o geolocalización.

## 🔗 Funcionamiento
- **Trigger**: Se activa automáticamente cuando un usuario comparte una ubicación desde la aplicación de WhatsApp.
- **Procesamiento**:
  1. Extrae las coordenadas (latitud y longitud).
  2. Utiliza la `GOOGLE_MAPS_API_KEY` para realizar una búsqueda inversa de dirección o puntos de interés cercanos.
  3. Informa al asistente de OpenAI sobre la ubicación del usuario para que este pueda dar respuestas contextuales (ej: "¿Dónde queda la sucursal más cercana?").

## 🗺️ Integración con Google Maps
El bot utiliza el SDK oficial de Google Maps para Node.js para interactuar con:
- **Geocoding API**: Para convertir coordenadas en direcciones legibles.
- **Places API**: Para buscar negocios o servicios específicos alrededor del usuario.

---

## 🔗 Enlaces Cruzados
- [Variables de Entorno](../configuracion/variables-entorno.md)
- [Información del Asistente](../api/assistant.md)
