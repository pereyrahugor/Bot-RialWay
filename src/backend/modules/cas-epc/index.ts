import { createUserSelenium } from "../../apis/external/Cas-EPC/createUser-Selenium.js";
import { rechargeUserSelenium } from "../../apis/external/Cas-EPC/rechargeUser-Selenium.js";
import { withdrawalUser } from "../../apis/external/Cas-EPC/withdrawalUser-Selunium.js";

export const casEpcModule = {
  key: "cas-epc",
  label: "Cas - EPC",

  tools: {
    // ----------------------------------------------------
    // LOWERCASE WRAPPERS (Para invocación por código)
    // ----------------------------------------------------
    crearJugador: async (args: any, context: any) => casEpcModule.tools.CREAR_JUGADOR(args, context),
    depositar: async (args: any, context: any) => casEpcModule.tools.DEPOSITAR(args, context),
    retirar: async (args: any, context: any) => casEpcModule.tools.RETIRAR(args, context),

    // ----------------------------------------------------
    // CORE TOOLS (Para mapear respuestas del Asistente OpenAI)
    // ----------------------------------------------------
    CREAR_JUGADOR: async (args: any, context: any) => {
      const nombre = args.nombre || args.baseName || args.username || 'jugador';

      console.log(`[casEpcModule] 👤 Invocando CREAR_JUGADOR para: "${nombre}"`);
      
      const res = await createUserSelenium(nombre, false);
      if (res) {
          const chatId = context?.ctx?.from;
          const projectId = context?.projectId;
          if (chatId) {
              try {
                  const { HistoryHandler } = await import("../../db/historyHandler.js");
                  await HistoryHandler.updateContactDetails(chatId, { cuit_dni: res.username }, projectId);
                  console.log(`[casEpcModule] 💾 Guardado usuario ${res.username} en chats.cuit_dni para ${chatId}`);
              } catch (dbErr: any) {
                  console.error(`[casEpcModule] ❌ Error guardando usuario de jugador en BD:`, dbErr.message);
              }
          }
          return `✅ Usuario ${res.username} creado con éxito. Contraseña por defecto: "${res.password}".`;
      }
      return `❌ No se pudo completar la creación del usuario.`;
    },

    DEPOSITAR: async (args: any, context: any) => {
      const username = args.username || args.usuario || args.user;
      const amount = Number(args.monto || args.amount || args.cantidad);

      console.log(`[casEpcModule] 💰 Invocando DEPOSITAR para: "${username}" | monto: ${amount}`);

      if (!username || !amount || isNaN(amount)) {
          return `❌ Parámetros insuficientes. Se requiere 'username' y 'monto'.`;
      }

      const success = await rechargeUserSelenium(username, amount);
      if (success) {
          return `✅ Depósito de $${amount} procesado con éxito para el usuario ${username}.`;
      }
      return `❌ No se pudo procesar el depósito de $${amount} para el usuario ${username}.`;
    },

    RETIRAR: async (args: any, context: any) => {
      const username = args.username || args.usuario || args.user;
      const amount = Number(args.monto || args.amount || args.cantidad);

      console.log(`[casEpcModule] 💸 Invocando RETIRAR para: "${username}" | monto: ${amount}`);

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
    CREAR_USUARIO: async (args: any, context: any) => casEpcModule.tools.CREAR_JUGADOR(args, context),
    RECARGAR: async (args: any, context: any) => casEpcModule.tools.DEPOSITAR(args, context),
    RETIRO: async (args: any, context: any) => casEpcModule.tools.RETIRAR(args, context),
  },

  // ----------------------------------------------------
  // NATIVE OPENAI TOOLS SCHEMAS
  // ----------------------------------------------------
  openAiTools: [
    {
      "type": "function",
      "function": {
        "name": "CREAR_JUGADOR",
        "description": "Crea una nueva cuenta de jugador en la plataforma Cas - EPC.",
        "parameters": {
          "type": "object",
          "properties": {
            "nombre": {
              "type": "string",
              "description": "Nombre de pila o base del cliente para generar su usuario (ej. lucas)."
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
        "description": "Carga/Deposita créditos o saldo en la cuenta de un jugador registrado en la plataforma Cas - EPC.",
        "parameters": {
          "type": "object",
          "properties": {
            "username": {
              "type": "string",
              "description": "Nombre de usuario exacto del jugador (ej. lucash8420)."
            },
            "monto": {
              "type": "number",
              "description": "Monto numérico de créditos a depositar (ej. 500)."
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
        "description": "Retira/Debita créditos o saldo de la cuenta de un jugador registrado en la plataforma Cas - EPC.",
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
