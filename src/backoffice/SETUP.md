# Backoffice — Guía de instalación en otro proyecto

## Requisitos previos

- Node.js con soporte ESM (`"type": "module"` en `package.json`)
- Servidor HTTP compatible con Polka o Express
- Cuenta en Supabase (las credenciales ya están embebidas en `db/vault.ts`)

## Dependencias npm necesarias

```bash
npm install @supabase/supabase-js dotenv axios body-parser multer xlsx serve-static qrcode
```

## Pasos para integrar

### 1. Copiar la carpeta

Copiá toda la carpeta `backoffice/` al `src/` del proyecto destino. La estructura debe quedar así:

```
src/
  backoffice/
    db/           <- vault.ts + historyHandler.ts (capa DB interna)
    html/         <- archivos HTML del panel
    js/           <- frontend del panel
    style/        <- CSS del panel
    middleware/   <- auth.ts
    routes/       <- backoffice.routes.ts, dashboard.routes.ts, static.routes.ts
    types/        <- provider.interface.ts
    mount.ts
    index.ts
```

### 2. Implementar la interfaz del provider

Tu provider de WhatsApp debe cumplir la interfaz `BackofficeProvider`:

```typescript
import type { BackofficeProvider } from './backoffice/index';

const miProvider: BackofficeProvider = {
  sendTemplate: async (phone, templateName, languageCode, components) => {
    // tu lógica para enviar templates de WhatsApp
  },
  getTemplates: async () => {
    // tu lógica para obtener templates disponibles
    return [];
  },
  qrCodeString: undefined, // opcional: string del QR si usás Baileys
};
```

### 3. Montar el backoffice

```typescript
import { mountBackoffice } from './backoffice/index';

// Dentro de tu función main, una vez que tengas el servidor (app):
mountBackoffice(app, {
  provider: miProvider,
  groupProvider: miGroupProvider, // opcional
  openaiMain: openaiInstance,     // opcional, para funciones de IA
  upload: multerInstance,          // opcional, para subida de archivos
});
```

### 4. Servir los archivos estáticos

El backoffice sirve sus propios archivos desde `backoffice/html/`, `backoffice/js/` y `backoffice/style/`. No se necesita configuración adicional — `mountBackoffice` lo registra automáticamente.

Si usás esbuild u otro bundler, asegurate de que los archivos estáticos del panel (html/js/css) se copien al directorio de salida en el deploy.

### 5. Variables de entorno opcionales

El backoffice funciona sin `.env` gracias a `db/vault.ts`. Sin embargo, algunas funciones mejoran con estas variables:

| Variable | Uso |
|---|---|
| `ADMIN_PASS` | Contraseña del panel (si no está, lee de DB) |
| `RAILWAY_PROJECT_ID` | Identificador único del proyecto en Supabase |
| `RAILWAY_SERVICE_NAME` | Nombre del servicio |
| `ASSISTANT_NAME` | Nombre del bot que aparece en el panel |

### 6. Acceder al panel

Una vez montado, el panel estará disponible en:

- `/backoffice` — Panel principal de mensajes
- `/dashboard` — Dashboard con métricas
- `/login` — Login del panel
- `/crm` — CRM de leads
- `/system-config` — Configuración del sistema

## Notas importantes

- La autenticación usa `ADMIN_PASS` de la tabla `settings` en Supabase, o la variable de entorno del mismo nombre como fallback.
- El `RAILWAY_PROJECT_ID` separa los datos de cada proyecto en Supabase (multitenancy). Si no está definido, usa `"default_project"`.
- Los archivos HTML/JS/CSS del panel **no son parte del bundle** — deben desplegarse como estáticos junto al código compilado.
