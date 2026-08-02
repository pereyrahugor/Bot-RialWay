# 📘 Manual y Guía de Migración Multi-Proyecto a Servicios Unificados

Este documento es una **guía paso a paso y plantilla estándar** para migrar proyectos antiguos independientes (1 proyecto en Railway por bot) hacia la **arquitectura unificada Multi-Tenant particionada por `service_id`** (1 proyecto en Railway con N Servicios/Templates internos).

---

## 📋 1. Requisitos Previos e Identificadores

Antes de iniciar la migración de un cliente o grupo de bots, recopila los siguientes identificadores:

1. **`TARGET_PROJECT_ID`**: ID del proyecto unificado en Railway (ejemplo: `79cbfba7-d278-4298-84d3-a29ad021b579`).
2. Para cada bot a migrar:
   - **`OLD_PROJECT_ID`**: ID antiguo del proyecto en Railway que se va a reemplazar.
   - **`NEW_SERVICE_ID`**: ID del nuevo servicio (template) creado dentro del proyecto unificado en Railway (`RAILWAY_SERVICE_ID`).

---

## 🛠️ 2. Paso 1: Preparación del Esquema de la Base de Datos (DDL)

> **Nota:** Si la base de datos de Supabase ya tiene ejecutado el DDL inicial, no es necesario repetirlo. Sin embargo, este bloque asegura que todas las columnas y primary keys compuestas existan.

Ejecutar en Supabase (SQL Editor o vía MCP `supabase/execute_sql`):

```sql
-- 1. Agregar columna service_id en todas las tablas si no existe
ALTER TABLE chats ADD COLUMN IF NOT EXISTS service_id TEXT;
ALTER TABLE messages ADD COLUMN IF NOT EXISTS service_id TEXT;
ALTER TABLE tickets ADD COLUMN IF NOT EXISTS service_id TEXT;
ALTER TABLE tags ADD COLUMN IF NOT EXISTS service_id TEXT;
ALTER TABLE chat_tags ADD COLUMN IF NOT EXISTS service_id TEXT;
ALTER TABLE settings ADD COLUMN IF NOT EXISTS service_id TEXT;
ALTER TABLE meta_onboarding ADD COLUMN IF NOT EXISTS service_id TEXT;
ALTER TABLE users ADD COLUMN IF NOT EXISTS service_id TEXT;
ALTER TABLE routing_table ADD COLUMN IF NOT EXISTS service_id TEXT;

-- 2. Ajustar Claves Primarias y Restricciones Compuestas
ALTER TABLE chats DROP CONSTRAINT IF EXISTS chats_pkey CASCADE;
ALTER TABLE chats ADD PRIMARY KEY (id, project_id, service_id);

ALTER TABLE settings DROP CONSTRAINT IF EXISTS settings_pkey CASCADE;
ALTER TABLE settings ADD PRIMARY KEY (project_id, service_id, key);

ALTER TABLE meta_onboarding DROP CONSTRAINT IF EXISTS meta_onboarding_pkey CASCADE;
ALTER TABLE meta_onboarding ADD PRIMARY KEY (project_id, service_id);

-- 3. Restaurar Clave Foránea de chat_tags contra chats compuesta (id, project_id, service_id)
ALTER TABLE chat_tags DROP CONSTRAINT IF EXISTS chat_tags_chats_fkey;
ALTER TABLE chat_tags DROP CONSTRAINT IF EXISTS chat_tags_chat_id_project_id_service_id_fkey;

ALTER TABLE chat_tags ADD CONSTRAINT chat_tags_chat_id_project_id_service_id_fkey
FOREIGN KEY (chat_id, project_id, service_id) REFERENCES chats(id, project_id, service_id)
ON UPDATE CASCADE ON DELETE CASCADE;
```

---

## 🚚 3. Paso 2: Plantilla SQL de Migración de Datos (DML)

Sustituye los siguientes valores en la plantilla antes de ejecutar:
- `:TARGET_PROJECT_ID` ➔ El `project_id` unificado de destino.
- `:OLD_PROJECT_ID` ➔ El `project_id` del proyecto antiguo a migrar.
- `:NEW_SERVICE_ID` ➔ El `service_id` (`RAILWAY_SERVICE_ID`) del nuevo servicio en Railway.

