import path from 'path';
import fs from 'fs';
import QRCode from 'qrcode';
import { EVENTS } from "@builderbot/bot";
import { isSessionInDb } from "../utils/sessionSync";

/**
 * Registra los listeners de los proveedores (Meta/Baileys) para QR, fallos y mensajes entrantes.
 */
export const registerProviderEvents = (provider: any, isGroupProvider: boolean = false) => {
    let isGeneratingQR = false;
    const prefix = isGroupProvider ? '[GroupProvider]' : '[AdapterProvider]';

    const handleQR = async (payload: any) => {
        if (isGeneratingQR) return;
        isGeneratingQR = true;

        try {
            let qrString = null;
            if (typeof payload === 'string') qrString = payload;
            else if (payload?.qr) qrString = payload.qr;
            else if (payload?.code) qrString = payload.code;

            if (qrString && typeof qrString === 'string') {
                provider.qrCodeString = qrString;
                const qrFilename = isGroupProvider ? 'bot.groups.qr.png' : 'bot.qr.png';
                const qrPath = path.join(process.cwd(), qrFilename);
                await QRCode.toFile(qrPath, qrString, {
                    color: { dark: '#000000', light: '#ffffff' },
                    scale: 4,
                    margin: 2
                });
                console.log(`${prefix} ✅ QR guardado en ${qrPath}`);
            }
        } catch (err) {
            console.error(`❌ ${prefix} Error generating QR image:`, err);
        } finally {
            isGeneratingQR = false;
        }
    };

    provider.on('qr', handleQR);
    provider.on('require_action', handleQR);
    provider.on('auth_require', handleQR);

    provider.on('message', (ctx: any) => {
        // Aquí podríamos normalizar mensajes si fuera necesario (como en Bot-ApiSWS)
        // Por ahora mantenemos la lógica estándar de Builderbot
    });

    provider.on('ready', () => {
        console.log(`✅ ${prefix} READY: El proveedor está conectado.`);
        const qrFilename = isGroupProvider ? 'bot.groups.qr.png' : 'bot.qr.png';
        const qrPath = path.join(process.cwd(), qrFilename);
        if (fs.existsSync(qrPath)) {
            try { fs.unlinkSync(qrPath); } catch (e) {
                // Silently ignore if file doesn't exist
            }
        }
    });
};

/**
 * Verifica si existe una sesión activa y devuelve el estado para el dashboard.
 */
export const hasActiveSession = async (adapterProvider: any, groupProvider: any = null) => {
    try {
        const getStatus = async (provider: any, isGroup: boolean) => {
            if (!provider) return null;
            
            const isMeta = provider.constructor.name === 'MetaCloudProvider';
            const isReady = !!(provider?.vendor?.user || provider?.globalVendorArgs?.sock?.user);

            if (isMeta) return { active: true, type: 'meta', message: 'Conectado via API' };

            const qrFilename = isGroup ? 'bot.groups.qr.png' : 'bot.qr.png';
            const hasQr = fs.existsSync(path.join(process.cwd(), qrFilename));
            const qrString = provider.qrCodeString || null;

            if (isReady) return { active: true, type: 'baileys', message: 'Conectado' };

            if (hasQr || qrString) {
                let qrImage = null;
                if (qrString) {
                    try { qrImage = await QRCode.toDataURL(qrString); } catch (e) {
                    // Ignore QR generation errors
                }
                }
                return { active: false, qr: true, qrData: qrString, qrImage, type: 'baileys', message: 'Esperando vinculación' };
            }

            return { active: false, type: 'baileys', message: 'Iniciando motor...' };
        };

        const adapterStatus = await getStatus(adapterProvider, false);
        const groupStatus = await getStatus(groupProvider, true);

        return {
            adapter: adapterStatus,
            group: groupStatus
        };
    } catch (error: any) {
        return { active: false, error: error.message };
    }
};
