# Backoffice — Guía de instalación en otro proyecto

Este panel de administración (backoffice) puede montarse en cualquier backend Node.js con ESM.
Requiere crear algunos archivos "puente" que conecten el backoffice con la lógica de tu proyecto.

---

## Paso 1 — Instalar dependencias npm

```bash
npm install @supabase/supabase-js dotenv axios body-parser multer xlsx serve-static qrcode
```

---

## Paso 2 — Copiar la carpeta del backoffice

Copiá toda la carpeta `backoffice/` dentro de `src/` de tu proyecto destino:

```
src/
  backoffice/
    db/
      historyHandler.ts   <- proxy al HistoryHandler de tu proyecto
      vault.ts            <- credenciales Supabase
    html/                 <- archivos HTML del panel (no modificar)
    js/                   <- frontend del panel (no modificar)
    style/                <- CSS del panel (no modificar)
    middleware/
      auth.ts             <- autenticación del panel
    routes/
      backoffice.routes.ts
      dashboard.routes.ts
      static.routes.ts
    types/
      provider.interface.ts
    webchat/
      WebChatManager.ts
      WebChatSession.ts
      routes/
        webchat.routes.ts
    mount.ts
    index.ts
```

---

## Paso 3 — Crear los archivos requeridos

El backoffice importa dinámicamente varios módulos del proyecto. Necesitás crearlos en las rutas exactas indicadas.

---

### `src/db/historyHandler.ts`

El backoffice usa `HistoryHandler` para toda la persistencia. Este es el archivo más importante.
Necesita exportar la clase `HistoryHandler` con métodos estáticos, un cliente `supabase`, y un `historyEvents` EventEmitter.

```typescript
// src/db/historyHandler.ts
import { createClient } from '@supabase/supabase-js';
import { EventEmitter } from 'events';

const SUPABASE_URL = process.env.SUPABASE_URL!;
const SUPABASE_KEY = process.env.SUPABASE_KEY!;

export const supabase = createClient(SUPABASE_URL, SUPABASE_KEY);
export const historyEvents = new EventEmitter();

export class HistoryHandler {
    static PROJECT_IDENTIFIER: string = process.env.RAILWAY_PROJECT_ID || 'default_project';

    // Autenticación
    static async verifyUser(username: string, pass: string): Promise<any | null> { /* ... */ }
    static async listUsers(): Promise<any[]> { /* ... */ }
    static async createUser(username: string, pass: string, role?: string): Promise<{ success: boolean; user?: any; error?: string }> { /* ... */ }

    // Configuración
    static async getConfig(key: string, projectId?: string | null): Promise<string | null> { /* ... */ }
    static async saveSetting(key: string, value: string, projectId?: string | null): Promise<void> { /* ... */ }
    static async getSetting(key: string, projectId?: string | null): Promise<string | null> { /* ... */ }

    // Chats y mensajes
    static async listChats(limit?: number, offset?: number, search?: string, tagId?: string, assignedTo?: string | null, platform?: string): Promise<any[]> { /* ... */ }
    static async getChat(rawChatId: string, forcedProjectId?: string): Promise<any | null> { /* ... */ }
    static async getMessages(rawChatId: string, limit?: number, offset?: number, projectId?: string | null): Promise<any[]> { /* ... */ }
    static async saveMessage(rawChatId: string, role: 'user' | 'assistant' | 'system', content: string, type?: string, contactName?: string | null, userId?: string | null, external_id?: string | null, platformType?: 'whatsapp' | 'webchat' | 'instagram' | 'messenger', forcedProjectId?: string): Promise<void> { /* ... */ }
    static async deleteMessage(messageId: string, rawChatId?: string, forcedProjectId?: string): Promise<boolean> { /* ... */ }
    static async updateLastHumanMessage(rawChatId: string): Promise<void> { /* ... */ }
    static async toggleBot(rawChatId: string, enabled: boolean): Promise<void> { /* ... */ }
    static async assignChatToUser(rawChatId: string, userId: string | null): Promise<void> { /* ... */ }
    static async setAssignedAgent(rawChatId: string, agentName: string, forcedProjectId?: string): Promise<void> { /* ... */ }
    static async updateContactDetails(rawChatId: string, details: any): Promise<{ success: boolean }> { /* ... */ }

    // Thread IDs (OpenAI)
    static async getThreadId(chatId: string, forcedProjectId?: string): Promise<string | null> { /* ... */ }
    static async saveThreadId(chatId: string, threadId: string, forcedProjectId?: string): Promise<void> { /* ... */ }

    // Tags
    static async getTags(): Promise<any[]> { /* ... */ }
    static async createTag(name: string, color?: string): Promise<{ success: boolean; tag?: any }> { /* ... */ }
    static async updateTag(id: string, name: string, color: string): Promise<{ success: boolean }> { /* ... */ }
    static async deleteTag(id: string): Promise<{ success: boolean }> { /* ... */ }
    static async addTagToChat(rawChatId: string, tagId: string): Promise<{ success: boolean }> { /* ... */ }
    static async removeTagFromChat(rawChatId: string, tagId: string): Promise<{ success: boolean }> { /* ... */ }
    static async syncTags(tags: any[], forcedProjectId?: string): Promise<{ success: boolean; data?: any[]; error?: string }> { /* ... */ }
    static async syncChats(chats: any[], forcedProjectId?: string): Promise<{ success: boolean; data?: any[]; error?: string }> { /* ... */ }
    static async syncChatTags(associations: any[], forcedProjectId?: string): Promise<{ success: boolean }> { /* ... */ }

    // Tickets / CRM
    static async listTickets(limit?: number, offset?: number, estado?: string, tipo?: string, chatId?: string, ticketId?: string): Promise<any[]> { /* ... */ }
    static async createTicket(rawChatId: string, titulo: string, descripcion: string, tipo?: string, prioridad?: string, forcedProjectId?: string): Promise<{ success: boolean; ticket?: any }> { /* ... */ }
    static async updateTicketStatus(ticketId: string, nuevoEstado: string): Promise<{ success: boolean }> { /* ... */ }
    static async updateLeadAndTicket(ticketId: string, details: any): Promise<{ success: boolean }> { /* ... */ }
    static async getPendingTicketsCount(tipo?: string): Promise<number> { /* ... */ }
    static async listEditedLeads(limit?: number, offset?: number): Promise<any[]> { /* ... */ }
    static async createNewLeadManual(chatId: string, details: any): Promise<{ success: boolean }> { /* ... */ }
    static async getTasksDashboard(): Promise<any> { /* ... */ }

    // Meta / WhatsApp
    static async getMetaOnboardingData(projectId?: string | null, fallbackToMain?: boolean): Promise<any> { /* ... */ }
    static async saveMetaOnboardingData(wabaId: string, phoneId: string, token: string, extra?: any, projectId?: string | null): Promise<{ success: boolean }> { /* ... */ }
    static async getMainToken(): Promise<string | null> { /* ... */ }

    // DB init
    static async initDatabase(): Promise<void> { /* ... */ }
}
```

