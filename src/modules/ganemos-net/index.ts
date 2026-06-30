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
      const nombre = args.nombre || args.baseName || args.username || 'jugador';
      const recharge = args.recharge === true || args.recharge === 'true';
      const monto = Number(args.monto || args.amount || 0);

      console.log(`[ganemosModule] 👤 Invocando CREAR_JUGADOR para: "${nombre}" | recharge: ${recharge} | monto: ${monto}`);
      
      const res = await createUserSelenium(nombre, recharge);
      if (res) {
          if (recharge && monto > 0 && res.driver) {
              console.log(`[ganemosModule] 🔗 Reutilizando driver para recarga automática de $${monto} a ${res.username}...`);
              const rechargeRes = await rechargeUserSelenium(res.username, monto, res.driver);
              if (rechargeRes) {
                  return `✅ Usuario ${res.username} creado con éxito y recargado con $${monto}. Contraseña por defecto: "${res.password}".`;
              } else {
                  return `⚠️ Usuario ${res.username} creado con éxito (Contraseña: "${res.password}"), pero falló la recarga automática inicial de $${monto}.`;
              }
          } else {
              // Si no se requirió recarga o monto es 0, el driver ya fue cerrado por createUserSelenium
              return `✅ Usuario ${res.username} creado con éxito. Contraseña por defecto: "${res.password}".`;
          }
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
  }
};
