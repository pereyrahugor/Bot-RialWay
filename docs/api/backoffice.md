# Documentación API Backoffice - Bot-ApiSWS

Esta documentación describe los endpoints disponibles para la gestión del backoffice del bot, incluyendo la nueva funcionalidad de paginación para optimizar el rendimiento con grandes volúmenes de datos.

## Información General

- **Base URL**: `/api/backoffice`
- **Autenticación**: La mayoría de los endpoints requieren un header de autorización o un token configurado en las variables de entorno (`BACKOFFICE_TOKEN`).
- **Formato de Respuesta**: Todas las respuestas son en formato JSON.

---

## Endpoints de Autenticación

### `POST /auth`
Verifica si un token es válido para acceder al backoffice.
- **Body**: `{ "token": "tu_token" }`
- **Respuesta**: `{ "success": true }` o `401 Unauthorized`

---

## Gestión de Chats y Mensajes

### `GET /chats`
Obtiene la lista de chats activos, ordenados por el último mensaje recibido. Incluye las etiquetas asociadas a cada chat.
- **Query Params**:
  - `limit` (opcional, default 20): Cantidad de chats a recuperar.
  - `offset` (opcional, default 0): Punto de inicio para la paginación.
- **Implementación**: Utiliza carga parcial (Infinite Scroll) en el frontend.

### `GET /messages/:chatId`
Obtiene el historial de mensajes para un chat específico.
- **Query Params**:
  - `limit` (opcional, default 50): Cantidad de mensajes a recuperar.
  - `offset` (opcional, default 0): Punto de inicio para la paginación (offset desde el mensaje más reciente).
- **Nota**: El frontend implementa scroll infinito hacia arriba para cargar mensajes históricos.

### `GET /profile-pic/:chatId`
Obtiene la URL de la foto de perfil de WhatsApp.
- **Query Params**: `token` (requerido).
- **Respuesta**: Redirección (302) a la URL de la imagen en los servidores de WhatsApp.

---

## Interacción y Control

### `POST /send-message`
Envía un mensaje de texto o archivos multimedia (imágenes, videos, documentos) a través del bot.
- **Content-Type**: `multipart/form-data`
- **Campos**:
  - `chatId` (string, requerido): Número de teléfono o JID del destinatario.
  - `message` (string, opcional): Cuerpo del mensaje.
  - `file` (archivo, opcional): Archivo multimedia a enviar.

### `POST /toggle-bot`
Activa o desactiva la inteligencia artificial para un chat específico (Intervención Humana).
- **Body**: `{ "chatId": "...", "enabled": true|false }`
- **Efecto**: Si se desactiva (`enabled: false`), el bot dejará de responder automáticamente a ese usuario hasta que se reactive.

---

## Gestión de Etiquetas (Tags)

### `GET /tags`
Lista todas las etiquetas globales creadas en el sistema.

### `POST /tags`
Crea una nueva etiqueta global.
- **Body**: `{ "name": "Nombre", "color": "#HEX" }`

### `PUT /tags/:id`
Actualiza el nombre o color de una etiqueta existente.

### `DELETE /tags/:id`
Elimina una etiqueta global del sistema.

### `POST /chats/:chatId/tags`
Asigna una etiqueta existente a un chat específico.
- **Body**: `{ "tagId": "UUID" }`

### `DELETE /chats/:chatId/tags/:tagId`
Remueve una etiqueta de un chat.

---

## Notas de Rendimiento
La implementación de `limit` y `offset` permite que el sistema maneje miles de chats sin degradar la velocidad de carga inicial. El frontend (`backoffice.js`) gestiona automáticamente la solicitud de nuevos datos a medida que el usuario se desplaza por la interfaz.