---

### `src/providers/provider.manager.ts`

Controla el estado de sesión del provider de WhatsApp.

```typescript
// src/providers/provider.manager.ts

const sentMessageCache = new Set<string>();

export const trackSentMessage = (id: string): void => {
    if (!id) return;
    sentMessageCache.add(id);
    setTimeout(() => sentMessageCache.delete(id), 10000);
};

export const hasActiveSession = async (
    adapterProvider: any,
    groupProvider: any = null
): Promise<{
    adapter: { active: boolean; qr?: string } | null;
    group: { active: boolean; qr?: string } | null;
}> => {
    // Implementá según tu provider de WhatsApp
    return {
        adapter: adapterProvider ? { active: true } : null,
        group: groupProvider ? { active: true } : null,
    };
};
```

---

### `src/providers/instances.ts`

Singleton para acceder al provider desde cualquier parte.

```typescript
// src/providers/instances.ts

let adapterProvider: any = null;
let groupProvider: any = null;

export const setAdapterProvider = (p: any) => { adapterProvider = p; };
export const setGroupProvider = (p: any) => { groupProvider = p; };
export const getAdapterProvider = () => adapterProvider;
export const getGroupProvider = () => groupProvider;
```

---

### `src/db/localHistoryStore.ts`

Almacenamiento local de mensajes (fallback sin Supabase). Puede ser un stub vacío si no lo usás.

```typescript
// src/db/localHistoryStore.ts

export class LocalHistoryStore {
    static getMessages(
        chatId: string,
        limit: number,
        offset: number,
        projectId: string
    ): any[] {
        return [];
    }
}
```

---

### `src/apis/openai/openaiHelper.ts`

Proveedor de instancias OpenAI. Requiere las variables de entorno `OPENAI_API_KEY` y opcionalmente `OPENAI_VISION_API_KEY`.

```typescript
// src/apis/openai/openaiHelper.ts
import OpenAI from 'openai';

let openaiInstance: OpenAI | null = null;
let openaiVisionInstance: OpenAI | null = null;

export const getOpenAI = async (): Promise<OpenAI | null> => {
    const key = process.env.OPENAI_API_KEY;
    if (!key) return null;
    if (!openaiInstance) openaiInstance = new OpenAI({ apiKey: key });
    return openaiInstance;
};

export const getOpenAIVision = async (): Promise<OpenAI | null> => {
    const key = process.env.OPENAI_VISION_API_KEY || process.env.OPENAI_API_KEY;
    if (!key) return null;
    if (!openaiVisionInstance) openaiVisionInstance = new OpenAI({ apiKey: key });
    return openaiVisionInstance;
};

export const syncAssistantTools = async (assistantId: string): Promise<void> => {
    // Opcional: sincroniza tools del asistente con OpenAI
};
```

---

### `src/apis/meta/metaDiscovery.ts`

