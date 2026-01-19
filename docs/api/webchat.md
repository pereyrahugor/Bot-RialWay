# 💬 WebChat

El sistema incluye una interfaz de chat web que permite interactuar con el mismo asistente de OpenAI utilizado en WhatsApp, ideal para pruebas o atención directa desde un sitio web.

## 🔗 Endpoints

### Interfaz de WebChat
- **Ruta**: `/webchat`
- **Descripción**: Carga la interfaz visual (HTML/JS) para chatear con el bot.

### API de Mensajería WebChat
Procesa los mensajes enviados desde la interfaz web.

- **Método**: `POST`
- **Ruta**: `/webchat-api`

#### Parámetros de Entrada (Body)
| Parámetro | Tipo | Descripción | Requerido |
| :--- | :--- | :--- | :--- |
| `message` | String | El texto enviado por el usuario. | Sí |

#### Ejemplo de Request
```json
{
  "message": "Hola, ¿cuáles son los servicios disponibles?"
}
```

#### Respuesta (200 OK)
```json
{
  "reply": "Hola! Contamos con servicios de logística, ventas y soporte técnico 24/7. ¿En qué te puedo ayudar hoy?"
}
```

#### Notas especiales
- **Reset**: Si el mensaje enviado es `#reset`, el sistema eliminará el hilo (thread) actual de OpenAI y reiniciará la conversación.
- **Persistencia**: El hilo se mantiene basado en la IP del usuario o session ID manejado por el `WebChatManager`.

---

## 🔌 Socket.IO (Tiempo Real)
El bot también inicia un servidor de Socket.IO que escucha en el mismo puerto para una comunicación bidireccional más fluida en la web.

- **Evento**: `message` (C2S)
- **Evento**: `reply` (S2C)

---

## 🔗 Enlaces Cruzados
- [Información del Asistente](./assistant.md)
- [Assistant Processor](../modulos/assistant-processor.md)
