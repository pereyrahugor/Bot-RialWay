// src/bot/clientModuleLoader.ts
import { moduleRegistry } from "./toolRegistry";

export async function loadActiveClientModule() {
  const clientSlugRaw = process.env.CLIENT_SLUG;

  if (!clientSlugRaw) {
    console.warn("[clientModuleLoader] No hay CLIENT_SLUG configurado en process.env. Se cargará modo base sin módulos de cliente.");
    return null;
  }

  const clientSlug = clientSlugRaw.trim().toLowerCase();
  const activeModule = moduleRegistry[clientSlug as keyof typeof moduleRegistry];

  if (!activeModule) {
    throw new Error(`No existe módulo registrado para CLIENT_SLUG=${clientSlug}`);
  }

  console.log(`[clientModuleLoader] Módulo activo cargado: ${clientSlug}`);
  return activeModule;
}
