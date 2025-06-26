// Clase para manejar la lógica de reconexión cuando el campo nombre está vacío
import { toAsk } from '@builderbot-plugins/openai-assistants';
import { extraerDatosResumen } from '~/utils/extractJsonData';
import { ResumenData } from '~/utils/googleSheetsResumen';

// Opciones para configurar el flujo de reconexión
interface ReconectionOptions {
    ctx: any; // Contexto del usuario
    state: any; // Estado de la conversación
    provider: any; // Proveedor de mensajería
    maxAttempts?: number; // Máximo de intentos de reconexión
    timeoutMs?: number; // Tiempo de espera entre intentos (ms)
    onSuccess: (data: ResumenData) => Promise<void>; // Callback si se obtiene el nombre
    onFail: () => Promise<void>; // Callback si se alcanzan los intentos máximos
}

// Clase principal para el ciclo de reconexión
export class ReconectionFlow {
    private attempts = 0; // Contador de intentos realizados
    private readonly maxAttempts: number; // Máximo de intentos permitidos
    private readonly timeoutMs: number; // Tiempo de espera entre intentos
    private readonly ctx: any; // Contexto del usuario
    private readonly state: any; // Estado de la conversación
    private readonly provider: any; // Proveedor de mensajería
    private readonly onSuccess: (data: ResumenData) => Promise<void>; // Acción al obtener nombre
    private readonly onFail: () => Promise<void>; // Acción al fallar todos los intentos
    private readonly ASSISTANT_ID = process.env.ASSISTANT_ID ?? '';
    private readonly MsjSeguimiento1 = process.env.MsjSeguimiento1 ?? '';
    private readonly MsjSeguimiento2 = process.env.MsjSeguimiento2 ?? '';
    private readonly MsjSeguimiento3 = process.env.MsjSeguimiento3 ?? '';

    constructor(options: ReconectionOptions) {
        this.ctx = options.ctx;
        this.state = options.state;
        this.provider = options.provider;
        this.maxAttempts = options.maxAttempts ?? 3;
        this.timeoutMs = options.timeoutMs ?? 60000;
        this.onSuccess = options.onSuccess;
        this.onFail = options.onFail;
    }

    // Inicia el ciclo de reconexión
    async start() {
        // Intentar restaurar el estado previo si existe
        if (this.state && this.state.reconectionFlow) {
            this.restoreState(this.state.reconectionFlow);
            console.log('[ReconectionFlow] Estado restaurado:', this.state.reconectionFlow);
        }
        const originalCtx = { ...this.ctx };
        const originalFrom = originalCtx.from;
        const jid = originalFrom && originalFrom.endsWith('@s.whatsapp.net')
            ? originalFrom
            : `${originalFrom}@s.whatsapp.net`;
        console.log(`[ReconectionFlow] originalCtx.from:`, originalFrom, '| jid usado:', jid);
        while (this.attempts < this.maxAttempts) {
            this.attempts++;
            // Guardar el estado actual de reconexión en el state global
            if (this.state) {
                this.state.reconectionFlow = this.getState();
            }
            let msg: string;
            let timeout: number;
            switch (this.attempts) {
                case 1:
                    msg = this.MsjSeguimiento1;
                    timeout = Number(process.env.timeOutSeguimiento2) * 60 * 1000;
                    break;
                case 2:
                    msg = this.MsjSeguimiento2;
                    timeout = Number(process.env.timeOutSeguimiento3) * 60 * 1000;
                    break;
                case 3:
                default:
                    msg = this.MsjSeguimiento3;
                    timeout = 60000; // 1 minuto para el siguiente msj
                    break;
            }
            if (typeof timeout !== 'number' || isNaN(timeout)) timeout = this.timeoutMs;
            if (jid) {
                try {
                    console.log(`[ReconectionFlow] Enviando mensaje de reconexión a:`, jid);
                    await this.provider.sendText(jid, msg);
                } catch (err) {
                    console.error(`[ReconectionFlow] Error enviando mensaje de reconexión a ${jid}:`, err);
                }
            } else {
                console.warn('[ReconectionFlow] Contexto inválido, no se puede enviar mensaje de reconexión.');
            }
            console.log(`[ReconectionFlow] Intento ${this.attempts} de ${this.maxAttempts} para ${jid} | Timeout: ${timeout}ms`);

            // Espera el timeout o la respuesta del usuario, lo que ocurra primero
            const userResponded = await this.waitForUserResponse(jid, timeout);
            if (userResponded) {
                // Limpiar el estado de reconexión al éxito
                if (this.state) delete this.state.reconectionFlow;
                const resumen = await toAsk(this.ASSISTANT_ID, "GET_RESUMEN", this.state);
                const data: ResumenData = extraerDatosResumen(resumen);
                await this.onSuccess(data);
                return;
            }

            // Si no respondió, intentar obtener el resumen nuevamente desde el asistente
            const resumen = await toAsk(this.ASSISTANT_ID, "GET_RESUMEN", this.state);
            const data: ResumenData = extraerDatosResumen(resumen);
            const nombreInvalido = !data.nombre || data.nombre.trim() === "" ||
                data.nombre.trim() === "- Nombre:" ||
                data.nombre.trim() === "- Interés:" ||
                data.nombre.trim() === "- Nombre de la Empresa:" ||
                data.nombre.trim() === "- Cargo:";
            if (!nombreInvalido) {
                if (this.state) delete this.state.reconectionFlow;
                await this.onSuccess(data);
                return;
            }
        }
        // Limpiar el estado de reconexión al fallar
        if (this.state) delete this.state.reconectionFlow;
        await this.onFail();
    }