```sql
-- =========================================================================
-- PLANTILLA DE MIGRACIÓN POR SERVICIO
-- =========================================================================

-- A. Migrar Tabla CHATS
UPDATE chats 
SET project_id = ':TARGET_PROJECT_ID', service_id = ':NEW_SERVICE_ID' 
WHERE project_id = ':OLD_PROJECT_ID';

-- B. Migrar Tabla MESSAGES
UPDATE messages 
SET project_id = ':TARGET_PROJECT_ID', service_id = ':NEW_SERVICE_ID' 
WHERE project_id = ':OLD_PROJECT_ID';

-- C. Migrar Tabla TICKETS
UPDATE tickets 
SET project_id = ':TARGET_PROJECT_ID', service_id = ':NEW_SERVICE_ID' 
WHERE project_id = ':OLD_PROJECT_ID';

-- D. Migrar Tabla TAGS
UPDATE tags 
SET project_id = ':TARGET_PROJECT_ID', service_id = ':NEW_SERVICE_ID' 
WHERE project_id = ':OLD_PROJECT_ID';

-- E. Migrar Tabla CHAT_TAGS
UPDATE chat_tags 
SET project_id = ':TARGET_PROJECT_ID', service_id = ':NEW_SERVICE_ID' 
WHERE project_id = ':OLD_PROJECT_ID';

-- F. Migrar Tabla SETTINGS
UPDATE settings 
SET project_id = ':TARGET_PROJECT_ID', service_id = ':NEW_SERVICE_ID' 
WHERE project_id = ':OLD_PROJECT_ID';

-- G. Migrar Tabla META_ONBOARDING
UPDATE meta_onboarding 
SET project_id = ':TARGET_PROJECT_ID', service_id = ':NEW_SERVICE_ID' 
WHERE project_id = ':OLD_PROJECT_ID';

-- H. Actualizar ROUTING_TABLE para el enrutador de webhooks
UPDATE routing_table 
SET project_id = ':TARGET_PROJECT_ID', service_id = ':NEW_SERVICE_ID' 
WHERE project_id = ':OLD_PROJECT_ID';
```

---

## 🔍 4. Paso 3: Consultas de Verificación Post-Migración

Una vez ejecutados los scripts de migración, ejecuta las siguientes consultas para verificar que la información se trasladó correctamente y está asignada a cada `service_id`:

```sql
-- Verificar conteo de chats por servicio
SELECT project_id, service_id, COUNT(*) as total_chats 
FROM chats 
WHERE project_id = ':TARGET_PROJECT_ID'
GROUP BY project_id, service_id;

-- Verificar conteo de mensajes por servicio
SELECT project_id, service_id, COUNT(*) as total_mensajes 
FROM messages 
WHERE project_id = ':TARGET_PROJECT_ID'
GROUP BY project_id, service_id;

-- Verificar conteo de tickets por servicio
SELECT project_id, service_id, COUNT(*) as total_tickets 
FROM tickets 
WHERE project_id = ':TARGET_PROJECT_ID'
GROUP BY project_id, service_id;

-- Verificar routing_table activa
SELECT phone_number_id, project_id, service_id, project_url, updated_at 
FROM routing_table 
WHERE project_id = ':TARGET_PROJECT_ID';
```

---

## 🚀 5. Paso 4: Despliegue y Sincronización Automática

1. **Variables de Entorno en Railway:**
   Asegúrate de que cada servicio dentro del proyecto de Railway tenga configuradas sus variables automáticas de Railway:
   - `RAILWAY_PROJECT_ID`
   - `RAILWAY_SERVICE_ID`
   - `RAILWAY_STATIC_URL` (o dominio público asignado)

2. **Reinicio/Redeploy:**
   Reinicia o realiza `git push` a los servicios en Railway.
   Al arrancar el backend, ejecutará automáticamente:
   - `loadSettingsIntoProcessEnv()` (Carga de settings aisladas por `service_id`).
   - `syncRoutingTableOnStartup()` (Auto-registro de la nueva URL del servicio en `routing_table`).

3. **Verificación de Webhooks:**
   No se requiere modificar ninguna URL en Meta Developer Portal. La Edge Function de Supabase consultará `routing_table` y enrutará los mensajes entrantes automáticamente al nuevo servicio.

---

## 🧹 6. Paso 5: Limpieza de Recursos Antiguos

Una vez validada la migración del cliente:
1. Acceder al dashboard web de Railway (`railway.com`).
2. Eliminar los proyectos antiguos reemplazados (`Settings` ➔ `Delete Project`).
