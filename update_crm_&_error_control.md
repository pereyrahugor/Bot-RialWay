# Arquitectura y Desarrollo del Backoffice (CRM) y Control de Errores

Este documento detalla la creación arquitectónica completa del sistema de Backoffice (CRM) para el bot, la integración en tiempo real, así como las mejoras de alta disponibilidad (manejo de errores de red) y las arquitecturas multi-tenant (múltiples bots habitando la misma base de datos sin colisionar). Ha sido documentado de forma integral para que pueda ser leído por otros agentes u operadores técnicos que busquen replicar, mantener o escalar toda la plataforma.

## 1. Creación del Front-end visual del Backoffice (CRM)

### Estructura de Archivos
Se crearon las siguientes vistas dentro de `src/html/` y hojas de estilos en `src/style/`:
- **`src/html/dashboard.html`**: Actúa como una página principal de bienvenida. Expone un panel con accesos directos hacia el Estado del Sistema (`/health`), la ventana para escanear el QR y vincular WhatsApp Web (`/qr.png`), y el enlace frontal principal de acceso al Backoffice.
- **`src/html/login.html`**: Pantalla simple de autenticación que bloquea la lectura del Backoffice. Solicita la contraseña maestra de acceso (cuyo valor se nutre desde la variable `BACKOFFICE_TOKEN` dentro el `.env`). Si la clave ingresada hace "match" con la API Rest, la vista almacena un token (JWT-style local) en el `localStorage` del navegador y permite el ingreso.
- **`src/html/backoffice.html`**: La interfaz principal y consolidada del CRM. Una aplicación web Single Page (SPA). Estructuralmente, cuenta con:
  - **Sidebar izquierdo:** Carga una lista dinámica asíncrona poblada por todos los chats activos, ordenada globalmente a partir del campo `last_message_at`.
  - **Panel Principal Domiciliario:** Componente reactivo que tras cliquear en un contacto en el Sidebar, solicita el historial de la conversación. Cuenta además con un botón Toggle ("Atención Humana / Re-Activar Bot") el cual, gráficamente, interrumpe el asistente de IA para permitir comunicación manual y despliega un cuadro de Input (`chat-input`) para lanzar mensajes humanos hacia el WhatsApp del cliente en nombre del comercio.
- **`src/style/dashboard.css`**: Hoja de estilos compartida por las vistas, construida con diseño moderno en Dark Mode, sombras proyectadas y resaltado de hover amigables (flexbox y grid structure).

### Comunicación Reactiva y Estado en Tiempo Real (Socket.IO)

El sistema implementa una arquitectura de **re-transmisión de eventos** para garantizar que los operadores humanos vean los mensajes instantáneamente sin recargar el navegador.

1.  **Emisión Lógica (Backend - `HistoryHandler.ts`)**:
    *   Se utiliza un `EventEmitter` nativo de Node.js centralizado (`historyEvents`).
    *   Cada vez que se persiste un mensaje (`saveMessage`) o se cambia el estado del bot (`toggleBot`), el sistema emite un evento interno:
        ```typescript
        historyEvents.emit('new_message', { chatId, role, content, type });
        historyEvents.emit('bot_toggled', { chatId, bot_enabled: enabled });
        ```

2.  **Puente Socket.IO (Backend - `app.ts`)**:
    *   Se inicializa el servidor de WebSockets ligado al servidor HTTP principal (Polka/Express) mediante la función `initSocketIO`.
    *   El servidor de Sockets escucha los eventos internos del `historyEvents` y los re-emite globalmente a todos los clientes web conectados:
        ```typescript
        historyEvents.on('new_message', (payload) => {
            io.emit('new_message', payload);
        });
        ```

3.  **Recepción y Reactividad (Frontend - `backoffice.html`)**:
    *   Se inyecta el cliente desde el CDN: `https://cdn.socket.io/4.7.4/socket.io.min.js`.
    *   El cliente web se conecta al backend y reacciona a los eventos específicos:
        *   **`new_message`**: Si el `chatId` del payload coincide con el chat abierto en pantalla, ejecuta `fetchMessages()` para inyectar la burbuja de chat al instante. Simultáneamente actualiza la lista lateral (`fetchChats`) para reflejar el último mensaje.
        *   **`bot_toggled`**: Cambia visualmente el estado del interruptor (toggle) y los textos de "Bot Activo" / "Intervención Humana" sin intervención del usuario.
    *   **Visualización de Horarios (WhatsApp Style)**: Se implementó el formateo y visualización del horario de envío/recepción (`HH:MM`) debajo de cada mensaje en el Backoffice, emulando la interfaz de WhatsApp para una mejor referencia temporal por parte del operador.

