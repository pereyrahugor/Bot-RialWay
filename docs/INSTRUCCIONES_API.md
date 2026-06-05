# Especificacion de API: WhatsApp Bulk Template Messaging (v1)

Esta documentacion describe la interfaz tecnica para la integracion de sistemas externos con el motor de envios masivos de WhatsApp de **Neurolinks**.

---

## <i class="fas fa-flask"></i> Parametros de Prueba en Vivo (Live Test)

Utiliza los siguientes parametros para realizar integraciones y pruebas reales en el entorno activo:

*   **URL Base:** `https://bot-rialway-monoagente-production-ab3b.up.railway.app`
*   **Token API (api_key):** `sk_rialway_e6b1e85a367e1b09553837630d1f31a3`
*   **ID de Plantilla (template_id):** `868223626279396`

---

## <i class="fas fa-file-lines"></i> Formato y Ejemplo de Plantilla de ReMarketing

La plantilla registrada en Meta para realizar pruebas y campanas de ReMarketing tiene el siguiente formato estructural:

```text
Hola {{nombre}} 👋👋

Este es un mensaje que simula el envio masivo.
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

### <i class="fas fa-clipboard-list"></i> Variables Requeridas para esta Plantilla:
1. `nombre`: El nombre o identificador personalizado del cliente.
2. `dato_variable`: Texto dinamico adicional (por ejemplo, link de pago, codigo de descuento o nota especial).

---

## <i class="fas fa-lock"></i> Esquema de Autenticacion y Seguridad

La API utiliza un protocolo de Handshake de dos pasos basado en tokens efimeros para mitigar ataques de replay y asegurar la integridad de las transacciones.

### 1. Handshake (Auth)
*   El cliente debe autenticarse utilizando su `api_key` de larga duracion para obtener un **One-Time Token (OTT)** temporal.
*   **TTL del Token:** 5 minutos.
*   **Uso Unico:** El token se invalida automaticamente tras la primera ejecucion exitosa o fallida del endpoint de envio.
*   **Defensa Activa:** Implementa Exponential Backoff por IP. Los fallos consecutivos incrementan el delay de respuesta (2^n segundos) hasta un maximo de 30s.

### 2. Rate Limiting y Throttling
*   **Payload Maximo:** 2,500 destinatarios por solicitud POST en un solo lote.
*   **Throttling de Salida:** 250ms de retraso automatico entre envios individuales para el estricto cumplimiento de las politicas de Anti-Spam de Meta Cloud API.

---

## <i class="fas fa-rocket"></i> Endpoints de la API

### 1. POST `/api/v1/auth`
Genera un token de acceso temporal (One-Time Token).

#### <i class="fas fa-arrow-down"></i> Headers:
```http
Content-Type: application/json
```

#### <i class="fas fa-arrow-down"></i> Cuerpo de la Peticion (Request Body):
```json
{
    "api_key": "sk_rialway_e6b1e85a367e1b09553837630d1f31a3"
}
```

#### <i class="fas fa-arrow-up"></i> Respuesta Exitosa (200 OK):
```json
{
    "success": true,
    "token": "7f82b1f86809c95...abc",
    "expires_in": "5 minutes"
}
```

#### <i class="fas fa-terminal"></i> Ejemplo de Peticion cURL:
```bash
curl -X POST https://bot-rialway-monoagente-production-ab3b.up.railway.app/api/v1/auth \
  -H "Content-Type: application/json" \
  -d '{"api_key": "sk_rialway_e6b1e85a367e1b09553837630d1f31a3"}'
```

---

### 2. POST `/api/v1/send-template`
Encola un lote de mensajes de plantilla para procesamiento y envio asincrono.

#### <i class="fas fa-arrow-down"></i> Cuerpo de la Peticion (Request Body):
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

#### <i class="fas fa-gear"></i> Validacion de Datos:
*   `data`: Array de destinatarios (Minimo 1, Maximo 2500 registros).
*   `phone`: Numero telefonico en formato internacional E.164 (codigo de pais + numero, sin el simbolo `+`).
*   `variables`: Objeto Key-Value dinamico. Las llaves (`nombre`, `dato_variable`) deben coincidir exactamente con los parametros definidos en la plantilla de Meta.

#### <i class="fas fa-arrow-up"></i> Codigos de Respuesta:
*   **`202 Accepted`**: El lote ha superado las validaciones de esquema y se ha inyectado con exito en la cola de procesamiento.
*   **`400 Bad Request`**: Discrepancia en las variables de la plantilla, ID de plantilla invalido o excedente del limite de 2,500 registros.
*   **`401 Unauthorized`**: Token temporal invalido, ya utilizado o expirado.

#### <i class="fas fa-terminal"></i> Ejemplo de Peticion cURL:
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
          "dato_variable": "Descarga tu orden aqui: https://neurolinks.com/descarga/456"
        }
      }
    ]
  }'
```

---

## <i class="fas fa-screwdriver-wrench"></i> Especificaciones Tecnicas y Observabilidad

### Resolucion de Atributos
El sistema realiza la resolucion automatica del mapeo de plantillas de Meta a traves del `template_id`:
*   **Namespace & Name:** Resuelve el nombre tecnico registrado de la plantilla.
*   **Language Policy:** Deteccion inteligente del idioma configurado en la cuenta comercial (`es_AR`, `en_US`, etc.).
*   **Component Mapping:** El motor asocia dinamicamente las variables declaradas directamente a los componentes visuales (`BODY`) de la plantilla.

### Observabilidad y Auditoria
Cada llamada a la API queda auditada de forma segura para monitoreo del rendimiento y trazabilidad:
*   `client_ip`: Direccion IP del emisor.
*   `latency`: Tiempo de procesamiento (ms).
*   `status_code`: Codigo HTTP de respuesta.
*   `error_trace`: Traza de error detallada en caso de fallos de validacion o autenticacion.

---

## <i class="fas fa-lightbulb"></i> Buenas Practicas para Desarrolladores

1. **Gestion de Sesion:** Implementa un flujo automatico de autenticacion que solicite un nuevo token por cada lote (`batch`) a procesar.
2. **Validacion Previa de Numeros:** Antes de realizar la peticion, comprueba que los numeros no contengan caracteres especiales como espacios, guiones o el signo `+`.
3. **Manejo de Errores con Backoff:** Ante fallos transitorios en el handshake (Auth), utiliza logica de reintentos con retraso exponencial para evitar suspensiones temporales de IP.
