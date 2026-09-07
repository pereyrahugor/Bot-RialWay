# Especificación de API: Envío y Recepción de Mensajes (v1)

Esta documentación describe la interfaz técnica para enviar mensajes estándar de WhatsApp desde sistemas externos y para recibir eventos en tiempo real a través de Webhooks utilizando el motor de **Neurolinks**.

---

## 🔒 Esquema de Autenticación (Handshake)

Tanto el envío de plantillas como el envío de mensajes estándar utilizan el mismo protocolo de Handshake de dos pasos basado en tokens efímeros para mitigar ataques de replay y asegurar la integridad de las transacciones.

### 1. Handshake (Auth)
*   Debes autenticarse utilizando tu `api_key` de larga duración para obtener un **One-Time Token (OTT)** temporal en `/api/v1/auth`.
*   **TTL del Token:** 5 minutos.
*   **Uso Único:** El token se invalida automáticamente tras el primer envío (sea este exitoso o fallido).

---

## 🚀 Envío de Mensajes (API)

### POST `/api/v1/send-message`
Envía un mensaje estándar a un cliente específico utilizando la misma estructura de datos (payload) que se envía a Meta Cloud API.

#### 📥 Cuerpo de la Petición (Request Body):

##### 1. Mensaje de Texto Plano
```json
{
    "token": "TU_TOKEN_TEMPORAL",
    "messaging_product": "whatsapp",
    "recipient_type": "individual",
    "to": "5491122334455",
    "type": "text",
    "text": {
        "body": "Hola, ¿cómo estás?"
    }
}
```

##### 2. Mensaje de Imagen
```json
{
    "token": "TU_TOKEN_TEMPORAL",
    "messaging_product": "whatsapp",
    "recipient_type": "individual",
    "to": "5491122334455",
    "type": "image",
    "image": {
        "link": "https://url-publica-de-tu-imagen.jpg",
        "caption": "Mira esta imagen promocional"
    }
}
```

##### 3. Mensaje de Video
```json
{
    "token": "TU_TOKEN_TEMPORAL",
    "messaging_product": "whatsapp",
    "recipient_type": "individual",
    "to": "5491122334455",
    "type": "video",
    "video": {
        "link": "https://url-publica-de-tu-video.mp4",
        "caption": "Mira este video"
    }
}
```

##### 4. Mensaje de Documento (PDF, XLSX, etc.)

Los documentos pueden enviarse por dos métodos según la arquitectura de tu sistema:

###### 4.a. Por URL pública (`link`)
Utiliza este método cuando el documento ya se encuentra alojado en un servidor web o bucket cloud público accesible por Meta.
```json
{
    "token": "TU_TOKEN_TEMPORAL",
    "messaging_product": "whatsapp",
    "recipient_type": "individual",
    "to": "5491122334455",
    "type": "document",
    "document": {
        "link": "https://url-publica-de-tu-documento.pdf",
        "filename": "reporte.pdf",
        "caption": "Adjunto el reporte mensual"
    }
}
```

###### 4.b. Por Media ID de Meta (`id`)
Utiliza este método cuando el archivo es privado o confidencial (ej. facturas, recibos o comprobantes generados localmente por un ERP como Tango o SAP) y **no se desea publicar en internet**:
1. **Subida del archivo (Upload)**: Tu sistema sube el binario directamente a Meta Cloud API:
   * **Endpoint:** `POST https://graph.facebook.com/v25.0/{phone_number_id}/media`
   * **Headers:** `Authorization: Bearer <META_ACCESS_TOKEN>`
   * **Body (form-data):**
     * `messaging_product`: `whatsapp`
     * `type`: `application/pdf`
     * `file`: `@archivo.pdf`
   * **Respuesta de Meta:** `{ "id": "1234567890123456" }`
2. **Envío del mensaje con el ID**: Con el ID obtenido, envías el mensaje al CRM sin requerir ninguna URL:
```json
{
    "token": "TU_TOKEN_TEMPORAL",
    "messaging_product": "whatsapp",
    "recipient_type": "individual",
    "to": "5491122334455",
    "type": "document",
    "document": {
        "id": "1234567890123456",
        "filename": "20259062293_0001_00008457.pdf",
        "caption": "Adjunto su comprobante"
    }
}
```

##### 5. Mensaje de Audio
```json
{
    "token": "TU_TOKEN_TEMPORAL",
    "messaging_product": "whatsapp",
    "recipient_type": "individual",
    "to": "5491122334455",
    "type": "audio",
    "audio": {
        "link": "https://url-publica-de-tu-audio.mp3"
    }
}
```

#### 📤 Códigos de Respuesta:
*   **`200 OK`**: Mensaje procesado y enviado exitosamente. Retorna el ID de mensaje generado por Meta.
    ```json
    {
        "success": true,
        "message": "Mensaje enviado con éxito",
        "message_id": "wamid.HBgMNTQ5MTEzMDc5Mjc4OB..."
    }
    ```
*   **`400 Bad Request`**: Parámetros incompletos, faltantes o error de validación en la estructura de Meta.
*   **`401 Unauthorized`**: Token temporal inválido, expirado o ya utilizado.

---

## 📡 Recepción de Mensajes (Webhooks)

El webhook de Neurolinks te notificará en tiempo real en la URL especificada en tu configuración.

### Evento `message.received`
Este evento se dispara cada vez que un cliente envía un mensaje a tu línea de WhatsApp. 

Para facilitar una integración nativa, Neurolinks incluye en el payload la misma estructura de datos que devuelve Meta en su webhook bajo el atributo `raw_payload`.

#### 📤 Payload del Webhook (POST enviado a tu servidor):
```json
{
  "event": "message.received",
  "timestamp": "2026-08-07T13:40:00.000Z",
  "project_id": "id-del-proyecto",
  "service_id": "id-del-servicio",
  "data": {
    "chat_id": "5491122334455",
    "role": "user",
    "content": "Hola, adjunto el reporte solicitado",
    "type": "document",
    "external_id": "wamid.HBgMNTQ5MTEzMDc5Mjc4OB...",
    "created_at": "2026-08-07T13:39:58.000Z",
    "raw_payload": {
      "from": "5491122334455",
      "id": "wamid.HBgMNTQ5MTEzMDc5Mjc4OB...",
      "timestamp": "1786029997",
      "type": "document",
      "document": {
        "filename": "reporte.xlsx",
        "mime_type": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
        "sha256": "...",
        "id": "1234567890"
      }
    }
  }
}
```

---

## 🔒 Validación de Firmas (HMAC SHA256)

Para asegurar la integridad de las notificaciones entrantes de Webhooks, Neurolinks incluye la cabecera `X-Neurolinks-Signature` en cada POST, la cual se calcula utilizando el **Secreto de Firma** de tu panel de configuración.
Puedes consultar la guía detallada de verificación de firmas en la pestaña **Instrucciones de Webhook**.