    /**
     * Espera la respuesta del usuario o el timeout, lo que ocurra primero.
     * Sólo considera mensajes de usuario reales (no vacíos, no de bots, no de grupos, no de broadcasts, no de sistemas).
     */
    private waitForUserResponse(jid: string, timeout: number): Promise<boolean> {
        return new Promise((resolve) => {
            let responded = false;
            // Suscribirse a los mensajes entrantes del usuario
            const onMessage = async (msg: any) => {
                // Filtro robusto de mensajes
                const msgFrom = msg.from && msg.from.endsWith('@s.whatsapp.net') ? msg.from : `${msg.from}@s.whatsapp.net`;
                // Ignorar mensajes de grupos, broadcasts, sistemas, bots o vacíos
                if (
                    msgFrom !== jid ||
                    msg.isGroup ||
                    msg.isBroadcast ||
                    msg.isSystem ||
                    msg.isBot ||
                    !msg.body || typeof msg.body !== 'string' || msg.body.trim() === ''
                ) {
                    return;
                }
                // Enviar el mensaje recibido al asistente como "hola, [msj]"
                const userMsg = msg.body;
                const prompt = `hola, ${userMsg}`;
                try {
                    await toAsk(this.ASSISTANT_ID, prompt, this.state);
                } catch (err) {
                    console.error('[ReconectionFlow] Error enviando mensaje al asistente:', err);
                }
                responded = true;
                if (this.provider.off) this.provider.off('message', onMessage);
                clearTimeout(timer);
                resolve(true);
            };
            if (this.provider.on) this.provider.on('message', onMessage);

            // Timeout
            const timer = setTimeout(() => {
                if (!responded) {
                    if (this.provider.off) this.provider.off('message', onMessage);
                    resolve(false);
                }
            }, timeout);
        });
    }

    /**
     * Devuelve el estado serializable del flujo de reconexión para persistencia.
     */
    public getState() {
        return {
            attempts: this.attempts,
            // Puedes agregar más campos si necesitas persistir más información
        };
    }

    /**
     * Restaura el estado serializable del flujo de reconexión.
     */
    public restoreState(state: any) {
        if (state && typeof state.attempts === 'number') {
            this.attempts = state.attempts;
        }
    }
}