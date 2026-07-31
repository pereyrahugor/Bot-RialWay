# 📡 Guía de Integración de Webhooks Salientes

Los webhooks salientes de Neurolinks permiten recibir notificaciones HTTP en tiempo real en tu propio servidor cuando ocurren eventos clave dentro de la plataforma.

---

## ⚙️ Configuración en Neurolinks

1. Dirígete a la pestaña **Integraciones > Webhooks**.
2. Especifica tu **URL de Webhook** (debe comenzar con `https://`).
3. (Opcional pero recomendado) Genera o ingresa un **Secreto de Firma HMAC** para asegurar y verificar que las solicitudes provienen de Neurolinks.
4. Selecciona con un tilde los **Eventos Suscritos** que necesitas recibir.
5. Guarda los cambios.
6. Haz clic en **Enviar Evento de Prueba** para verificar la comunicación directa con tu servidor.

---

## 🗂️ Catálogo de Eventos

Todos los webhooks se envían mediante solicitudes `POST` con el siguiente formato JSON base:

```json
{
  "event": "nombre.del.evento",
  "timestamp": "2026-07-30T17:15:00.000Z",
  "project_id": "id-del-proyecto",
  "data": { ... }
}
```

### 1. `contact.updated`
Se dispara cuando se actualiza la información de perfil de un cliente o contacto.
*   **Payload `data`:**
    ```json
    {
      "chat_id": "5491130792788",
      "name": "Hugo Pereyra",
      "phone": "5491130792788",
      "email": "contacto@neurolinks.com",
      "cuit_dni": "20301234567",
      "address": "Av. Siempreviva 742",
      "notes": "Interesado en propuestas premium",
      "crm_status": "propuesta",
      "offered_product": "Bot Automatizado",
      "source": "WhatsApp Directo"
    }
    ```

### 2. `lead.created`
Se emite inmediatamente cuando se crea un nuevo ticket/oportunidad comercial ("Nuevo Lead") en el CRM.
*   **Payload `data`:**
    ```json
    {
      "ticket_id": "b6337282-8b14-4f41-b84a-f73301ed3f06",
      "chat_id": "5491130792788",
      "title": "Lead: Hugo Pereyra",
      "description": "Contacto inicial interesado",
      "crm_status": "Abierto",
      "priority": "Alta",
      "created_at": "2026-07-30T17:00:00.000Z"
    }
    ```

### 3. `lead.expired`
Se activa al alcanzarse la fecha y hora de alerta (`crm_due_date`) configurada en un lead activo.
*   **Payload `data`:**
    ```json
    {
      "ticket_id": "b6337282-8b14-4f41-b84a-f73301ed3f06",
      "chat_id": "5491130792788",
      "title": "Lead: Hugo Pereyra",
      "expired_alert_date": "2026-07-30T17:15:00.000Z",
      "crm_status": "propuesta"
    }
    ```

### 4. `lead.status_moved`
Se genera cuando un lead se arrastra a otra columna o cambia su etapa de estado en el pipeline del CRM.
*   **Payload `data`:**
    ```json
    {
      "ticket_id": "b6337282-8b14-4f41-b84a-f73301ed3f06",
      "chat_id": "5491130792788",
      "title": "Lead: Hugo Pereyra",
      "crm_status": "negociación",
      "priority": "Alta",
      "updated_at": "2026-07-30T17:18:00.000Z"
    }
    ```

### 5. `message.received`
Se genera cada vez que entra un mensaje directo de un cliente a la plataforma.
*   **Payload `data`:**
    ```json
    {
      "chat_id": "5491130792788",
      "role": "user",
      "content": "Hola, necesito más información sobre los planes",
      "type": "text",
      "external_id": "msg_98471924719842",
      "created_at": "2026-07-30T17:10:00.000Z"
    }
    ```

---

## 🔒 Seguridad: Validación de Firmas HMAC

Si configuras un **Secreto de Firma**, Neurolinks calculará una firma digital y la incluirá en la cabecera HTTP `X-Neurolinks-Signature`. Esta firma te permite certificar que la petición proviene de Neurolinks y no fue alterada.

### Cómo verificar la firma en Node.js (Express)

```javascript
import crypto from 'crypto';

app.post('/webhook', (req, res) => {
    const signature = req.headers['x-neurolinks-signature'];
    const secret = 'tu_secreto_webhook_configurado';
    
    // Obtener el body JSON sin formatear (raw body string)
    const rawBody = JSON.stringify(req.body);

    const hmac = crypto.createHmac('sha256', secret);
    hmac.update(rawBody);
    const computedSignature = hmac.digest('hex');

    if (crypto.timingSafeEqual(Buffer.from(signature), Buffer.from(computedSignature))) {
        // Firma válida y origen seguro
        res.status(200).send('OK');
    } else {
        // Solicitud no autorizada
        res.status(401).send('Firma inválida');
    }
});
```
