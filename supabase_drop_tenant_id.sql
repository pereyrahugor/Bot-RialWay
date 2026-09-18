-- ==============================================================================
-- Migración SQL: Eliminación de la columna tenant_id en tablas operativas
-- La identificación de usuario/tenant queda centralizada en public.clientes (auth_user_id)
-- ==============================================================================

-- 1. Eliminar Foreign Keys, Checks, Triggers e Índices asociados a tenant_id
ALTER TABLE IF EXISTS public.routing_table DROP CONSTRAINT IF EXISTS routing_table_tenant_id_fkey;
ALTER TABLE IF EXISTS public.meta_onboarding DROP CONSTRAINT IF EXISTS meta_onboarding_tenant_id_fkey;
ALTER TABLE IF EXISTS public.meta_onboarding DROP CONSTRAINT IF EXISTS meta_onboarding_tenant_scope_check;

DROP INDEX IF EXISTS public.idx_routing_table_tenant_id;
DROP INDEX IF EXISTS public.idx_meta_onboarding_tenant_id;

DROP TRIGGER IF EXISTS trg_settings_enforce_tenant_id ON public.settings;
DROP FUNCTION IF EXISTS enforce_settings_tenant_id() CASCADE;

-- 2. Eliminar la columna tenant_id de las tablas operativas
ALTER TABLE IF EXISTS public.chats DROP COLUMN IF EXISTS tenant_id;
ALTER TABLE IF EXISTS public.messages DROP COLUMN IF EXISTS tenant_id;
ALTER TABLE IF EXISTS public.tickets DROP COLUMN IF EXISTS tenant_id;
ALTER TABLE IF EXISTS public.settings DROP COLUMN IF EXISTS tenant_id CASCADE;
ALTER TABLE IF EXISTS public.users DROP COLUMN IF EXISTS tenant_id;
ALTER TABLE IF EXISTS public.whatsapp_sessions DROP COLUMN IF EXISTS tenant_id;
ALTER TABLE IF EXISTS public.meta_onboarding DROP COLUMN IF EXISTS tenant_id;
ALTER TABLE IF EXISTS public.routing_table DROP COLUMN IF EXISTS tenant_id;
