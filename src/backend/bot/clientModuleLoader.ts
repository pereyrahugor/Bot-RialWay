// src/bot/clientModuleLoader.ts
import { moduleRegistry } from "./toolRegistry";
import { HistoryHandler } from "../db/historyHandler";

export async function loadActiveClientModule(projectId?: string | null, serviceId?: string | null) {
  const clientSlugRaw = await HistoryHandler.getConfig('CLIENT_SLUG', projectId || null, serviceId || null) || process.env.CLIENT_SLUG;

  if (!clientSlugRaw) {
    console.warn("[clientModuleLoader] No hay CLIENT_SLUG configurado en process.env. Se cargará modo base sin módulos de cliente.");
    return null;
  }

  const clientSlug = clientSlugRaw.trim().toLowerCase();
  
  let activeModule: any = null;
  if (clientSlug === 'aquavita') {
    const mod = await import("../modules/aquavita/index");
    activeModule = mod.aquavitaModule;
  } else if (clientSlug === 'cas-epc' || clientSlug === 'casepc') {
    const mod = await import("../modules/cas-epc/index");
    activeModule = mod.casEpcModule;
  } else if (clientSlug === 'ganemos' || clientSlug === 'ganemos-net') {
    const mod = await import("../modules/ganemos-net/index");
    activeModule = mod.ganemosModule;
  } else if (clientSlug === 'trust') {
    const mod = await import("../modules/trust/index");
    activeModule = mod.trustModule;
  }

  if (!activeModule) {
    throw new Error(`No existe módulo registrado para CLIENT_SLUG=${clientSlug}`);
  }

  console.log(`[clientModuleLoader] Módulo activo cargado: ${clientSlug}`);
  return activeModule;
}
