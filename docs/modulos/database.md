# 🗄️ Database Integration

El bot utiliza dos capas de persistencia: **PostgreSQL** (vía Supabase) para datos operacionales y el propio estado de **Supabase** para la sesión de WhatsApp.

## 🐘 Handler de Base de Datos (`dbHandler.ts`)

Encargado de ejecutar consultas crudas de SQL para el asistente de OpenAI.

### Métodos Principales

#### `executeDbQuery(query: string, values: any[])`
Ejecuta una consulta SQL segura utilizando el pool de conexiones.
- **Uso**: Invocado por el `AssistantResponseProcessor` cuando OpenAI detecta una necesidad de consulta a base de datos (ej: "Consultar stock de producto").

## 🔌 Supabase Adapter (`supabaseAdapter.ts`)
Este módulo extiende las capacidades de almacenamiento para el bot, permitiendo guardar logs de mensajes y estados complejos que no caben en memoria.

### Tablas Clave
1. **sessions**: Guarda el binario de la sesión de Baileys.
2. **logs**: Registro de entradas y salidas del bot.
3. **variables**: Cache local de variables si fuera necesario.

---

## 🔗 Enlaces Cruzados
- [Assistant Processor](./assistant-processor.md)
- [Persistencia de Sesión](./session-sync.md)
