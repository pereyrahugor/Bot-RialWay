# 🧠 Assistant Processor

El `AssistantResponseProcessor` es el cerebro lógico del bot. Se encarga de analizar las respuestas crudas de OpenAI y determinar qué acciones físicas debe realizar el bot.

## 🔗 Funciones Principales

### `analizarYProcesarRespuestaAsistente`
Esta función procesa el string de respuesta de OpenAI y busca patrones o comandos incrustados.

#### Capacidades:
1. **Detección de Consultas a BD**: Si la respuesta contiene disparadores para consultas (ej: `DB_QUERY`), el procesador ejecuta la lógica correspondiente en PostgreSQL/Supabase.
2. **Envío de Archivos**: Si el asistente sugiere enviar un PDF o Imagen, el procesador localiza el recurso y lo envía vía WhatsApp.
3. **Limpieza de Texto**: Remueve anotaciones técnicas o metadatos de la respuesta final que llega al usuario.
4. **Manejo de Estados**: Actualiza variables en el `state` del bot basadas en la conversación.

## 🛠 Lógica de Inyección de Run
Utiliza `waitForActiveRuns` para asegurar que OpenAI haya terminado de procesar todas las tareas secundarias antes de continuar con la siguiente interacción del usuario.

---

## 🔗 Enlaces Cruzados
- [Información del Asistente](../api/assistant.md)
- [Database Integration](./database.md)
