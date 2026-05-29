// Clase para manejar la lógica de reconexión cuando el campo nombre está vacío
import { safeToAsk } from '../../apis/openai/openaiHelper';
import { extraerDatosResumen, GenericResumenData } from '~/utils/extractJsonData';
import { downloadFileFromDrive } from '~/apis/google/googleDriveHandler';
import { HistoryHandler } from '~/db/historyHandler';
import { AssistantResponseProcessor } from '~/apis/openai/AssistantResponseProcessor';
import fs from 'fs';

// Opciones para configurar el flujo de reconexión
interface ReconectionOptions {
    ctx: any; // Contexto del usuario
    state: any; // Estado de la conversación
    provider: any; // Proveedor de mensajería
    flowDynamic: any; // Dinamismo del flujo
    gotoFlow: any;    // Navegación de flujo
    maxAttempts?: number; // Máximo de intentos de reconexión
    timeoutMs?: number; // Tiempo de espera entre intentos (ms)
    onSuccess: (data: GenericResumenData) => Promise<void>; // Callback si se obtiene el nombre
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
    private readonly flowDynamic: any; // Dinamismo del flujo
    private readonly gotoFlow: any; // Navegación de flujo
    private readonly onSuccess: (data: GenericResumenData) => Promise<void>; // Acción al obtener nombre
    private readonly onFail: () => Promise<void>; // Acción al fallar todos los intentos
    private readonly ASSISTANT_ID = process.env.ASSISTANT_ID ?? '';

    constructor(options: ReconectionOptions) {
        this.ctx = options.ctx;
        this.state = options.state;
        this.provider = options.provider;
        this.flowDynamic = options.flowDynamic;
        this.gotoFlow = options.gotoFlow;
        this.maxAttempts = options.maxAttempts ?? 3;
        this.timeoutMs = options.timeoutMs ?? 60000;
        this.onSuccess = options.onSuccess;
        this.onFail = options.onFail;

        // Filtrar contactos ignorados antes de procesar el flujo de reconexión
        const userId = options.ctx?.from;
        if (
            /@broadcast$/.test(userId) ||
            /@newsletter$/.test(userId) ||
            /@channel$/.test(userId)
        ) {
            return;
        }
    }

