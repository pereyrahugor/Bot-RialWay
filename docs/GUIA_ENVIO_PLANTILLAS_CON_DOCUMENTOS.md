# Guía Fácil: Envío de Mensajes de WhatsApp con Documentos Adjuntos

Esta guía explica paso a paso cómo conectar tu sistema para enviar mensajes automáticos de WhatsApp con un archivo adjunto (como facturas en PDF, presupuestos, recibos o catálogos) a través de nuestra API, **de forma simple y sin complicaciones técnicas**.

---

## 📌 ¿Cómo funciona?

El proceso se hace en **2 pasos muy simples**:

1. **Paso 1:** Tu sistema pide una "clave temporal" (token de seguridad) usando tu API Key.
2. **Paso 2:** Tu sistema envía el mensaje indicando a qué teléfono va, qué datos completan el texto y qué documento debe acompañar el mensaje.

---

## Paso 1: Pedir la Clave Temporal de Envío

Antes de enviar el mensaje, tu sistema solicita un pase temporal válido por 5 minutos.

* **Dirección (URL):**
  `https://bot-rialway-monoagente-production-ab3b.up.railway.app/api/v1/auth`
* **Método:** `POST`
* **Formato:** JSON

### ¿Qué datos envías?
```json
{
  "api_key": "sk_rialway_e6b1e85a367e1b09553837630d1f31a3"
}
```

### ¿Qué recibes de vuelta?
```json
{
  "success": true,
  "token": "974f11b4069943691779cf6bb2d24fe1f9afca8c25568f3f95ef2ff1d3089a9d",
  "expires_in": "5 minutes"
}
```
> Copias el valor de `"token"` para usarlo en el siguiente paso.

---

## Paso 2: Enviar el Mensaje con el Documento

Ahora envías los datos del destinatario junto con el archivo.

* **Dirección (URL):**
  `https://bot-rialway-monoagente-production-ab3b.up.railway.app/api/v1/send-template`
* **Método:** `POST`
* **Formato:** JSON

Tienes **2 formas fáciles** de adjuntar el archivo:

---

### Opción A: Mediante un Enlace de Internet (La más sencilla)
Si tu sistema ya guarda los archivos en un servidor web, Google Drive (público), AWS o en tu propia nube y tienes el link directo de descarga:

```json
{
  "token": "EL_TOKEN_DEL_PASO_1",
  "template_id": "1116826217704046",
  "document": {
    "filename": "Factura_001.pdf",
    "link": "https://tusitio.com/comprobantes/factura_001.pdf"
  },
  "data": [
    {
      "phone": "5491130792789",
      "variables": {
        "razon_social": "DE BOEUF",
        "cuerpo": "Envío Comprobante"
      }
    }
  ]
}
```

---

### Opción B: Adjuntando el Archivo Directamente (Base64)
Si tu sistema genera el archivo al instante (por ejemplo, una factura recién creada) y no está subido a ninguna web, puedes enviarlo directamente convertido a texto (formato Base64):

```json
{
  "token": "EL_TOKEN_DEL_PASO_1",
  "template_id": "1116826217704046",
  "document": {
    "filename": "Factura_001.pdf",
    "base64": "JVBERi0xLjQKJcTl8uXrp/Og0MT...[AQUÍ_VA_TODO_EL_ARCHIVO_EN_BASE64]..."
  },
  "data": [
    {
      "phone": "5491130792789",
      "variables": {
        "razon_social": "DE BOEUF",
        "cuerpo": "Envío Comprobante"
      }
    }
  ]
}
```

---

## 🎯 ¿Qué significa cada campo? (Glosario sin tecnicismos)

| Campo | ¿Qué debes poner? | Ejemplo |
| :--- | :--- | :--- |
| **`token`** | El permiso que te dio el Paso 1. | `"4f52f5af2e..."` |
| **`template_id`** | El número de identificación de la plantilla aprobada en WhatsApp. | `"1116826217704046"` |
| **`document`** | El archivo que vas a enviar. Puede llevar un `"link"` (enlace web) o un `"base64"` (el archivo adentro). | Objeto con filename y link/base64 |
| **`filename`** | El nombre con el que el cliente verá el archivo en su WhatsApp. | `"Factura_Marzo.pdf"` |
| **`phone`** | El número de WhatsApp del cliente con código de país y área (sin signos `+`, guiones ni espacios). | `"5491130792789"` |
| **`variables`** | Los textos que se completan automáticamente dentro del mensaje. | `"razon_social": "Juan Pérez"` |

---

## 👥 ¿Y si quiero enviar a muchas personas con un archivo distinto para cada una?

Si estás haciendo un envío masivo donde **cada cliente debe recibir su propia factura o recibo diferente**, simplemente colocas el documento dentro de cada persona en la lista `data`:

```json
{
  "token": "EL_TOKEN_DEL_PASO_1",
  "template_id": "1116826217704046",
  "data": [
    {
      "phone": "5491130792789",
      "document": {
        "filename": "Factura_Cliente_A.pdf",
        "link": "https://tusitio.com/facturas/factura_A.pdf"
      },
      "variables": {
        "razon_social": "Empresa Alfa",
        "cuerpo": "Factura mensual"
      }
    },
    {
      "phone": "5491149379809",
      "document": {
        "filename": "Factura_Cliente_B.pdf",
        "link": "https://tusitio.com/facturas/factura_B.pdf"
      },
      "variables": {
        "razon_social": "Empresa Beta",
        "cuerpo": "Liquidación de servicios"
      }
    }
  ]
}
```

---

## ✅ ¿Cómo sé si el mensaje se envió bien?

Cuando todo está correcto, el servidor te contestará inmediatamente con un código **200 OK** y un mensaje como este:

```json
{
  "success": true,
  "message": "Mensaje enviado con éxito",
  "message_id": "wamid.HBgNNTQ5MTEzMDc5Mjc4ORUCABEYFENFNjcwQjkxM0U5NTI0RDFDMjZEAA==",
  "template": "ejemple_pdf_con_2_variables"
}
```

* `message_id`: Es el número de comprobante oficial que WhatsApp le asignó al mensaje.
* El mensaje y el archivo quedarán registrados automáticamente en el historial del chat dentro del CRM para que tu equipo de soporte o ventas pueda verlo.

---

## ❓ Preguntas Frecuentes

* **¿Qué tipos de archivos puedo enviar?**
  Puedes enviar documentos PDF (`.pdf`), imágenes (`.jpg`, `.png`), hojas de cálculo (`.xlsx`) y videos (`.mp4`).
* **¿Cuál es el tamaño máximo de archivo soportado?**
  Hasta 50 MB por archivo.
* **¿Cuántas personas puedo incluir en un solo envío masivo?**
  Puedes enviar hasta 2.500 contactos en una misma petición. El sistema los irá despachando ordenadamente respetando los tiempos de entrega de WhatsApp.
