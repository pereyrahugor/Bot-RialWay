# ⚙️ Variables de Entorno

El bot requiere una serie de variables de entorno para funcionar correctamente. Estas variables manejan la conexión con OpenAI, Google API, Railway y la base de datos de Supabase.

## 🔑 Credenciales Core

| Variable | Descripción | ¿Cómo obtenerla? | Requerido |
| :--- | :--- | :--- | :--- |
| `ASSISTANT_ID` | ID del asistente principal de OpenAI. | OpenAI Platform (Assistants). | Sí |
| `OPENAI_API_KEY` | Clave de API para acceder a OpenAI. | [OpenAI API Keys](https://platform.openai.com/api-keys). | Sí |
| `ASSISTANT_NAME` | Nombre descriptivo del asistente. | Definido por el usuario. | No |

## 📊 Google Integration (Sheets & Calendar)

| Variable | Descripción | ¿Cómo obtenerla? | Requerido |
| :--- | :--- | :--- | :--- |
| `GOOGLE_CLIENT_EMAIL` | Email de la Service Account de Google. | Google Cloud Console. | Sí |
| `GOOGLE_PRIVATE_KEY` | Llave privada de la Service Account. | Google Cloud Console (JSON key). | Sí |
| `SHEET_ID_UPDATE` | ID de la hoja de cálculo de Google. | URL de la hoja de cálculo. | Sí |
| `GOOGLE_CALENDAR_ID` | ID del calendario de Google. | Configuración del calendario. | Sí |
| `GOOGLE_MAPS_API_KEY` | API Key para búsqueda de lugares. | Google Cloud Console (Maps SDK). | Sí |

## ☁️ Railway Management

Estas variables son necesarias para que el bot pueda reiniciarse y gestionar variables a través del Dashboard.

| Variable | Descripción | ¿Cómo obtenerla? | Requerido |
| :--- | :--- | :--- | :--- |
| `RAILWAY_TOKEN` | Token de acceso público de API de Railway. | Railway Account Settings. | Sí |
| `RAILWAY_PROJECT_ID` | ID del proyecto actual en Railway. | Dashboard del proyecto Railway. | Sí |
| `RAILWAY_ENVIRONMENT_ID` | ID del entorno (production, etc). | URL del entorno en Railway. | Sí |
| `RAILWAY_SERVICE_ID` | ID del servicio del bot. | Dashboard del servicio en Railway. | Sí |

## 🗄️ Persistencia y Base de Datos (Supabase)

| Variable | Descripción | ¿Cómo obtenerla? | Requerido |
| :--- | :--- | :--- | :--- |
| `SUPABASE_URL` | URL del proyecto en Supabase. | Supabase Project Settings API. | Sí |
| `SUPABASE_KEY` | Clave API (service_role preferiblemente). | Supabase Project Settings API. | Sí |

## 💬 Mensajería y Timeouts

| Variable | Descripción | Uso |
| :--- | :--- | :--- |
| `ID_GRUPO_RESUMEN` | ID del grupo de WhatsApp para reportes. | Envío automático de resúmenes de cierre. |
| `msjCierre` | Mensaje final al cerrar una conversación. | Despedida automática. |
| `msjSeguimiento1` | Primer mensaje de seguimiento. | Re-activación de leads. |
| `timeOutCierre` | Tiempo en minutos para el cierre. | Automatización de flujo idle. |

---
> **Aviso**: Al usar `GOOGLE_PRIVATE_KEY` en entornos como Railway, asegúrate de que los saltos de línea `\n` estén correctamente codificados para evitar errores de parseo.
