# 📄 Briefing Técnico: Unificación Multi-Tenant por `service_id`

---

## 🎯 1. Objetivo Principal de la Reestructuración

El objetivo fue **unificar 4 proyectos independientes de Railway en 1 solo proyecto principal de Railway** (`79cbfba7-d278-4298-84d3-a29ad021b579`), manteniendo cada bot operando como un **servicio (Template/Instancia)** independiente con su propio `RAILWAY_SERVICE_ID`.

Para lograr esto sin cruzar información ni romper historiales existentes, se evolucionó la arquitectura de la base de datos y del backend para soportar un **particionamiento dual estricto por `project_id` + `service_id`**.

---

## 🗄️ 2. Cambios en la Base de Datos (Supabase / Postgres DDL)

Se ejecutó una migración de esquema y datos completa mediante el MCP de Supabase:

### A. Nuevas Columnas y Alteración de Tablas
Se agregó la columna **`service_id TEXT`** en todas las tablas del sistema:
- `chats`, `messages`, `tickets`, `tags`, `chat_tags`, `settings`, `meta_onboarding`, `users`, `routing_table`.

### B. Claves Primarias y Restricciones Compuestas
Para permitir que contactos o configuraciones con el mismo ID existan en paralelo en distintos servicios sin colisionar, se actualizaron las claves primarias:
- **`chats`**: `PRIMARY KEY (id, project_id, service_id)`
- **`settings`**: `PRIMARY KEY (project_id, service_id, key)`
- **`meta_onboarding`**: `PRIMARY KEY (project_id, service_id)`
- **`users`**: `UNIQUE (project_id, service_id, username)`
- **`chat_tags`**: Foreign Key vinculada contra `chats(id, project_id, service_id)` con borrado en cascada.

### C. Migración de Datos Históricos
Se reasignaron masivamente todos los registros anteriores de las bases de datos de los 4 proyectos hacia el nuevo `project_id` principal (`79cbfba7-d278-4298-84d3-a29ad021b579`), etiquetándolos con su respectivo `service_id`:

| Servicio | Service ID (`RAILWAY_SERVICE_ID`) | Proyecto Destino | Chats Migrados |
| :--- | :--- | :--- | :---: |
| **Servicio 1 (Principal)** | `9eccb65c-377b-4b11-a5cd-b0e05badf160` | `79cbfba7-d278-4298-84d3-a29ad021b579` | **3,867** |
| **Servicio 2** | `df76b144-813f-470f-a73a-ce88606b0f6e` | `79cbfba7-d278-4298-84d3-a29ad021b579` | **3,669** |
| **Servicio 3** | `7f8e7a76-00c1-436d-b124-fb59b1779a68` | `79cbfba7-d278-4298-84d3-a29ad021b579` | **3,923** |
| **Servicio 4** | `5c3f1d9c-fdc2-4dbe-a5df-ae67254de8e0` | `79cbfba7-d278-4298-84d3-a29ad021b579` | **3,549** |
| **TOTAL UNIFICADO** | | | **15,008 chats** |

---

## 💻 3. Cambios en Backend & Lógica de Negocio (TypeScript / Node.js)

### A. `HistoryHandler.ts` (Mapeador Core de Datos)
1. **Identificador Global:**
   - Se añadió la constante `SERVICE_IDENTIFIER`:
     ```typescript
     public static SERVICE_IDENTIFIER: string = 
         process.env.SERVICE_ID || process.env.RAILWAY_SERVICE_ID || "default_service";
     ```
2. **Aislamiento de Consultas:**
   - Se modificaron todas las funciones de lectura (`listChats`, `getChat`, `getMessages`, `listTickets`, `getTags`, `getSetting`, `loadSettingsIntoProcessEnv`, `getMetaOnboardingData`, etc.) para aplicar el filtro obligatorio:
     ```typescript
     query.eq('project_id', currentProjectId).eq('service_id', currentServiceId);
     ```
3. **Persistencia de `service_id`:**
   - Todas las funciones de creación/edición (`getOrCreateChat`, `saveMessage`, `createTicket`, `saveSetting`, `saveMetaOnboardingData`, etc.) guardan explícitamente el `service_id`.
4. **Auto-Sincronización del Router de Meta (`syncRoutingTableOnStartup`):**
   - Se agregó un procedimiento al arrancar el servidor que consulta la URL pública activa del servicio en Railway (`RAILWAY_STATIC_URL`) y la registra automáticamente en la tabla `routing_table` de Supabase.

### B. Rutas HTTP API (`webhook.routes.ts` & `backoffice.routes.ts`)
- Se implementó la función helper `resolveServiceId(req)` que extrae el `service_id` prioritariamente desde:
  1. Header HTTP `x-service-id`
  2. Query Param `service_id`
  3. `process.env.SERVICE_ID` / `RAILWAY_SERVICE_ID`

### C. Módulos Adicionales Actualizados
- **`WebhookDispatcher.ts`**: Inyecta `service_id` en todos los eventos emitidos hacia webhooks externos.
- **`ragService.ts`**: Asocia los vectores y fragmentos de conocimiento al `service_id`.
- **`mercadopago.ts`**: Aísla las integraciones de pago por servicio.
- **`humanInactivity.worker.ts`**: Procesa las inactividades filtrando tickets y chats por `service_id`.

---

## 🎨 4. Cambios en Frontend (`shell.html`)

- **Inyección Global:** Se expuso `window.railwayServiceId = "{{SERVICE_ID}}";`.
- **Interceptor de Peticiones (`fetch`):** Se interceptaron todas las solicitudes HTTP salientes del navegador para inyectar automáticamente:
  - Header: `x-service-id`
  - Query Parameter: `service_id`

Esto asegura que cuando un usuario entra al CRM o Dashboard de un servicio específico, el navegador consulte **única y exclusivamente los datos de ese servicio**.

---

## 📡 5. Enrutamiento Dinámico de Meta Webhooks (Edge Function)

- **Triangulación Transparente:** No fue necesario reconfigurar las URLs en el Developer Portal de Meta.
- Meta continúa enviando todos los webhooks a la **Edge Function central de Supabase**.
- La Edge Function busca el `phone_number_id` o `waba_id` en `routing_table` y reenvía la petición HTTP a la URL estática del servicio correspondiente en Railway.

---

## ✅ 6. Estado Final y Verificación

- **Compilación de Código:** Ejecutada mediante `npm run build` sin errores (0 advertencias/errores).
- **Control de Versiones:** Todos los cambios fueron committeados en la rama `main` de Git.
- **Operatividad:** Los 4 servicios pueden convivir en el mismo proyecto de Railway, aislados totalmente en DB, CRM, configuraciones y webhooks.
