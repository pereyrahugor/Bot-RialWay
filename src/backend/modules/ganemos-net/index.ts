import { createUserSelenium } from "../../apis/external/Ganemos-net/createUser-Selenium.js";
import { rechargeUserSelenium } from "../../apis/external/Ganemos-net/rechargeUser-Selenium.js";
import { withdrawalUser } from "../../apis/external/Ganemos-net/withdrawalUser-Selunium.js";

export const ganemosModule = {
  key: "ganemos",
  label: "Ganemos-net",

  tools: {
    // ----------------------------------------------------
    // LOWERCASE WRAPPERS (Para invocación por código)
    // ----------------------------------------------------
    crearJugador: async (args: any, context: any) => ganemosModule.tools.CREAR_JUGADOR(args, context),
    depositar: async (args: any, context: any) => ganemosModule.tools.DEPOSITAR(args, context),
    retirar: async (args: any, context: any) => ganemosModule.tools.RETIRAR(args, context),

    // ----------------------------------------------------
    // CORE TOOLS (Para mapear respuestas del Asistente OpenAI)
    // ----------------------------------------------------
    CREAR_JUGADOR: async (args: any, context: any) => {
      const rawNombre = args.nombre || args.baseName || args.username;
      const nombre = rawNombre ? String(rawNombre).trim() : '';

      console.log(`[ganemosModule] 👤 Invocando CREAR_JUGADOR para: "${nombre || 'sin_nombre'}"`);
      
      if (!nombre || nombre.toLowerCase() === 'jugador' || nombre.toLowerCase() === 'cliente' || nombre.toLowerCase() === 'user') {
          return `❌ Se requiere obligatoriamente el nombre de pila del cliente para generar su usuario. Por favor pregúntale su nombre al cliente primero.`;
      }
      
      const res = await createUserSelenium(nombre, false);
      if (res) {
          const chatId = context?.ctx?.from;
          const projectId = context?.projectId;
          if (chatId) {
              try {
                  const { HistoryHandler } = await import("../../db/historyHandler.js");
                  await HistoryHandler.updateContactDetails(chatId, { cuit_dni: res.username }, projectId);
                  console.log(`[ganemosModule] 💾 Guardado usuario ${res.username} en chats.cuit_dni para ${chatId}`);
              } catch (dbErr: any) {
                  console.error(`[ganemosModule] ❌ Error guardando usuario de jugador en BD:`, dbErr.message);
              }
          }
          return `✅ Usuario ${res.username} creado con éxito. Contraseña por defecto: "${res.password}".`;
      }
      return `❌ No se pudo completar la creación del usuario.`;
    },

    DEPOSITAR: async (args: any, context: any) => {
      const username = args.username || args.usuario || args.user;
      const amount = Number(args.monto || args.amount || args.cantidad);

      console.log(`[ganemosModule] 💰 Invocando DEPOSITAR para: "${username}" | monto: ${amount}`);

      if (!username || !amount || isNaN(amount)) {
          return `❌ Parámetros insuficientes. Se requiere 'username' y 'monto'.`;
      }

      const success = await rechargeUserSelenium(username, amount);
      if (success) {
          return `✅ Depósito de $${amount} procesado con éxito para el usuario ${username}.`;
      }
      
      // Si falló el depósito automático, liberar el comprobante en la base de datos
      const paymentId = context?.state?.get?.('pendingPaymentId');
      if (paymentId) {
          const { HistoryHandler } = await import("../../db/historyHandler.js");
          const supabase = HistoryHandler.getSupabase();
          if (supabase) {
              const { error } = await supabase
                  .from("mercadopago_payments_clients")
                  .delete()
                  .eq("id", paymentId);
              if (error) {
                  console.error(`[ganemosModule] ❌ Error al eliminar comprobante fallido ${paymentId} de la BD:`, error);
              } else {
                  console.log(`[ganemosModule] ♻️ Comprobante fallido ${paymentId} liberado en la base de datos para reintento.`);
              }
          }
      }
      
      return `❌ No se pudo procesar el depósito de $${amount} para el usuario ${username}.`;
    },

    RETIRAR: async (args: any, context: any) => {
      const username = args.username || args.usuario || args.user;
      const amount = Number(args.monto || args.amount || args.cantidad);

      console.log(`[ganemosModule] 💸 Invocando RETIRAR para: "${username}" | monto: ${amount}`);

      if (!username || !amount || isNaN(amount)) {
          return `❌ Parámetros insuficientes. Se requiere 'username' y 'monto'.`;
      }

      const success = await withdrawalUser(username, amount);
      if (success) {
          return `✅ Retiro de $${amount} procesado con éxito para el usuario ${username}.`;
      }
      return `❌ No se pudo procesar el retiro de $${amount} para el usuario ${username}.`;
    },

    // ----------------------------------------------------
    // ALIASES Y SINÓNIMOS LEGACY
    // ----------------------------------------------------
    CREAR_USUARIO: async (args: any, context: any) => ganemosModule.tools.CREAR_JUGADOR(args, context),
    RECARGAR: async (args: any, context: any) => ganemosModule.tools.DEPOSITAR(args, context),
    RETIRO: async (args: any, context: any) => ganemosModule.tools.RETIRAR(args, context),
  },

  // ----------------------------------------------------
  // NATIVE OPENAI TOOLS SCHEMAS
  // ----------------------------------------------------
  openAiTools: [
    {
      "type": "function",
      "function": {
        "name": "CREAR_JUGADOR",
        "description": "Crea una nueva cuenta de jugador en la plataforma Ganemos-net. OBLIGATORIO: Debes pedirle primero el nombre de pila al cliente. NO invocar esta función sin el nombre proporcionado por el usuario.",
        "parameters": {
          "type": "object",
          "properties": {
            "nombre": {
              "type": "string",
              "description": "Nombre de pila del cliente proporcionado explícitamente por él en el chat (ej. Lucas, Carlos, María). Prohibido inventar o enviar 'jugador'."
            }
          },
          "required": ["nombre"]
        }
      }
    },
    {
      "type": "function",
      "function": {
        "name": "DEPOSITAR",
        "description": "Carga/Deposita créditos o saldo en la cuenta de un jugador en Ganemos-net. PROHIBIDO Y ESTRICTAMENTE DENEGADO: Queda totalmente prohibido invocar esta función si el cliente no ha enviado un comprobante de transferencia y este no ha sido verificado. Si el cliente solicita recarga por texto sin adjuntar comprobante, indícale el CBU/Alias o monto mínimo y pídele que envíe el comprobante primero.",
        "parameters": {
          "type": "object",
          "properties": {
            "username": {
              "type": "string",
              "description": "Nombre de usuario exacto del jugador (ej. lucash8420)."
            },
            "monto": {
              "type": "number",
              "description": "Monto numérico exacto extraído del comprobante de transferencia verificado."
            }
          },
          "required": ["username", "monto"]
        }
      }
    },
    {
      "type": "function",
      "function": {
        "name": "RETIRAR",
        "description": "Retira/Debita créditos o saldo de la cuenta de un jugador registrado en la plataforma Ganemos-net.",
        "parameters": {
          "type": "object",
          "properties": {
            "username": {
              "type": "string",
              "description": "Nombre de usuario exacto del jugador (ej. lucash8420)."
            },
            "monto": {
              "type": "number",
              "description": "Monto numérico de créditos a retirar (ej. 300)."
            }
          },
          "required": ["username", "monto"]
        }
      }
    }
  ]
};