Funciones para descubrir y vincular cuentas de Meta/WhatsApp Business.
Si no usás Meta API, podés dejar stubs vacíos.

```typescript
// src/apis/meta/metaDiscovery.ts

export const discoverMetaIds = async (accessToken: string, mainToken?: string | null) => {
    return null;
};

export const addPhoneNumberToWaba = async (
    accessToken: string, wabaId: string, phoneNumber: string, verifiedName: string
) => {
    return null;
};

export const requestPhoneNumberOtp = async (
    accessToken: string, phoneId: string, method: 'SMS' | 'VOICE' = 'SMS'
) => {};

export const verifyPhoneNumberOtp = async (
    accessToken: string, phoneId: string, code: string
) => {};

export const getWabaStatus = async (wabaId: string, accessToken: string) => {
    return null;
};

export const getPhoneLimit = async (phoneId: string, accessToken: string) => {
    return null;
};
```

---

### `src/apis/meta/metaPageDiscovery.ts`

Vincula páginas de Facebook/Instagram con el sistema.
Si no usás páginas de Meta, podés dejar un stub vacío.

```typescript
// src/apis/meta/metaPageDiscovery.ts

export const discoverAndLinkMetaPages = async (userAccessToken: string) => {
    return null;
};
```

---

### `src/apis/railway/Railway.ts`

Gestiona variables de entorno de Railway. Si no desplegás en Railway, el stub vacío alcanza.

```typescript
// src/apis/railway/Railway.ts

export class RailwayApi {
    static async getVariables(): Promise<Record<string, string> | null> {
        return null;
    }
}
```

---

## Paso 4 — Montar el backoffice

```typescript
import { mountBackoffice } from './backoffice/index';

// Solo backoffice, sin webchat:
mountBackoffice(app, {
    provider: miProvider,       // debe cumplir BackofficeProvider
    groupProvider: null,        // opcional
    openaiMain: openaiInstance, // instancia OpenAI o null
    upload: multerInstance,     // instancia multer o null
});
```

---

## Paso 5 — Montar el backoffice con Webchat (opcional)

```typescript
import { mountBackoffice, WebChatManager } from './backoffice/index';

const webChatManager = new WebChatManager();

mountBackoffice(app, {
    provider: miProvider,
    openaiMain: openaiInstance,
    upload: multerInstance,

    // Si se omite webChatManager, el webchat no se registra
    webChatManager,
    openaiVision: openaiVisionInstance,
    aiManager: miAiManager,              // necesita método: getAssignedAssistantId(ip: string): Promise<string>
    safeToAsk: miSafeToAsk,             // (assistantId, msg, state, userId, ...args) => Promise<any>
    AssistantResponseProcessor: MiProcessor, // clase con método estático: analizarYProcesarRespuestaAsistente(...)
    transcribeAudioFile: miTranscribeFn, // (filePath: string) => Promise<string | null>
    withRetry: miWithRetry,              // <T>(fn: () => Promise<T>, opts?: { maxRetries?: number, delayMs?: number }) => Promise<T>
});
```

---

## Variables de entorno

| Variable | Uso | Requerida |
|---|---|---|
| `SUPABASE_URL` | URL del proyecto Supabase | Si |
| `SUPABASE_KEY` | Anon/service key de Supabase | Si |
| `RAILWAY_PROJECT_ID` | Separación de datos por proyecto (multitenancy) | No (usa `"default_project"`) |
| `RAILWAY_SERVICE_NAME` | Nombre del servicio | No |
| `ADMIN_PASS` | Contraseña del panel | No (lee de DB como fallback) |
| `ASSISTANT_NAME` | Nombre que aparece en el panel | No |
| `OPENAI_API_KEY` | API key de OpenAI | Solo si usás IA |
| `META_ACCESS_TOKEN` | Token de Meta API | Solo si usás WhatsApp Cloud API |

---

## Rutas disponibles

| Ruta | Descripción |
|---|---|
| `/login` | Login del panel |
| `/backoffice` | Panel principal de mensajes |
| `/dashboard` | Dashboard con métricas |
| `/crm` | CRM de leads y tickets |
| `/system-config` | Configuración del sistema |
| `/webchat` | Chat web embebible (requiere `webChatManager`) |
| `/webchat-api` | Endpoint POST del webchat (requiere `webChatManager`) |

---

## Notas importantes

- Los archivos `html/`, `js/` y `style/` son estáticos. En deploy, copiá esas carpetas junto al código compilado.
- El `RAILWAY_PROJECT_ID` actúa como identificador de tenant en Supabase. Proyectos distintos con el mismo Supabase no se pisan entre sí.
- `backoffice/db/historyHandler.ts` es un proxy que re-exporta desde `src/db/historyHandler.ts`. Si la DB que usás es distinta, ese es el único archivo del backoffice que debés modificar.
- Los stubs de `metaDiscovery`, `metaPageDiscovery` y `Railway` pueden devolverv `null` sin romper nada — esas funciones solo se llaman cuando el usuario accede a esas secciones del panel.
