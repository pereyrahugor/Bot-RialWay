# ⌨️ Comandos del Administrador

Existen comandos especiales que pueden enviarse directamente por WhatsApp al número del bot para controlar su estado global. Estos comandos solo funcionan si el remitente tiene permisos o si el bot está configurado para escucharlos.

## 🕹️ Comandos Disponibles

### `#OFF#`
Desactiva el bot globalmente.
- **Efecto**: El bot dejará de responder a cualquier mensaje entrante.
- **Respuesta**: 🛑 Bot desactivado. No responderé a más mensajes hasta recibir #ON#.

### `#ON#`
Activa el bot globalmente.
- **Efecto**: El bot retoma su funcionamiento normal.
- **Respuesta**: 🤖 Bot activado.

### `#ACTUALIZAR#`
Fuerza la sincronización de datos con Google Sheets.
- **Efecto**: Ejecuta de nuevo la carga de datos desde las hojas configuradas.
- **Respuesta**: 🔄 Datos actualizados desde Google.

---

## 🔗 Enlaces Cruzados
- [Lógica de Procesamiento (Módulo)](../modulos/assistant-processor.md)
- [Variables de Entorno](../configuracion/variables-entorno.md)
