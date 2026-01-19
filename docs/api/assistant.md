# 🤖 Información del Asistente

Acceso a detalles básicos de la inteligencia que maneja el bot.

## 🔗 Endpoints

### Obtener Nombre Comercial
Útil para la marca del bot en interfaces web.

- **Método**: `GET`
- **Ruta**: `/api/assistant-name`

#### Respuesta (200 OK)
```json
{
  "name": "Test Dev"
}
```

---

## 🛠 Funcionamiento con OpenAI
El bot utiliza el modelo de **OpenAI Assistants**. Esto significa que:
1. El Assistant mantiene su propio historial y contexto.
2. Posee acceso a **File Search** (Vector Stores) si están configurados en el panel de OpenAI.
3. El ID del asistente se configura vía `ASSISTANT_ID`.

### Hilos (Threads)
- En **WhatsApp**: El bot crea un hilo por cada número de teléfono para mantener la persistencia entre mensajes.
- En **WebChat**: Se maneja una lógica similar basada en IP o sesión web.

---

## 🔗 Enlaces Cruzados
- [Assistant Processor](../modulos/assistant-processor.md)
- [WebChat](./webchat.md)
