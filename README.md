# WhatsApp AI Assistant Bot (BuilderBot.app)

Este repositorio implementa un bot de WhatsApp con integración de IA (OpenAI Assistant) usando BuilderBot. Permite automatizar conversaciones, responder preguntas frecuentes, gestionar flujos personalizados y conectar con APIs externas como Google Sheets y Google Calendar.

---

## Funcionalidad principal
- **Conector WhatsApp**: Vinculación QR y gestión de sesión persistente.
- **Backoffice Avanzado**: Filtros, historial completo, etiquetas y coexistencia Bot/Humano.
- **CRM Kanban**: Tablero visual de oportunidades con estados personailzables.
- **Gestión Multi-agente**: Creación de usuarios con acceso restringido y asignación de Leads.
- **IA Generativa**: Integración con OpenAI Assistant (texto, imágenes y voz).
- **Dashboard de KPIs**: Métricas en tiempo real sobre conversión y productividad.
- **Sincronización Hot-Update**: Cambio de credenciales y ajustes sin reiniciar el servidor.

---

## 📖 Documentación y Uso
Para obtener instrucciones detalladas sobre el manejo del sistema, consulta:
- [📘 Guía de Instrucciones de Uso (Backoffice, CRM, Tickets)](./docs/INSTRUCCIONES_USO.md)
- [⚙️ Configuración de Variables y Alertas](./docs/configuracion/)

## Variables de entorno usadas

### OpenAI y Asistente
- `ASSISTANT_ID`: ID del asistente principal de OpenAI
- `OPENAI_API_KEY`: API Key de OpenAI para texto
- `ASSISTANT_ID_IMG`: ID del asistente de imágenes
- `OPENAI_API_KEY_IMG`: API Key de OpenAI para imágenes
- `ID_GRUPO_RESUMEN`: ID del grupo de WhatsApp para reportes

### Mensajes y Flujos
- `msjCierre`: Mensaje de cierre de conversación
- `msjSeguimiento1`: Mensaje de seguimiento 1
- `msjSeguimiento2`: Mensaje de seguimiento 2
- `msjSeguimiento3`: Mensaje de seguimiento 3
- `timeOutCierre`: Timeout para cierre (minutos)
- `timeOutSeguimiento2`: Timeout seguimiento 2 (minutos)
- `timeOutSeguimiento3`: Timeout seguimiento 3 (minutos)
- `PORT`: Puerto de la app (Railway usa 8080 por defecto)

### Google Sheets
- `GOOGLE_CLIENT_EMAIL`: Email de la cuenta de servicio
- `GOOGLE_PRIVATE_KEY`: Private key de la cuenta de servicio
- `SHEET_ID_UPDATE`: IDs de Sheets separados por coma
- `VECTOR_STORE_ID`: ID de vector store para embeddings

### Google Calendar
- `GOOGLE_CALENDAR_ID`: ID del calendario a usar ("primary" por defecto)

---

## Detalles de uso

1. Clona el repositorio y crea un archivo `.env` con las variables anteriores.
2. Instala dependencias con `pnpm install` o `npm install`.
3. Ejecuta el bot en desarrollo con `pnpm run dev` o despliega con Docker/Railway.
4. Configura los IDs y credenciales de Google en la consola de Google Cloud.
5. Personaliza los flujos en la carpeta `src/Flows` según tus necesidades.
6. Para Google Calendar, usa la clase `CalendarEvents` para crear, modificar, eliminar y consultar disponibilidad de eventos.
7. Los mensajes de contactos ignorados (ej: @lid) no se procesan y se reportan al admin.

---

## Integraciones
- BuilderBot: https://builderbot.vercel.app/
- OpenAI: https://platform.openai.com/
- Railway: https://railway.app/
- Google Cloud: https://console.cloud.google.com/

---

## Soporte y contacto
- Discord: https://link.codigoencasa.com/DISCORD
- Twitter: https://twitter.com/leifermendez
- Donaciones: https://coff.ee/duskcodes

---

Este instructivo puede ser usado en NotebookLM para consultas y entrenamiento personalizado.