    // Inicia el ciclo de reconexión
    async start() {
        // Recuperar contexto dinámico del state
        const dynamicProjectId = this.state?.get ? this.state.get('dynamicProjectId') : (this.state?.dynamicProjectId || process.env.RAILWAY_PROJECT_ID);
        const targetAssistantId = this.state?.get 
            ? this.state.get('assignedAssistantId') 
            : (this.state?.assignedAssistantId || await HistoryHandler.getConfig('ASSISTANT_ID', dynamicProjectId) || this.ASSISTANT_ID);

        // 1. Cargar mensajes de seguimiento dinámicamente si no están en process.env
        const msj1 = await HistoryHandler.getConfig('msjSeguimiento1', dynamicProjectId) || "Hola, ¿estás ahí?";
        const msj2 = await HistoryHandler.getConfig('msjSeguimiento2', dynamicProjectId) || "¿Podrías indicarme tu nombre para continuar?";
        const msj3 = await HistoryHandler.getConfig('msjSeguimiento3', dynamicProjectId) || "Parece que no podemos continuar sin tu nombre. ¡Hablamos luego!";

        const t2 = await HistoryHandler.getConfig('timeOutSeguimiento2', dynamicProjectId);
        const t3 = await HistoryHandler.getConfig('timeOutSeguimiento3', dynamicProjectId);

        // Intentar restaurar el estado previo si existe
        if (this.state && this.state.reconectionFlow) {
            this.restoreState(this.state.reconectionFlow);
        }
        const originalCtx = { ...this.ctx };
        const originalFrom = originalCtx.from;
        const jid = originalFrom && originalFrom.endsWith('@s.whatsapp.net')
            ? originalFrom
            : `${originalFrom}@s.whatsapp.net`;

        while (this.attempts < this.maxAttempts) {
            this.attempts++;
            // Guardar el estado actual de reconexión en el state global
            if (this.state) {
                this.state.reconectionFlow = this.getState();
            }
            let msg: string;
            let timeout: number;
            switch (this.attempts) {
                case 1: {
                    msg = msj1;
                    timeout = (!t2 || isNaN(Number(t2))) ? 60000 : Number(t2) * 60 * 1000;
                    break;
                }
                case 2: {
                    msg = msj2;
                    timeout = (!t3 || isNaN(Number(t3))) ? 60000 : Number(t3) * 60 * 1000;
                    break;
                }
                case 3:
                default:
                    msg = msj3;
                    timeout = 60000; // 1 minuto para el siguiente msj
                    break;
            }
            if (typeof timeout !== 'number' || isNaN(timeout)) timeout = this.timeoutMs;
            if (!msg || typeof msg !== 'string' || msg.trim() === '') {
                throw new Error(`[ReconectionFlow] El mensaje de seguimiento para el intento ${this.attempts} es vacío o inválido. Verifica tus variables de entorno.`);
            }

            // --- Lógica para detectar y descargar PDF ---
            const pdfRegex = /\[\s*PDF\s*:\s*([a-zA-Z0-9_-]+)\s*\]/gi;
            const pdfPaths: string[] = [];
            let pdfMatch;
            const originalMsg = msg;

            while ((pdfMatch = pdfRegex.exec(originalMsg)) !== null) {
                const fileId = pdfMatch[1];
                try {
                    // console.log(`[ReconectionFlow] Detectado PDF ID: ${fileId}. Descargando...`);
                    const filePath = await downloadFileFromDrive(fileId);
                    pdfPaths.push(filePath);
                } catch (err: any) {
                    // console.error(`[ReconectionFlow PDF] Error con ID ${fileId}:`, err.message);
                }
            }

            // Limpiar el mensaje de etiquetas PDF para el envío de texto
            const cleanMsg = originalMsg.replace(/\[\s*PDF\s*:\s*[\s\S]*?\]/gi, "").trim();

            if (jid) {
                try {
                    // console.log(`[ReconectionFlow] Enviando mensaje de reconexión a:`, jid);
                    await this.provider.sendText(jid, cleanMsg);
                    // Persistir en el historial del backoffice (vía Supabase)
                    await HistoryHandler.saveMessage(this.ctx.from, 'assistant', cleanMsg, 'text', null, null, null, 'whatsapp', dynamicProjectId);

                    // Enviar los PDFs descargados
                    for (const pdfPath of pdfPaths) {
                        try {
                            // console.log(`[ReconectionFlow] Enviar archivo: ${pdfPath}`);
                            // Usamos sendFile si el provider lo soporta, o sendMessage con media (común en Baileys)
                            if (this.provider.sendFile) {
                                await this.provider.sendFile(jid, pdfPath, "📄 Documento adjunto");
                            } else {
                                await this.provider.sendText(jid, "📄 Documento adjunto:", { media: pdfPath });
                            }
                            
                            // Persistir referencia al documento en el historial
                            await HistoryHandler.saveMessage(this.ctx.from, 'assistant', "[Documento PDF]", 'document', null, null, null, 'whatsapp', dynamicProjectId);
                            
                            // Limpieza del archivo temporal después de un breve delay para asegurar envío
                            setTimeout(() => {
                                if (fs.existsSync(pdfPath)) {
                                    fs.unlinkSync(pdfPath);
                                    // console.log(`[ReconectionFlow] Archivo temporal borrado: ${pdfPath}`);
                                }
                            }, 5000);
                        } catch (mediaErr) {
                            // console.error(`[ReconectionFlow Media] Error enviando media ${pdfPath}:`, mediaErr);
                        }
                    }
                } catch (err) {
                    // console.error(`[ReconectionFlow] Error enviando mensaje de reconexión a ${jid}:`, err);
                }
            } else {
                // console.warn('[ReconectionFlow] Contexto inválido, no se puede enviar mensaje de reconexión.');
            }
            // console.log(`[ReconectionFlow] Intento ${this.attempts} de ${this.maxAttempts} para ${jid} | Timeout: ${timeout}ms`);

            // Espera el timeout o la respuesta del usuario, lo que ocurra primero
            const userResponded = await this.waitForUserResponse(jid, timeout);
            if (userResponded) {
                // Limpiar el estado de reconexión y delegar la navegación al callback onSuccess
                if (this.state) delete this.state.reconectionFlow;
                // Llama al callback onSuccess, que debe encargarse de la navegación
                await this.onSuccess({});
                return;
            }

            // Si no respondió, intentar obtener el resumen nuevamente desde el asistente
            console.log(`[ReconectionFlow] 🤖 Generando resumen con Asistente: ${targetAssistantId} | Proyecto: ${dynamicProjectId}`);

            const resumen = await safeToAsk(targetAssistantId, "GET_RESUMEN", this.state, this.ctx.from, undefined, 5, false, dynamicProjectId, true) as string;
            const data: GenericResumenData = extraerDatosResumen(resumen);
            const tipo = data.tipo || "SI_RESUMEN";
            if (tipo === "SI_RESUMEN") {
                if (this.state) delete this.state.reconectionFlow;
                await this.onSuccess(data);
                return;
            } else if (tipo === "NO_REPORTAR_BAJA") {
                if (this.state) delete this.state.reconectionFlow;
                // No hacer nada más, terminar el ciclo
                await this.onFail();
                return;
            } else if (tipo === "NO_REPORTAR_SEGUIR") {
                // No relanzar idleFlow ni nueva instancia, continuar el ciclo en esta misma instancia
                // Simplemente continuar el while para el siguiente intento de seguimiento
                continue;
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
                try {
                    // No procesamos la respuesta aquí para evitar doble respuesta, 
                    // ya que al retornar resolve(true), el flujo derivará a welcomeFlowTxt
                    // que se encargará del procesamiento normal.
                } catch (err) {
                    // console.error('[ReconectionFlow] Error en onMessage del reconector:', err);
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