# Especificación de API: WhatsApp Bulk Template Messaging (v1)

Esta documentación describe la interfaz técnica para la integración de sistemas externos con el motor de envíos masivos de WhatsApp de **Neurolinks**.

---

## 🧪 Parámetros de Prueba en Vivo (Live Test)

Utiliza los siguientes parámetros para realizar integraciones y pruebas reales en el entorno activo:

*   **URL Base:** `https://bot-rialway-monoagente-production-ab3b.up.railway.app`
*   **Token API (api_key):** `sk_rialway_e6b1e85a367e1b09553837630d1f31a3`
*   **ID de Plantilla (template_id):** `868223626279396`

---

## 📝 Formato y Ejemplo de Plantilla de ReMarketing

La plantilla registrada en Meta para realizar pruebas y campañas de ReMarketing tiene el siguiente formato estructural:

```text
Hola {{nombre}} 👋👋

Este es un mensaje que simula el envío masivo.
los pasos son:
1️⃣ armamos la plantilla y se envia aprobar por meta
2️⃣ determinamos a quien vamos a enviar la plantilla (a que clientes)
3️⃣ selecionamos la plantilla aprobada
4️⃣ sellecionamos a quien enviar 
▶️ y enviamos .

hacer ReMarketing es simple.
podemos enviar imagenes, videos, links de descarga, confirmaciones de turnos, listas de precios, etc, etc.

tambien agregar  👉 {{dato_variable}} 

Saludos Neurolinks
```

### 📋 Variables Requeridas para esta Plantilla:
1. `nombre`: El nombre o identificador personalizado del cliente.
2. `dato_variable`: Texto dinámico adicional (por ejemplo, link de pago, código de descuento o nota especial).

---

## 🔐 Esquema de Autenticación y Seguridad

La API utiliza un protocolo de Handshake de dos pasos basado en tokens efímeros para mitigar ataques de replay y asegurar la integridad de las transacciones.

### 1. Handshake (Auth)
*   El cliente debe autenticarse utilizando su `api_key` de larga duración para obtener un **One-Time Token (OTT)** temporal.
*   **TTL del Token:** 5 minutos.
*   **Uso Único:** El token se invalida automáticamente tras la primera ejecución exitosa o fallida del endpoint de envío.
*   **Defensa Activa:** Implementa Exponential Backoff por IP. Los fallos consecutivos incrementan el delay de respuesta (2^n segundos) hasta un máximo de 30s.

### 2. Rate Limiting y Throttling
*   **Payload Máximo:** 2,500 destinatarios por solicitud POST en un solo lote.
*   **Throttling de Salida:** 250ms de retraso automático entre envíos individuales para el estricto cumplimiento de las políticas de Anti-Spam de Meta Cloud API.

---

## 🚀 Endpoints de la API

### 1. POST `/api/v1/auth`
Genera un token de acceso temporal (One-Time Token).

#### 📥 Headers:
```http
Content-Type: application/json
```

#### 📥 Cuerpo de la Petición (Request Body):
```json
{
    "api_key": "sk_rialway_e6b1e85a367e1b09553837630d1f31a3"
}
```

#### 📤 Respuesta Exitosa (200 OK):
```json
{
    "success": true,
    "token": "7f82b1f86809c95...abc",
    "expires_in": "5 minutes"
}
```

#### 💻 Ejemplo de Petición cURL:
```bash
curl -X POST https://bot-rialway-monoagente-production-ab3b.up.railway.app/api/v1/auth \
  -H "Content-Type: application/json" \
  -d '{"api_key": "sk_rialway_e6b1e85a367e1b09553837630d1f31a3"}'
```

---

### 2. POST `/api/v1/send-template`
Encola un lote de mensajes de plantilla para procesamiento y envío asíncrono.

#### 📥 Cuerpo de la Petición (Request Body):
```json
{
    "token": "TOKEN_TEMPORAL_OBTENIDO_EN_AUTH",
    "template_id": "868223626279396",
    "data": [
        {
            "phone": "5491122334455",
            "variables": {
                "nombre": "Hugo",
                "dato_variable": "https://neurolinks.com/pago/123"
            }
        }
    ]
}
```

#### ⚙️ Validación de Datos:
*   `data`: Array de destinatarios (Mínimo 1, Máximo 2500 registros).
*   `phone`: Número telefónico en formato internacional E.164 (código de país + número, sin el símbolo `+`).
*   `variables`: Objeto Key-Value dinámico. Las llaves (`nombre`, `dato_variable`) deben coincidir exactamente con los parámetros definidos en la plantilla de Meta.

#### 📤 Códigos de Respuesta:
*   **`202 Accepted`**: El lote ha superado las validaciones de esquema y se ha inyectado con éxito en la cola de procesamiento.
*   **`400 Bad Request`**: Discrepancia en las variables de la plantilla, ID de plantilla inválido o excedente del límite de 2,500 registros.
*   **`401 Unauthorized`**: Token temporal inválido, ya utilizado o expirado.

#### 💻 Ejemplo de Petición cURL:
```bash
curl -X POST https://bot-rialway-monoagente-production-ab3b.up.railway.app/api/v1/send-template \
  -H "Content-Type: application/json" \
  -d '{
    "token": "TU_TOKEN_TEMPORAL",
    "template_id": "868223626279396",
    "data": [
      {
        "phone": "5491122334455",
        "variables": {
          "nombre": "Hugo",
          "dato_variable": "Descarga tu orden aquí: https://neurolinks.com/descarga/456"
        }
      }
    ]
  }'
```

---

## 🛠️ Especificaciones Técnicas y Observabilidad

### Resolución de Atributos
El sistema realiza la resolución automática del mapeo de plantillas de Meta a través del `template_id`:
*   **Namespace & Name:** Resuelve el nombre técnico registrado de la plantilla.
*   **Language Policy:** Detección inteligente del idioma configurado en la cuenta comercial (`es_AR`, `en_US`, etc.).
*   **Component Mapping:** El motor asocia dinámicamente las variables declaradas directamente a los componentes visuales (`BODY`) de la plantilla.

### Observabilidad y Auditoría
Cada llamada a la API queda auditada de forma segura para monitoreo del rendimiento y trazabilidad:
*   `client_ip`: Dirección IP del emisor.
*   `latency`: Tiempo de procesamiento (ms).
*   `status_code`: Código HTTP de respuesta.
*   `error_trace`: Traza de error detallada en caso de fallos de validación o autenticación.

---

## 💡 Buenas Prácticas para Desarrolladores

1. **Gestión de Sesión:** Implementa un flujo automático de autenticación que solicite un nuevo token por cada lote (`batch`) a procesar.
2. **Validación Previa de Números:** Antes de realizar la petición, comprueba que los números no contengan caracteres especiales como espacios, guiones o el signo `+`.
3. **Manejo de Errores con Backoff:** Ante fallos transitorios en el handshake (Auth), utiliza lógica de reintentos con retraso exponencial para evitar suspensiones temporales de IP.
