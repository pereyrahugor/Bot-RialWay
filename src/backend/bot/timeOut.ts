import { BotContext, TFlow } from '@builderbot/bot/dist/types';
import { idleFlow } from '~/bot/flows/idleFlow';
import "dotenv/config";

// Object to store timers for each user
// Objeto para almacenar temporizadores para cada usuario
const timers: Record<string, NodeJS.Timeout> = {};
// Flow for handling inactivity
// Flujo para el manejo de la inactividad

// Function to start the inactivity timer for a user
// Función para iniciar el temporizador de inactividad de un usuario
const start = (ctx: BotContext, gotoFlow: (a: TFlow) => Promise<void>, ms: number) => {
    // Si ms no es un número válido o es <= 0, usamos un valor por defecto seguro (45 min)
    // Esto evita que el flujo de inactividad se dispare inmediatamente tras cada mensaje.
    let finalMs = ms;
    if (isNaN(ms) || ms <= 0) {
        console.warn(`⚠️ [TimeOut] Valor de timeout inválido (${ms}). Usando 45 minutos por defecto.`);
        finalMs = 45 * 60 * 1000;
    }
    
    // Evitar timeouts extremadamente cortos que parezcan errores (menos de 10 segundos)
    if (finalMs < 10000) {
        console.warn(`⚠️ [TimeOut] Valor de timeout demasiado corto (${finalMs}ms). Ajustando a 10 segundos.`);
        finalMs = 10000;
    }

    timers[ctx.from] = setTimeout(() => {
        return gotoFlow(idleFlow);
    }, finalMs);
};

// Function to reset the inactivity timer for a user
// Función para restablecer el temporizador de inactividad de un usuario
const reset = (ctx: BotContext, gotoFlow: (a: TFlow) => Promise<void>, ms: number) => {
    stop(ctx);
    if (timers[ctx.from]) {
        // console.log(`Contador reseteado del usuario: ${ctx.from}`)
        clearTimeout(timers[ctx.from]);
    }
    start(ctx, gotoFlow, ms);
    return ctx;
};

// Function to stop the inactivity timer for a user
// Función para detener el temporizador de inactividad para un usuario
const stop = (ctx: BotContext) => {
    if (timers[ctx.from]) {
        clearTimeout(timers[ctx.from]);
    }
};

export {
    start,
    reset,
    stop,
}
