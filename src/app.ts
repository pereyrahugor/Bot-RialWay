import "dotenv/config";
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";
import multer from "multer";
import OpenAI from "openai";
import { BaileysProvider } from "builderbot-provider-sherpa";
import { createBot, createProvider, createFlow, MemoryDB } from "@builderbot/bot";
import { httpInject } from "@builderbot-plugins/openai-assistants";
import { SupabaseBaileysProvider } from "./providers/SupabaseBaileysProvider";
import { MetaCloudProvider } from "./providers/MetaCloudProvider";
import { setAdapterProvider, setGroupProvider, getAdapterProvider, getGroupProvider } from "./providers/instances";

// --- Utils & Handlers ---
import { restoreSessionFromDb, startSessionSync, deleteSessionFromDb, isSessionInDb } from "./providers/sessionSync";
import { ErrorReporter } from "./bot/errorReporter";
import { updateMain } from "./apis/google/updateMain";
import { WebChatManager } from "./backoffice";
import { HistoryHandler } from "./db/historyHandler";
import { registerProcessCallback, handleQueue, userQueues, userLocks } from "./bot/queueManager";

// --- Managers & Routes ---
import { processSendMessage, processBulkTemplate, processImportExcel, BackofficeDependencies } from "./backoffice/routes/backoffice.routes";
import { mountBackoffice } from "./backoffice/index";
import { registerRailwayRoutes } from "./apis/railway/railway.routes";
import { safeToAsk } from "./apis/openai/openaiHelper";
import { AssistantResponseProcessor } from "./apis/openai/AssistantResponseProcessor";
import { transcribeAudioFile } from "./apis/openai/audioTranscriptior";
import { withRetry } from "./utils/retryHelper";
import { initSocketIO } from "./sockets/socket.manager";
import { registerProviderEvents, hasActiveSession } from "./providers/provider.manager";
import { startHumanInactivityWorker } from "./workers/humanInactivity.worker";
import { startFileCleanupWorker } from "./workers/fileCleanup.worker";
import { AiManager } from "./bot/ai.manager";
import { registerExternalApiRoutes } from "./apis/external/external_api.routes";
import { syncAssistantTools, getOpenAI, getOpenAIVision } from "./apis/openai/openaiHelper";
import { discoverMetaIds } from "./apis/meta/metaDiscovery";
import { RailwayApi } from "./apis/railway/Railway";
import { smartBodyParser, compatibilityLayer, rootRedirect } from "./middleware/global";
import { backofficeAuth } from "./backoffice/middleware/auth";
import bodyParser from 'body-parser';

// --- Flows ---
import { welcomeFlowTxt } from "./bot/flows/welcomeFlowTxt";
import { welcomeFlowVoice } from "./bot/flows/welcomeFlowVoice";
import { welcomeFlowImg } from "./bot/flows/welcomeFlowImg";
import { welcomeFlowVideo } from "./bot/flows/welcomeFlowVideo";
import { welcomeFlowDoc } from "./bot/flows/welcomeFlowDoc";
import { locationFlow } from "./bot/flows/locationFlow";
import { idleFlow } from "./bot/flows/idleFlow";
import { welcomeFlowButton } from "./bot/flows/welcomeFlowButton";
import { reset } from "./bot/timeOut";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

// Global instances
export let adapterProvider: any;
export let groupProvider: any;
export let errorReporter: any;
export let aiManagerInstance: AiManager;
const webChatManager = new WebChatManager();

// Las instancias de OpenAI se resuelven dinámicamente vía openaiHelper
// const PORT = process.env.PORT || 8080;

// Multer config
const upload = multer({ 
    storage: multer.diskStorage({
        destination: (_req, _file, cb) => {
            const dir = "uploads/";
            if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
            cb(null, dir);
        },
        filename: (_req, file, cb) => {
            const ext = path.extname(file.originalname);
            cb(null, `${Date.now()}-${Math.round(Math.random() * 1E9)}${ext}`);
        }
    })
});

