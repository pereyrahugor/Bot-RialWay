# Mejoras Backoffice - Bot-ApiSWS

## 1. Visualización de Contacto
- El número de teléfono se muestra como dato principal en la lista de chats y en la cabecera.
- El nombre del cliente se muestra opcionalmente debajo (si está disponible).
- Se agregó el estado '🤖 Bot' / '👤 Humano' debajo del nombre.

## 2. Marcadores de Fecha
- Se implementaron separadores de fecha (estilo WhatsApp) dentro del historial de mensajes para distinguir entre días.

## 3. Gestión de Etiquetas (Tags)
- Se implementó un sistema de etiquetas con nombre y color.
- Las etiquetas se guardan en la base de datos (Supabase) y son específicas por bot (vía `project_id`).
- Interfaz para crear, editar y eliminar etiquetas.
- Posibilidad de asignar múltiples etiquetas a cada chat.
- Las etiquetas asignadas son visibles en la cabecera del chat y en la lista lateral.

## 4. Mensajería Multimedia
- Soporte para enviar imágenes y otros archivos cuando hay intervención humana.
- Botón de adjunto (📎) integrado en el área de entrada.
- Los mensajes multimedia se guardan en el historial.

## 5. Buscador y Filtros
- Buscador por número de teléfono o nombre en la lista de chats.
- Filtro por etiquetas para segmentar chats rápidamente.

## 6. Retorno Automático a Modo Bot
- Implementación de un worker en el backend que revisa la inactividad humana.
- Si pasan 15 minutos sin que un humano envíe mensajes en un chat con intervención activa, el bot se reactiva automáticamente.
- El worker revisa cada minuto.
- Enviar un mensaje desde el backoffice actualiza el timestamp de "última actividad humana" para reiniciar el contador de 15 minutos.

## 7. Diseño Visual (WhatsApp Web Estética)
- Rediseño completo inspirado en WhatsApp Web Dark Mode.
- **Paleta de Colores**: Uso de variables CSS para consistencia (Sidebar: `#111b21`, Chat: `#0b141a`, Burbujas: `#005c4b` y `#202c33`).
- **Burbujas de Mensaje**: Implementación de "colas" (tails) en las burbujas mediante pseudo-elementos (`::before`).
- **Layout**: Estructura de tres secciones (Sidebar, Chat content, Tag manager) con scrollbars personalizados.
- **Multimedia**: Previsualización de imágenes y videos directamente en las burbujas de chat.
- **Avatar**: Visualización de fotos de perfil (vía proxy de API) con iniciales de respaldo.

## 8. Autenticación del Backoffice (Fix)
- El middleware `backofficeAuth` debe parsear correctamente el header `Authorization` en los siguientes formatos:
  - `token=VALUE` → extraer `VALUE`
  - `Bearer VALUE` → extraer `VALUE`
  - `VALUE` directo → usar tal cual
- Sin este fix, las rutas POST/PUT/DELETE del backoffice fallan con 401 porque el frontend envía `Authorization: token=XXX` pero el middleware comparaba el header crudo contra `BACKOFFICE_TOKEN`.
- **Código del middleware corregido:**
```typescript
const backofficeAuth = (req, res, next) => {
    let token = req.headers['authorization'] || req.query.token || '';
    if (typeof token === 'string') {
        if (token.startsWith('token=')) token = token.slice(6);
        else if (token.startsWith('Bearer ')) token = token.slice(7);
    }
    const expectedToken = process.env.BACKOFFICE_TOKEN;
    if (token === expectedToken) {
        return next();
    }
    res.status(401).json({ success: false, error: "Unauthorized" });
};
```

## 9. Contexto Global del Asistente durante Intervención Humana
- **Problema**: Cuando el bot se desactivaba para intervención humana, los mensajes intercambiados entre el operador y el usuario NO llegaban al thread de OpenAI. Al reactivar el bot, el asistente perdía el contexto de lo que se habló durante la intervención.
- **Solución**: Inyectar los mensajes al thread de OpenAI sin crear un `run` (así el asistente no responde pero mantiene el historial completo).

### 9.1 Persistencia del `thread_id` en Supabase
- Se agregaron dos métodos a `HistoryHandler`:
  - `saveThreadId(chatId, threadId)` — guarda el `thread_id` en `chats.metadata` (JSONB)
  - `getThreadId(chatId)` — lee el `thread_id` del `chats.metadata`
- En `processUserMessage`, después de obtener la respuesta del asistente, se persiste el `thread_id` actual:
```typescript
const currentThreadId = state && typeof state.get === 'function' ? state.get('thread_id') : null;
if (currentThreadId && ctx.from) {
    await HistoryHandler.saveThreadId(ctx.from, currentThreadId);
}
```

### 9.2 Inyección de mensajes del usuario (cuando bot está desactivado)
- En `processUserMessage`, cuando `isBotActiveForUser === false`, se inyecta el mensaje al thread:
```typescript
if (!isBotActiveForUser) {
    try {
        const threadId = await HistoryHandler.getThreadId(ctx.from);
        if (threadId) {
            await openaiMain.beta.threads.messages.create(threadId, {
                role: 'user',
                content: body || '[Media]'
            });
        }
    } catch (e) { /* no-op */ }
    return state;
}
```

### 9.3 Inyección de mensajes del operador (desde backoffice)
- En el endpoint `/api/backoffice/send-message`, después de guardar en historial, se inyecta al thread:
```typescript
const threadId = await HistoryHandler.getThreadId(chatId);
if (threadId && message) {
    await openaiMain.beta.threads.messages.create(threadId, {
        role: 'assistant',
        content: `[Mensaje enviado por operador humano]: ${message}`
    });
}
```
- Se usa `role: 'assistant'` porque es un mensaje enviado "desde el lado del bot" al usuario.
- El prefijo `[Mensaje enviado por operador humano]` ayuda al asistente a distinguir entre sus propias respuestas y las del operador.

### 9.4 Flujo completo
```
Bot Activo → processUserMessage → OpenAI run → guarda thread_id en Supabase
       ↓ (operador desactiva bot)
Intervención Humana:
  - Usuario envía mensaje → guarda historial + inyecta al thread (role: user, SIN run)
  - Operador envía desde backoffice → envía WA + guarda historial + inyecta al thread (role: assistant, SIN run)
       ↓ (bot se reactiva)
Bot Activo → el asistente VE todo lo que se habló y continúa con contexto completo
```

## Requisitos Técnicos
- Base de datos: Tablas `tags` y `chat_tags` en Supabase. Columna `last_human_message_at` en `chats`. Campo `thread_id` dentro de `chats.metadata` (JSONB).
- Backend: `multer` para subida de archivos, nuevas rutas de API para tags, worker de inactividad, y middleware de auth con parseo de prefijo `token=`.
- Frontend: JavaScript nativo con Socket.IO para actualizaciones en tiempo real, CSS Variables y Flexbox/Grid para el layout fluido.
- OpenAI: Uso de `openai.beta.threads.messages.create()` sin `runs.create()` para inyectar mensajes al thread sin generar respuesta del asistente.
