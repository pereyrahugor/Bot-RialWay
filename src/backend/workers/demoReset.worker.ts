import cron from 'node-cron';
import { seedDemoService, DEMO_PROJECT_ID, DEMO_SERVICE_ID } from '../scripts/demoSeeder';

/**
 * Worker para el reinicio automático diario del entorno de demostración.
 * Se ejecuta todas las madrugadas a las 03:00 AM (hora de Argentina / 06:00 UTC).
 */
export class DemoResetWorker {
    private static isRunning = false;

    public static initCron() {
        console.log('⏰ [DemoResetWorker] Inicializando programador de reset nocturno para la demo (03:00 AM ARG)...');

        // Cron: Todos los días a las 03:00 AM hora de Argentina (America/Argentina/Buenos_Aires)
        cron.schedule('0 3 * * *', async () => {
            console.log('🌙 [DemoResetWorker] Ejecutando reset nocturno automático del servicio de demo...');
            try {
                await DemoResetWorker.resetDemo();
            } catch (err: any) {
                console.error('❌ [DemoResetWorker] Error en el reset nocturno:', err?.message || err);
            }
        }, {
            timezone: 'America/Argentina/Buenos_Aires'
        });
    }

    public static async resetDemo(): Promise<{ success: boolean; message: string; leadsCount: number }> {
        if (this.isRunning) {
            console.warn('⚠️ [DemoResetWorker] Ya hay un proceso de reinicio de demo en curso.');
            return { success: false, message: 'Reinicio en curso', leadsCount: 0 };
        }

        this.isRunning = true;
        try {
            console.log(`🔄 [DemoResetWorker] Ejecutando reinicio para service ${DEMO_SERVICE_ID}...`);
            const res = await seedDemoService(DEMO_PROJECT_ID, DEMO_SERVICE_ID);
            console.log('✅ [DemoResetWorker] Demo restablecida exitosamente:', res);
            return res;
        } finally {
            this.isRunning = false;
        }
    }
}
