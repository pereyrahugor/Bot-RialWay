WhatsApp AI Assistant Bot (BuilderBot.app)
==========================================

Este repositorio implementa un bot de WhatsApp con integración de IA (OpenAI Assistant) usando BuilderBot. Permite automatizar conversaciones, responder preguntas frecuentes, gestionar flujos personalizados y conectar con APIs externas como Google Sheets y Google Calendar.

---

FUNCIONALIDAD PRINCIPAL
----------------------
- Automatización de respuestas en WhatsApp
- Integración con OpenAI Assistant (texto, imágenes)
- Flujos personalizables por evento (texto, voz, imagen, documento)
- Sincronización y consulta de datos desde Google Sheets
- Gestión de eventos en Google Calendar (alta, modificación, baja, consulta de disponibilidad)
- Reporte de mensajes ignorados (ej: contactos @lid) al administrador
- Despliegue sencillo vía Docker y Railway

---

VARIABLES DE ENTORNO USADAS
---------------------------

# OpenAI y Asistente
ASSISTANT_ID=                # ID del asistente principal de OpenAI
OPENAI_API_KEY=              # API Key de OpenAI para texto
ASSISTANT_ID_IMG=            # ID del asistente de imágenes
OPENAI_API_KEY_IMG=          # API Key de OpenAI para imágenes
ID_GRUPO_RESUMEN=            # ID del grupo de WhatsApp para reportes

# Mensajes y Flujos
msjCierre=                   # Mensaje de cierre de conversación
msjSeguimiento1=             # Mensaje de seguimiento 1
msjSeguimiento2=             # Mensaje de seguimiento 2
msjSeguimiento3=             # Mensaje de seguimiento 3
timeOutCierre=               # Timeout para cierre (minutos)
timeOutSeguimiento2=         # Timeout seguimiento 2 (minutos)
timeOutSeguimiento3=         # Timeout seguimiento 3 (minutos)
PORT=                        # Puerto de la app (Railway usa 8080 por defecto)

# Google Sheets
GOOGLE_CLIENT_EMAIL=         # Email de la cuenta de servicio
GOOGLE_PRIVATE_KEY=          # Private key de la cuenta de servicio
SHEET_ID_UPDATE=             # IDs de Sheets separados por coma
VECTOR_STORE_ID=             # ID de vector store para embeddings

# Google Calendar
GOOGLE_CALENDAR_ID=          # ID del calendario a usar ("primary" por defecto)

---

DETALLES DE USO
---------------

1. Clona el repositorio y crea un archivo `.env` con las variables anteriores.
2. Instala dependencias con `pnpm install` o `npm install`.
3. Ejecuta el bot en desarrollo con `pnpm run dev` o despliega con Docker/Railway.
4. Configura los IDs y credenciales de Google en la consola de Google Cloud.
5. Personaliza los flujos en la carpeta `src/Flows` según tus necesidades.
6. Para Google Calendar, usa la clase `CalendarEvents` para crear, modificar, eliminar y consultar disponibilidad de eventos.
7. Los mensajes de contactos ignorados (ej: @lid) no se procesan y se reportan al admin.

---

INTEGRACIONES
-------------
- BuilderBot: https://builderbot.vercel.app/
- OpenAI: https://platform.openai.com/
- Railway: https://railway.app/
- Google Cloud: https://console.cloud.google.com/

---

SOPORTE Y CONTACTO
------------------
- Discord: https://link.codigoencasa.com/DISCORD
- Twitter: https://twitter.com/leifermendez
- Donaciones: https://coff.ee/duskcodes

---

Este instructivo puede ser usado en NotebookLM para consultas y entrenamiento personalizado.
