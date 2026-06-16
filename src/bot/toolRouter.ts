// src/bot/toolRouter.ts
import { loadActiveClientModule } from "./clientModuleLoader";
import { historyEvents } from "../db/historyHandler";

let cachedModule: any = null;

// Escuchar cambios de settings en tiempo real para invalidar el módulo en caché
historyEvents.on("setting_changed", ({ key }) => {
  if (key === "CLIENT_SLUG") {
    console.log(`[toolRouter] 🔄 Se detectó cambio de CLIENT_SLUG en settings. Invalidando caché de módulo.`);
    invalidateModuleCache();
  }
});

export async function getActiveModule() {
  if (!cachedModule) {
    cachedModule = await loadActiveClientModule();
  }
  return cachedModule;
}

export function invalidateModuleCache() {
  cachedModule = null;
}

/**
 * Enruta y ejecuta una herramienta de cliente con validaciones de seguridad.
 */
export async function executeClientTool(toolName: string, args: any, context: any = {}) {
  // 0. Herramientas Globales / Compartidas (ej: Mercado Pago)
  const isMpTool = ["generar_link_pago", "mercadopago_crear_link", "mercadopago.crear_link"].includes(toolName);
  if (isMpTool) {
      console.log(`[toolRouter] 🚀 Ejecutando herramienta global '${toolName}'`);
      try {
          const { createMercadoPagoPreference } = await import("../utils/mercadopago");
          const title = args.title || args.concepto || args.description || "Cobro";
          const amount = Number(args.amount || args.monto || args.precio);
          
          if (!amount || isNaN(amount)) {
              return { error: "Monto inválido para generar el link de pago." };
          }
          
          const state = context?.state;
          const dynamicProjectId = state?.get ? state.get('dynamicProjectId') : (process.env.RAILWAY_PROJECT_ID || null);
          
          const result = await createMercadoPagoPreference(title, amount, 1, dynamicProjectId);
          return {
              success: true,
              link: result.initPoint,
              preferenceId: result.preferenceId,
              result: `Link de pago generado para "${title}" por $${amount}: ${result.initPoint}`
          };
      } catch (err: any) {
          console.error(`[toolRouter] Error en herramienta global '${toolName}':`, err.message);
          return { error: `No se pudo generar el link de pago: ${err.message}` };
      }
  }

  const activeModule = await getActiveModule();

  if (!activeModule) {
    throw new Error("No hay un módulo de cliente activo configurado en Supabase settings.");
  }

  // 1. Seguridad: Si el nombre contiene un punto, el prefijo debe coincidir con el módulo activo.
  // Ej: 'cdm.crear_pedido' bloqueado si activeModule.key es 'aquavita'
  if (toolName.includes('.')) {
    const [prefix] = toolName.split('.');
    const normalizedPrefix = prefix.trim().toLowerCase();
    const expectedSlug = activeModule.key.trim().toLowerCase();
    
    if (normalizedPrefix !== expectedSlug) {
      console.warn(`[toolRouter] 🛡️ [BLOQUEO DE SEGURIDAD] Intento de invocar '${toolName}' en un bot configurado para '${expectedSlug}'`);
      throw new Error(`Acceso denegado: La función '${toolName}' no está autorizada para el módulo '${expectedSlug}'`);
    }
  }

  // 2. Buscar la función en el módulo activo
  // Primero buscamos con el nombre exacto
  let handler = activeModule.tools?.[toolName];

  // Si no se encuentra y tiene prefijo, probamos buscando solo el nombre de la acción
  if (!handler && toolName.includes('.')) {
    const [, realName] = toolName.split('.');
    handler = activeModule.tools?.[realName];
  }

  if (!handler) {
    throw new Error(`La función '${toolName}' no está implementada o habilitada para el cliente '${activeModule.key}'`);
  }

  console.log(`[toolRouter] 🚀 Ejecutando handler para '${toolName}' en cliente '${activeModule.key}'`);
  
  return await handler(args, {
    ...context,
    clientSlug: activeModule.key,
  });
}