4.  **Beneficios UI/UX**:
    *   Elimina la latencia en la atención al cliente.
    *   Mantiene la coherencia visual entre múltiples operadores que puedan estar viendo el mismo panel.
    *   Asegura que el historial de chat esté siempre sincronizado con los mensajes salientes de la IA y los entrantes del usuario WhatsApp.

---

## 2. Orquestación del Back-end del CRM (`src/app.ts`)

### Renderizado de Rutas Servidas y Escalabilidad "Marca Blanca"
- Para no depender de frameworks frontend pesados, se diseñó la función procedimental **`serveHtmlPage`** en el core del nodo (`app.ts`). Ella asume el control del pipeline express / polka sirviendo páginas estáticas (archivos `.html`).
### Inyección Dinámica e Identidad Visual (`sidebar-header`)
- Para facilitar la navegación multicuenta, el servidor personaliza el HTML antes de enviarlo al cliente sin modificar el archivo físico en disco.
- **Estructura en el HTML (`src/html/backoffice.html`)**: El Sidebar posee un contenedor de cabecera estático donde reside el título principal:
  ```html
  <div class="sidebar-header">
      <h2 style="margin:0; font-size: 1.2rem;">Backoffice</h2>
      <button onclick="logout()" ...>Salir</button>
  </div>
  ```
- **Lógica de Transformación Dinámica (`src/app.ts`)**: Dentro de `serveHtmlPage`, el sistema intercepta la petición y utiliza el nombre configurado en el entorno (`ASSISTANT_NAME`) para sobreescribir tanto la pestaña del navegador como la cabecera visible:
  ```typescript
  if (filename === 'backoffice.html') {
      htmlContent = htmlContent.replace(
          '<h2 style="margin:0; font-size: 1.2rem;">Backoffice</h2>',
          `<h2 style="margin:0; font-size: 1.2rem;">Backoffice - ${botName}</h2>`
      );
  }
  ```
- **Resultado Estético**: Al cargar la página, el usuario ve instantáneamente **"Backoffice - [Nombre del Cliente]"**, permitiendo identificar de qué bot es cada panel de control de forma inequívoca en entornos de trabajo con múltiples pestañas abiertas.

### API Middleware de Seguridad
- Se desarrolló el validador `backofficeAuth(req, res, next)`. Protege cualquier sub-ruta privada que transite bajo el path de `/api/backoffice/*`. Verificando si existe la coincidencia de texto en la variable HTTP "Authorization" de `token=X_pass` antes de darle paso. Devolverá de lo contrario `HTTP_401`.

### API Rest Privadas del CRM (Rutas Disponibles Desarrolladas)
1. **`GET /api/backoffice/chats`**: Se apoya en el manejador local `HistoryHandler.listChats()` exportando al navegador la tupla o `Array<Objects>` de todos los teléfonos que hablaron con el bot y sus respectivos punteros de estatus de intervención.
2. **`GET /api/backoffice/messages/:chatId`**: Devuelve ordenadamente (ASC) la cascada cronológica de todo el historial de Base de datos filtrado bajo un ID telefónico.
3. **`GET /api/backoffice/profile-pic/:chatId`**: Extrae localmente y retorna directamente (incluso asíncronamente si demora resoluciones pesadas de imagen proxying) el archivo de imagen original de WhatsApp de un cliente empleando la integración base del core Baileys: `provider.vendor.profilePictureUrl`.
4. **`POST /api/backoffice/toggle-bot`**: Al activarse actualiza vía Backend el flag de corte, detiene los flujos de OpenAi para un chatId dado y almacena en base de datos al estado `bot_enabled: false/true`. Luego empuja al Eventos interno para reescribir variables en cachés paralelos si exisitieran con el evento `historyEvents.emit`.
5. **`POST /api/backoffice/send-message`**: Capta el string tipiado por el agente humano, ensambla y le da formateo final para Baileys transformando a jids (`XXXX@s.whatsapp.net`), y comanda nativamente vía `provider.sendMessage`. El mensaje interceptor es además volcado a DataBase local pero con el rol marcado estáticamente hacia un contexto superior `'assistant'` sin ensuciar la cadena central.

