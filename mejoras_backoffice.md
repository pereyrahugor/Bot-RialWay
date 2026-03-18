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

- **Código del Worker (en `app.ts`):**
```typescript
setInterval(async () => {
    try {
        const { data: chats } = await supabase
            .from('chats')
            .select('*')
            .eq('project_id', PROJECT_ID)
            .eq('bot_enabled', false);

        const now = new Date();
        for (const chat of chats || []) {
            if (chat.last_human_message_at) {
                const lastHuman = new Date(chat.last_human_message_at);
                const diffMin = (now.getTime() - lastHuman.getTime()) / 60000;
                
                if (diffMin >= 15) {
                    console.log(`🕒 [Worker] Reactivando bot para ${chat.id} (${Math.round(diffMin)} min inactivo)`);
                    await HistoryHandler.toggleBot(chat.id, true);
                }
            }
        }
    } catch (e) {
        console.error('[Worker] Error:', e);
    }
}, 60000);
```

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
- **Código del middleware corregido (con soporte para Polka):**
```typescript
const backofficeAuth = (req, res, next) => {
    // En Polka req.query puede ser undefined, parseamos manualmente si es necesario
    if (!req.query && req.url.includes('?')) {
        try {
            const url = new URL(req.url, 'http://localhost');
            const qry: any = {};
            url.searchParams.forEach((v, k) => qry[k] = v);
            req.query = qry;
        } catch (e) { req.query = {}; }
    }

    let token = req.headers['authorization'] || (req.query && (req.query as any).token) || '';
    if (typeof token === 'string') {
        if (token.startsWith('token=')) token = token.slice(6);
        else if (token.startsWith('Bearer ')) token = token.slice(7);
    }
    const expectedToken = process.env.BACKOFFICE_TOKEN;
    if (token && token === expectedToken) {
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

## 10. Robustez en Envío de Mensajes
- Se mejoró el endpoint `/api/backoffice/send-message` para verificar que el proveedor tiene el `vendor` listo antes de intentar enviar.
- Se implementó un fallback: si `sendMessage` no existe o falla para texto, intenta usar `sendText`.
- Se agregaron logs detallados en el backend para trazar intentos de envío y errores.
- Se agregó un estado de carga (loading) en el botón de envío del frontend para mejorar el feedback al usuario.
- Se incluyó manejo de errores de red y de servidor con alertas descriptivas.

- **Código del envío mejorado (en `app.ts`):**
```typescript
app.post('/api/backoffice/send-message', upload.single('file'), backofficeAuth, async (req, res) => {
    try {
        const { chatId, message } = req.body;
        const file = req.file;

        if (!adapterProvider || !adapterProvider.vendor) {
            return res.status(503).json({ success: false, error: 'WhatsApp provider not connected' });
        }

        const jid = chatId.includes('@') ? chatId : `${chatId}@s.whatsapp.net`;
        
        if (file) {
            await adapterProvider.sendMessage(jid, message || '', { media: file.path });
        } else {
            if (typeof adapterProvider.sendMessage === 'function') {
                await adapterProvider.sendMessage(jid, message, {});
            } else if (typeof (adapterProvider as any).sendText === 'function') {
                await (adapterProvider as any).sendText(jid, message);
            }
        }
        // ... persistencia e inyección en thread ...
        res.json({ success: true });
    } catch (err) {
        res.status(500).json({ success: false, error: err.message });
    }
});
```

## Requisitos Técnicos
- Base de datos: Tablas `tags` y `chat_tags` en Supabase. Columna `last_human_message_at` en `chats`. Campo `thread_id` dentro de `chats.metadata` (JSONB).
- Backend: `multer` para subida de archivos, nuevas rutas de API para tags, worker de inactividad, y middleware de auth con parseo manual de query para Polka y prefijo `token=`.
- Frontend: JavaScript nativo con Socket.IO para actualizaciones en tiempo real, CSS Variables y Flexbox/Grid para el layout fluido.
- OpenAI: Uso de `openai.beta.threads.messages.create()` sin `runs.create()` para inyectar mensajes al thread sin generar respuesta del asistente.
- Proveedores: Compatibilidad verificada con `builderbot-provider-sherpa` y `BaileysProvider`.
