const typing = async function (ctx: any, provider: any) {
    try {
        if (provider && provider?.vendor && typeof provider.vendor?.sendPresenceUpdate === 'function') {
            const id = ctx.key?.remoteJid || ctx.from;
            if (!id) return;
            
            // Si es Baileys (sherpa/baileys-provider), verificamos que el socket esté autenticado
            // Revisamos tanto 'user' como 'authState' para mayor compatibilidad
            const isBaileys = !!(provider.vendor.ev || provider.vendor.authState);
            if (isBaileys) {
                const isReady = !!(provider.vendor.user || provider.vendor.authState?.creds?.me?.id);
                if (!isReady) return;
            }

            await provider.vendor.sendPresenceUpdate('composing', id)
        }
    } catch (err: any) {
        console.warn(`[Presence] Error en typing para ${ctx.from}:`, err.message);
    }
}

const recording = async function (ctx: any, provider: any) {
    try {
        if (provider && provider?.vendor && typeof provider.vendor?.sendPresenceUpdate === 'function') {
            const id = ctx.key?.remoteJid || ctx.from;
            if (!id) return;

            const isBaileys = !!(provider.vendor.ev || provider.vendor.authState);
            if (isBaileys) {
                const isReady = !!(provider.vendor.user || provider.vendor.authState?.creds?.me?.id);
                if (!isReady) return;
            }

            await provider.vendor.sendPresenceUpdate('recording', id)
        }
    } catch (err: any) {
        console.warn(`[Presence] Error en recording para ${ctx.from}:`, err.message);
    }
}

export { typing, recording }