---

## 3. Arquitectura Global Escalable de Persistencia (Multi-tenant Supabase)

### Aislamiento Lógico (`HistoryHandler.ts`)
- Las interacciones a `Supabase` fueron arquitectónicamente construidas sobre un esquema que escala "Multi-Agencia" o Base De Datos agnóstica a partir de una única columna pivote llamada `project_id`.
- Todas y cada una de las queries (para grabar historiales, para pedir listas y para alternar cortes) imponen por detrás en código TypeScript que la tabla haga target local estricto a través de la constante en entorno:
  ```typescript
  const PROJECT_ID = process.env.RAILWAY_PROJECT_ID || "default_project";
  ```
- **Virtualización:** Gracias a ello, múltiples clones del Repositorio de código corriendo en entornos simultáneos sobre la misma nube, no exigen clonar ni recrear tablas. Crean de forma virtual una burbuja hermética aislada para cada container por separado garantizando que ningún Chat se entere de los contactos paralelos del cliente de otro local comercial, ya que todas las interacciones envían implícitamente `.eq('project_id', PROJECT_ID)` limitando el Scope entero.
- **Escape Mecánico / Intervención Remota**: El `app.ts` y su bloque maestro de `processUserMessage` están programados con directivas duras `startsWith('#ON#')` o `(#GLOBAL_ON#)`. Por si un número telefónico entra en bucles inmortales de intervenciones pausadas u ocurran caías de red perdiendo su acceso Web al Backoffice, el cliente de WhatsApp es amo supremo; si escribe dicho atajo el backend auto-conmuta su valor a `bot_enabled = true` para volver a integrar las respuestas IA en cualquier contexto.

---

## 4. Estabilidad Estructural IA y Blindaje contra Fugas

### A. Absorción Exponencial de Saturación a API Externa OpenAI (`safeToAsk`)
- Para evitar interrupciones drásticas u overloads en los picos de volumen con mensajes OpenAI en masa (generando un Timeout Timeout genérico o intercepciones 500 error por cortes globales del host):
  La promesa vital conectora (`toAsk`) fue englobada bajo una membrana arquitectónica asíncrónica tolerante a fallas en forma del wrapper `export const safeToAsk`.
- Dispone de un mecanismo de **Backoff Loop:** Genera un iterador limitador (3 intentos por defecto). Atrapa las excepciones con el handler maestro de Node. Si este falla frente a un Thread ID "Active Run", el bot demorará proactivamente antes de forzar su intento siguiente de manera linealmente escalada: `setTimeout(r, attempt * 2000)`. Si fracasa la 1r vez, espera 2 segundos y cruza los dedos. Si falla la 2d, espera 4 segundos, luego 6. Recién al colapsar el máximo de cuota aborta definitivamente, impidiendo que el Bot principal se congele, crashee masivamente, se quede reiniciando eternamente u olvidándose hilos.

### B. Parser Estricto Regex contra Fugas Analíticas JSON
- Una vulnerabilidad observada de las Respuestas IA, ante sobrecargas o falta tokens, era vomitar sus "respuestas en bruto" hacia la interacción externa del consumidor por accidente de la forma `[SYSTEM_DB_RESULT: {...]}` o `[SYSTEM_API_RESULT]`.
- Se corrigieron profundamente estos baches inyectando sanitizadores duros (`limpiarBloquesJSON` dentro del `AssistantResponseProcessor.ts`).
- La Regex ahora busca de forma salvaje e independiente `/\[?\s*SYSTEM_(DB|API)_RESULT[\s\S]*?(?:\]|$)/gi` que en vez de requerir sintaxis de formateos sanos, se engulle incluso arrays que hayan quedado cortados o colgados al vacío hasta chocar contra una llave final real o con el borde absoluto de final de cadena, extrayendo enteramente esa alucinación de tokens o información interna hacia ninguna parte logrando devolverle a WhatsApp exclusicamente la oración natural sana original que contenía la AI con el saludo real.