// Error handling setup
function registerSafeErrorHandlers() {
    process.removeAllListeners("uncaughtException");
    process.removeAllListeners("unhandledRejection");
    process.on("uncaughtException", (error) => {
        console.error(`⚠️ [UncaughtException] ${new Date().toISOString()}:`, error);
    });
    process.on("unhandledRejection", (reason) => {
        console.error(`⚠️ [UnhandledRejection] ${new Date().toISOString()}:`, reason);
    });
}

/**
 * Main function for Bot and Server Orchestration
 */
const main = async () => {
    // 1. Storage cleanup and session restoration
    // Await initDatabase so settings/variables are loaded from DB first
    try {
        await HistoryHandler.initDatabase();
    } catch (err) {
        console.warn('[App] initDatabase error:', err);
    }
    const PORT = process.env.PORT || 8080;
    
    // El proceso de sincronización de tools se movió más abajo para asegurar que todas las variables estén recuperadas.
    // await syncAssistantTools(ASSISTANT_ID); // MOVIDO

    
    // Usar un nombre de sesión consistente para evitar desajustes entre SessionSync y el Provider
    // Sanitizar para evitar caracteres inválidos en rutas (como *)
    const rawSessionName = await HistoryHandler.getConfig('BOT_NAME') || await HistoryHandler.getConfig('ASSISTANT_NAME') || 'bot';
    const SESSION_NAME = rawSessionName.replace(/[^a-zA-Z0-9_-]/g, '_');
    
    // await restoreSessionFromDb(SESSION_NAME);
    const qrPath = path.join(process.cwd(), "bot.qr.png");

    // Usar versión fija conocida que funciona
    const baileysVersion: any = [2, 3000, 1038711718];
    console.log(`📡 [App] Usando versión fija de WhatsApp Web: ${baileysVersion.join('.')}`);

    // 2. Initialize Providers
    const metaConfig = await HistoryHandler.getMetaOnboardingData();
    
    // Fallback: Si no hay config en DB o falta el token, intentamos usar variables de entorno
    const metaToken = (metaConfig?.access_token && metaConfig.access_token !== "PENDING") ? metaConfig.access_token : process.env.META_ACCESS_TOKEN;
    let metaPhoneId = (metaConfig?.phone_number_id && metaConfig.phone_number_id !== "PENDING") ? metaConfig.phone_number_id : process.env.META_PHONE_ID;
    let metaWabaId = (metaConfig?.waba_id && metaConfig.waba_id !== "PENDING") ? metaConfig.waba_id : process.env.META_WABA_ID;

    // --- AUTO-DESCUBRIMIENTO DE META ---
    if (metaToken && (!metaPhoneId || metaPhoneId === 'PENDING' || !metaWabaId || metaWabaId === 'PENDING')) {
        console.log('📡 [App] Detectada configuración de Meta parcial. Iniciando recuperación automática de IDs...');
        try {
            const mainToken = await HistoryHandler.getMainToken();
            const appId = await HistoryHandler.getConfig('META_APP_ID') || '1493670789148486';
            const appSecret = await HistoryHandler.getConfig('META_APP_SECRET') || '362b2ec20c00bdf51336fd165ad47160';
            const discovery = await discoverMetaIds(metaToken, mainToken, appId, appSecret);
            if (discovery && discovery.data?.phoneNumberId && discovery.data?.wabaId) {
                console.log(`✅ [App] Recuperación exitosa: PhoneID=${discovery.data.phoneNumberId}, WABAID=${discovery.data.wabaId}`);
                metaPhoneId = discovery.data.phoneNumberId;
                metaWabaId = discovery.data.wabaId;
                await HistoryHandler.saveMetaOnboardingData(metaWabaId, metaPhoneId, metaToken, { ...discovery.data, syncedAt: new Date().toISOString() });
            }
        } catch (e: any) {
            console.error('⚠️ [App] Error en auto-descubrimiento de Meta:', e.message);
        }
    }

    const useMeta = !!metaToken && !!metaPhoneId && metaPhoneId !== 'PENDING';

    if (useMeta) {
        console.log('🚀 [App] Modo Dual detectado (Meta API + Baileys Grupos)');
        adapterProvider = createProvider(MetaCloudProvider, {
            waba_id: metaWabaId || "PENDING",
            phone_number_id: metaPhoneId,
            access_token: metaToken,
            verify_token: process.env.META_VERIFY_TOKEN || "BotRialWayVerifyToken2026"
        });
        
        // --- CONFIGURACIÓN DE GRUPOS (AUXILIAR) ---
        // Solo crear proveedor de grupos si hay una configuración de Meta realmente persistida 
        const hasMetaSession = metaConfig && metaConfig.access_token && metaConfig.access_token !== 'PENDING' && metaConfig.phone_number_id !== 'PENDING';
        
        if (hasMetaSession) {
            console.log('🔗 [App] Inicializando conexión auxiliar para grupos...');
            groupProvider = createProvider(SupabaseBaileysProvider, {
                name: `${SESSION_NAME}_groups`, 
                ...(baileysVersion ? { version: baileysVersion } : {}),
                groupsIgnore: false,
                readStatus: false,
                disableHttpServer: true,
            });
            setGroupProvider(groupProvider);
        } else {
            console.log('⚠️ [App] Meta detectado en env pero no hay sesión activa en DB. Saltando conexión auxiliar de grupos.');
            groupProvider = null;
            setGroupProvider(null);
        }
    } else {
        console.log('🚀 [App] Modo Estándar detectado (Baileys para todo)');
        adapterProvider = createProvider(SupabaseBaileysProvider, {
            name: SESSION_NAME, 
            ...(baileysVersion ? { version: baileysVersion } : {}),
            groupsIgnore: false,
            readStatus: false,
            disableHttpServer: true,
        });
        groupProvider = null;
        setGroupProvider(null);
    }
    
    setAdapterProvider(adapterProvider);

    // 3. Register Provider Events
    registerProviderEvents(adapterProvider);

    // --- INICIALIZACIÓN DE MOTORES ---
    // Importante: Llamar a initVendor explícitamente solo una vez aquí si existe una sesión previa en la base de datos.
    const hasAdapterSession = await isSessionInDb(SESSION_NAME);
    if (adapterProvider.initVendor) {
        if (hasAdapterSession) {
            console.log('🚀 [App] Sesión previa detectada. Inicializando Motor Principal (Baileys)...');
            await adapterProvider.initVendor();
        } else {
            console.log('ℹ️ [App] No se detectó sesión previa en base de datos para el Motor Principal (Baileys). Esperando a que el usuario inicie generación de QR desde el Backoffice.');
            adapterProvider.preventAutoStart = true;
        }
    }

    if (groupProvider) {
        registerProviderEvents(groupProvider, true);
        const hasGroupSession = await isSessionInDb(`${SESSION_NAME}_groups`);
        if (groupProvider.initVendor) {
            if (hasGroupSession) {
                console.log('🚀 [App] Sesión previa detectada. Inicializando Motor de Grupos (Baileys Auxiliar)...');
                await groupProvider.initVendor();
            } else {
                console.log('ℹ️ [App] No se detectó sesión previa en base de datos para el Motor de Grupos (Baileys Auxiliar). Esperando a que el usuario inicie generación de QR desde el Backoffice.');
                groupProvider.preventAutoStart = true;
            }
        }
    }

    // 4. Initialize Database and Configuration (Ya inicializado arriba)

    
    const groupResumenId = await HistoryHandler.getConfig('ID_GRUPO_RESUMEN') || "";
    errorReporter = new ErrorReporter(adapterProvider, groupResumenId);
    await updateMain();
    
    // 4.1. Sincronizar herramientas con OpenAI Assistant (Ahora que el entorno está listo)
    const ASSISTANT_ID = await HistoryHandler.getConfig('ASSISTANT_ID');
    if (ASSISTANT_ID) {
        console.log(`[App] 🔄 Iniciando sincronización de tools para Assistant: ${ASSISTANT_ID}`);
        await syncAssistantTools(ASSISTANT_ID);
    }


    const app = adapterProvider.server;
    if (app) {
        // 5. Polka/Express Server setup & Early Middlewares
        app.use(compatibilityLayer);
        app.use(rootRedirect);

        // --- MASTER-INTERCEPTOR DE STREAMS (EL PRIMERO SIEMPRE) ---
        app.use((req: any, res: any, next: any) => {
            const normalizedPath = (req.url || '').split('?')[0].replace(/\/+/g, '/');
            const isBulk = normalizedPath.includes('/api/backoffice/whatsapp/send-bulk-template');
            const isSend = normalizedPath.includes('/api/backoffice/send-message');
            const isImport = normalizedPath.includes('/api/backoffice/chats/import');

            if ((isSend || isBulk || isImport) && req.method === 'POST') {
                req.setTimeout(0);
                console.log(`🛡️ [MASTER-INTERCEPTOR-PRIORITY] Bypass activo para: ${normalizedPath}`);
                
                return backofficeAuth(req, res, async () => {
                    const contentType = req.headers['content-type'] || '';
                    const openaiMainDynamic = await getOpenAI();
                    const deps: BackofficeDependencies = { adapterProvider, groupProvider, HistoryHandler, openaiMain: openaiMainDynamic, upload };

                    // Sincronizar Meta Provider antes de procesar si es necesario
                    const pId = req.query.projectId || (req.body && req.body.projectId) || req.headers['x-project-id'] || (req.auth && req.auth.projectId) || null;
                    const metaOnboarding = await HistoryHandler.getMetaOnboardingData(pId);
                    if (metaOnboarding && adapterProvider && adapterProvider.updateConfig) {
                        adapterProvider.updateConfig({
                            access_token: metaOnboarding.whatsappToken,
                            phone_number_id: metaOnboarding.whatsappNumberId,
                            verify_token: process.env.META_VERIFY_TOKEN,
                            waba_id: metaOnboarding.whatsappBusinessId
                        });
                    }

                    if (contentType.includes('multipart/form-data')) {
                        const multerMiddleware = upload.single('file');
                        
                        return multerMiddleware(req, res, (err: any) => {
                            if (err) {
                                console.error("❌ [MASTER-INTERCEPTOR] Multer Error:", err);
                                res.statusCode = 500;
                                res.setHeader('Content-Type', 'application/json');
                                return res.end(JSON.stringify({ success: false, error: `Error de stream: ${err.message}` }));
                            }
                            if (isSend) {
                                const { chatId, message } = req.body;
                                return processSendMessage(req, res, chatId, message, (req as any).file, deps);
                            } else if (isImport) {
                                console.log("🚀 [MASTER-INTERCEPTOR] Ejecutando lógica de importación...");
                                return processImportExcel(req, res, deps);
                            } else {
                                console.log("🚀 [MASTER-INTERCEPTOR] Ejecutando lógica de envío masivo (bypass total)...");
                                return processBulkTemplate(req, res, deps);
                            }
                        });
                    } else {
                        return bodyParser.json()(req, res, () => {
                            if (isSend) {
                                const { chatId, message } = req.body;
                                return processSendMessage(req, res, chatId || '', message || '', null, deps);
                            } else if (isImport) {
                                return next();
                            } else {
                                return processBulkTemplate(req, res, deps);
                            }
                        });
                    }
                });
            }
            next();
        });

        app.onError = (err: any, _req: any, res: any) => {
            console.error("🔥 [POLKA ERROR]:", err);
            res.statusCode = 500;
            res.end(JSON.stringify({ success: false, error: err.message || "Internal Server Error" }));
        };

        
    }

    // 6. Initialize AI Manager and flows
    const flows = { welcomeFlowTxt, welcomeFlowVoice, welcomeFlowImg, welcomeFlowVideo, welcomeFlowDoc, locationFlow, idleFlow, welcomeFlowButton };
    const openaiMain = await getOpenAI();
    const assistantIdValue = await HistoryHandler.getConfig('ASSISTANT_ID') || "";

    aiManagerInstance = new AiManager(openaiMain, assistantIdValue, errorReporter, flows);

    registerProcessCallback(async (item: any) => {
        const { ctx, flowDynamic, state, provider, gotoFlow } = item;
        const timeoutCierreValue = await HistoryHandler.getConfig('timeOutCierre') || 15;
        const setTime = Number(timeoutCierreValue) * 60 * 1000;
        reset(ctx, gotoFlow, setTime);
        await aiManagerInstance.processUserMessage(ctx, { flowDynamic, state, provider, gotoFlow });
    });

    // 7. Create flow and bot instance
    const adapterFlow = createFlow([welcomeFlowVoice, welcomeFlowImg, welcomeFlowVideo, welcomeFlowDoc, locationFlow, welcomeFlowButton, idleFlow, welcomeFlowTxt]);
    const adapterDB = new MemoryDB();

    const { httpServer } = await createBot({
        flow: adapterFlow,
        provider: adapterProvider,
        database: adapterDB
    });

    registerSafeErrorHandlers();
    // startSessionSync(SESSION_NAME);

    // 8. Middlewares y Plugins post-Bot
    if (app) {
        // Plugins y Middlewares Globales de Body-Parsing
        httpInject(app);
        app.use(smartBodyParser);

        // 9. Register Other Routes
        const openaiMainDynamic = await getOpenAI();
        const openaiVision = await getOpenAIVision();
        mountBackoffice(app, { provider: adapterProvider, groupProvider, openaiMain: openaiMainDynamic, upload, webChatManager, openaiVision, aiManager: aiManagerInstance, safeToAsk, AssistantResponseProcessor, transcribeAudioFile, withRetry });
        registerExternalApiRoutes(app, { adapterProvider });
        registerRailwayRoutes(app, { RailwayApi });

        // API Health & Info
        app.get("/health", (_req: any, res: any) => res.json({ status: "ok", time: new Date().toISOString() }));
        app.get("/api/assistant-name", (_req: any, res: any) => res.json({ name: process.env.ASSISTANT_NAME || "Bot" }));
        app.get("/api/dashboard-status", async (_req: any, res: any) => res.json(await hasActiveSession(adapterProvider, groupProvider)));

        // API Session Control
        app.post("/api/delete-session", async (_req: any, res: any) => {
            try {
                const rawSessionName = process.env.BOT_NAME || process.env.ASSISTANT_NAME || 'bot';
                const sessionId = rawSessionName.replace(/[^a-zA-Z0-9_-]/g, '_');
                console.log(`[API] 🗑️ Petición de eliminación para: ${sessionId}`);
                await deleteSessionFromDb(sessionId);
                await deleteSessionFromDb(`${sessionId}_groups`);
                res.json({ success: true });
            } catch (err: any) {
                console.error('Error en /api/delete-session:', err);
                res.status(500).json({ success: false, error: err.message });
            }
        });
    }
        
    // 10. Workers Initialization
    // Se ajusta a 45 minutos (anteriormente 15) según requerimiento del usuario
    startHumanInactivityWorker(45);
    startFileCleanupWorker(5);

    // 11. Start Server and Sockets
    try {
        httpServer(+PORT);
        let checks = 0;
        const checkInterval = setInterval(() => {
            checks++;
            if (app?.server) {
                console.log(`✅ [Socket.IO] app.server detectado, lanzando initSocketIO (Intento ${checks})`);
                initSocketIO(app.server, { processUserMessage: aiManagerInstance.processUserMessage });
                clearInterval(checkInterval);
            } else if (checks >= 20) {
                console.error("❌ [Socket.IO] app.server no detectado tras 10 segundos. Socket.IO falló.");
                clearInterval(checkInterval);
            }
        }, 500);
    } catch (err) {
        console.error("❌ [FATAL] Error starting server:", err);
    }
};

main().catch(err => console.error("❌ [FATAL MAIN]:", err));

export {
    welcomeFlowTxt, welcomeFlowVoice, welcomeFlowImg, welcomeFlowVideo, welcomeFlowDoc, locationFlow,
    AiManager, handleQueue, userQueues, userLocks
};

export const processUserMessage = async (ctx: any, items: any) => {
    if (!aiManagerInstance) throw new Error("AiManager not initialized");
    return await aiManagerInstance.processUserMessage(ctx, items);
};
