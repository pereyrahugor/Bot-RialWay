# Guía de Integración: API de Grupos de Meta (WABA)

La API de Grupos de Meta (WhatsApp Business Platform) permite a los negocios crear y administrar de forma programática grupos de conversación de hasta **8 participantes** (incluyendo el número de la empresa). Esta característica es ideal para el envío automatizado de reportes, alertas internas o colaboración directa.

---

## 🛠️ Prerrequisitos y Elegibilidad

Para poder utilizar la API de Grupos de Meta, tu cuenta debe cumplir estrictamente con los siguientes requisitos:

1. **Cuenta Comercial Oficial (OBA):** La cuenta comercial asociada al número debe contar con la insignia verde (Green Tick) verificada por Meta. Las cuentas comerciales estándar no tienen acceso a estos endpoints.
2. **Plataforma Cloud API:** La línea telefónica debe estar registrada mediante WhatsApp Cloud API (no es compatible con números que utilicen la app clásica de WhatsApp Business).
3. **Suscripción de Webhooks:** Tu aplicación de Meta debe estar suscrita a los siguientes eventos de webhook en la configuración de WhatsApp:
   * `group_lifecycle_update` (Notifica la creación, enlace de invitación y eliminación de grupos).
   * `group_participants_update` (Notifica altas y bajas de participantes).
   * `group_settings_update` (Cambios en nombre o imagen del grupo).
   * `group_status_update` (Estado general del grupo).

---

## 1. ➕ Crear un Grupo en Meta WABA

La creación de grupos en la API de Meta es un **flujo asíncrono e invite-only**. El negocio no agrega a los participantes directamente, sino que crea el grupo, y Meta le proporciona un enlace de invitación para que los usuarios se unan voluntariamente.

### Solicitud de Creación
* **Método:** `POST`
* **URL:** `https://graph.facebook.com/v22.0/<BUSINESS_PHONE_NUMBER_ID>/groups`
* **Cabeceras:**
  * `Authorization: Bearer <ACCESS_TOKEN>`
  * `Content-Type: application/json`

### Cuerpo de la Solicitud (Payload)
```json
{
  "messaging_product": "whatsapp",
  "subject": "Grupo de Reportes La Hacendosa",
  "description": "Grupo para el seguimiento de compras y facturación.",
  "join_approval_mode": "auto_approve"
}
```

#### Parámetros del Cuerpo:
* `subject` *(String, Obligatorio)*: Nombre del grupo (máximo 128 caracteres).
* `description` *(String, Opcional)*: Descripción del grupo (máximo 2048 caracteres).
* `join_approval_mode` *(String, Opcional)*: Modo de aprobación para unirse:
  * `auto_approve` *(Por defecto)*: Los usuarios se unen inmediatamente al hacer clic en el enlace.
  * `approval_required`: Los administradores deben aprobar la solicitud de unión.

### Respuesta del Servidor (Síncrona)
Meta retornará de forma síncrona el identificador único del grupo creado:
```json
{
  "messaging_product": "whatsapp",
  "id": "Y2FwaV9ncm91cDoxOTUwNTU1MDA3OToxMjAzNjMzOTQzMjAdOTY0MTUZD"
}
```
*(Nota: El ID devuelto es un string base64 que identifica unívocamente al grupo dentro de tu WABA).*

---

## 2. ✉️ Enviar Plantilla con Invitación al Grupo

Para que los usuarios puedan unirse al grupo creado, Meta requiere que se les envíe una plantilla oficial de WhatsApp catalogada como **Utility** y precargada en la biblioteca de plantillas. No se permite invitar usuarios usando mensajes de texto libre fuera de la ventana de 24 horas.

### Solicitud de Envío de Invitación
* **Método:** `POST`
* **URL:** `https://graph.facebook.com/v22.0/<BUSINESS_PHONE_NUMBER_ID>/messages`
* **Cabeceras:**
  * `Authorization: Bearer <ACCESS_TOKEN>`
  * `Content-Type: application/json`

### Cuerpo de la Solicitud (Payload)
```json
{
  "messaging_product": "whatsapp",
  "to": "<USER_PHONE_NUMBER>",
  "type": "template",
  "template": {
    "name": "<TEMPLATE_NAME>",
    "language": {
      "code": "<TEMPLATE_LANGUAGE_CODE>"
    },
    "components": [
      {
        "type": "body",
        "parameters": [
          {
            "type": "group_id",
            "group_id": "Y2FwaV9ncm91cDoxOTUwNTU1MDA3OToxMjAzNjMzOTQzMjAdOTY0MTUZD"
          }
        ]
      }
    ]
  }
}
```

#### Parámetro Crítico del Componente:
* El parámetro del cuerpo de la plantilla debe llevar `"type": "group_id"` y el valor del `"group_id"` devuelto por el paso anterior. Meta generará y presentará dinámicamente el botón de unión en el dispositivo del usuario.

---

## 3. 💬 Enviar Mensajes a un Grupo de Meta

Una vez que los usuarios se han unido al grupo, la empresa puede enviar mensajes de texto, multimedia o plantillas al grupo utilizando el endpoint estándar de mensajes, variando el campo `recipient_type`.

### Solicitud de Mensaje de Grupo
* **Método:** `POST`
* **URL:** `https://graph.facebook.com/v22.0/<BUSINESS_PHONE_NUMBER_ID>/messages`
* **Cabeceras:**
  * `Authorization: Bearer <ACCESS_TOKEN>`
  * `Content-Type: application/json`

### Cuerpo de la Solicitud (Payload)
```json
{
  "messaging_product": "whatsapp",
  "recipient_type": "group",
  "to": "Y2FwaV9ncm91cDoxOTUwNTU1MDA3OToxMjAzNjMzOTQzMjAdOTY0MTUZD",
  "type": "text",
  "text": {
    "preview_url": true,
    "body": "Hola a todos, este es un reporte enviado automáticamente al grupo oficial de WhatsApp comercial 🚀"
  }
}
```

#### Diferencias clave con mensajes a contactos individuales:
1. **`recipient_type`**: Debe ser obligatoriamente `"group"`.
2. **`to`**: Debe contener el identificador en base64 del grupo (por ejemplo: `Y2FwaV9ncm91cDoxOTUwNTU1...`).
