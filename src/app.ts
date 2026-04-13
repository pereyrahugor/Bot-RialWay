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
import { restoreSessionFromDb, startSessionSync, deleteSessionFromDb } from "./utils/sessionSync";
import { ErrorReporter } from "./utils/errorReporter";
import { updateMain } from "./addModule/updateMain";
import { WebChatManager } from "./utils-web/WebChatManager";
import { HistoryHandler } from "./utils/historyHandler";
import { registerProcessCallback, handleQueue, userQueues, userLocks } from "./utils/queueManager";

// --- Managers & Routes ---
import { registerBackofficeRoutes, processSendMessage, processBulkTemplate, BackofficeDependencies } from "./routes/backoffice.routes";
import { registerRailwayRoutes } from "./routes/railway.routes";
import { registerWebchatRoutes } from "./routes/webchat.routes";
import { registerStaticRoutes } from "./routes/static.routes";
import { initSocketIO } from "./sockets/socket.manager";
import { registerProviderEvents, hasActiveSession } from "./providers/provider.manager";
import { startHumanInactivityWorker } from "./workers/humanInactivity.worker";
import { AiManager } from "./utils/ai.manager";
import { registerDashboardRoutes } from "./routes/dashboard.routes";
import { smartBodyParser, compatibilityLayer, rootRedirect } from "./middleware/global";
import { backofficeAuth } from "./middleware/auth";
import bodyParser from 'body-parser';

// --- Flows ---
import { welcomeFlowTxt } from "./Flows/welcomeFlowTxt";
import { welcomeFlowVoice } from "./Flows/welcomeFlowVoice";
import { welcomeFlowImg } from "./Flows/welcomeFlowImg";
import { welcomeFlowVideo } from "./Flows/welcomeFlowVideo";
import { welcomeFlowDoc } from "./Flows/welcomeFlowDoc";
import { locationFlow } from "./Flows/locationFlow";
import { idleFlow } from "./Flows/idleFlow";
import { welcomeFlowButton } from "./Flows/welcomeFlowButton";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

// Global instances
export let adapterProvider: any;
export let groupProvider: any;
export let errorReporter: any;
export let aiManagerInstance: AiManager;
const webChatManager = new WebChatManager();
const openaiMain = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });
const openaiVision = new OpenAI({ apiKey: process.env.OPENAI_API_KEY_IMG });
const ASSISTANT_ID = process.env.ASSISTANT_ID!;
const PORT = process.env.PORT || 8080;

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
    await HistoryHandler.initDatabase();
    
    // Usar un nombre de sesión consistente para evitar desajustes entre SessionSync y el Provider
    // Sanitizar para evitar caracteres inválidos en rutas (como *)
    const rawSessionName = process.env.BOT_NAME || process.env.ASSISTANT_NAME || 'bot';
    const SESSION_NAME = rawSessionName.replace(/[^a-zA-Z0-9_-]/g, '_');
    
    // await restoreSessionFromDb(SESSION_NAME);
    const qrPath = path.join(process.cwd(), "bot.qr.png");

    // Intentar obtener la última versión de Baileys para evitar el error bad-request en init queries
    let baileysVersion: any = [2, 3000, 1030817285]; // Fallback más estable que el anterior
    try {
        const { fetchLatestBaileysVersion } = await import('@whiskeysockets/baileys');
        const { version } = await fetchLatestBaileysVersion();
        if (version) {
            baileysVersion = version;
            console.log(`📡 [App] Usando última versión de WhatsApp Web: ${baileysVersion.join('.')}`);
        }
    } catch (e) {
        console.log(`⚠️ [App] No se pudo obtener la última versión de WA Web, usando fallback: ${baileysVersion.join('.')}`);
    }

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
            const { discoverMetaIds } = await import("./utils/metaDiscovery");
            const discovery = await discoverMetaIds(metaToken);
            if (discovery && discovery.phoneNumberId && discovery.wabaId) {
                console.log(`✅ [App] Recuperación exitosa: PhoneID=${discovery.phoneNumberId}, WABAID=${discovery.wabaId}`);
                metaPhoneId = discovery.phoneNumberId;
                metaWabaId = discovery.wabaId;
                await HistoryHandler.saveMetaOnboardingData(metaWabaId, metaPhoneId, metaToken, { ...discovery, syncedAt: new Date().toISOString() });
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
        
        groupProvider = createProvider(SupabaseBaileysProvider, {
            name: `${SESSION_NAME}_groups`, // <--- Diferente del principal para evitar bloqueo
            version: baileysVersion,
            groupsIgnore: false,
            readStatus: false,
            disableHttpServer: true,
        });
        setGroupProvider(groupProvider);
    } else {
        console.log('🚀 [App] Modo Estándar detectado (Baileys para todo)');
        adapterProvider = createProvider(SupabaseBaileysProvider, {
            name: SESSION_NAME, // <--- Mantener sincronizado
            version: baileysVersion,
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
    if (groupProvider) {
        registerProviderEvents(groupProvider, true);
        // Inicialización manual si es Baileys
        if (groupProvider.initVendor) {
            console.log('🚀 [App] Inicializando Motor de Grupos...');
            await groupProvider.initVendor();
        }
    }

    // 4. Initialize Data and Error Reporter
    errorReporter = new ErrorReporter(adapterProvider, process.env.ID_GRUPO_RESUMEN || "");
    await updateMain();

    const app = adapterProvider.server;
    if (app) {
        // 5. Polka/Express Server setup & Early Middlewares
        console.log("🛠️ [POLKA MIDDLEWARES - INITIAL]:", app.middlewares?.length || 0);

        // --- MASTER-INTERCEPTOR DE STREAMS (EL PRIMERO SIEMPRE) ---
        app.use((req: any, res: any, next: any) => {
            const normalizedPath = (req.url || '').split('?')[0].replace(/\/+/g, '/');
            const isBulk = normalizedPath.includes('/api/backoffice/whatsapp/send-bulk-template');
            const isSend = normalizedPath.includes('/api/backoffice/send-message');

            if ((isSend || isBulk) && req.method === 'POST') {
                req.setTimeout(0);
                console.log(`🛡️ [MASTER-INTERCEPTOR-PRIORITY] Bypass activo para: ${normalizedPath}`);
                
                return backofficeAuth(req, res, async () => {
                    const contentType = req.headers['content-type'] || '';
                    const deps: BackofficeDependencies = { adapterProvider, groupProvider, HistoryHandler, openaiMain, upload };

                    // Sincronizar Meta Provider antes de procesar si es necesario
                    const metaOnboarding = await HistoryHandler.getMetaOnboardingData();
                    if (metaOnboarding && adapterProvider && adapterProvider.updateConfig) {
                        adapterProvider.updateConfig({
                            jwtToken: metaOnboarding.whatsappToken,
                            numberId: metaOnboarding.whatsappNumberId,
                            verifyToken: process.env.META_VERIFY_TOKEN,
                            businessId: metaOnboarding.whatsappBusinessId
                        });
                    }

                    if (contentType.includes('multipart/form-data')) {
                        return upload.single('file')(req, res, (err: any) => {
                            if (err) {
                                console.error("❌ [MASTER-INTERCEPTOR] Multer Error:", err);
                                res.statusCode = 500;
                                res.setHeader('Content-Type', 'application/json');
                                return res.end(JSON.stringify({ success: false, error: `Error de stream: ${err.message}` }));
                            }
                            if (isSend) {
                                const { chatId, message } = req.body;
                                return processSendMessage(req, res, chatId, message, (req as any).file, deps);
                            } else {
                                // CAPTURA TOTAL: Procesamos el masivo aquí mismo y NO llamamos a next()
                                // Esto evita que otros middlewares (como el plugin de openai) intenten re-parsear el stream
                                console.log("🚀 [MASTER-INTERCEPTOR] Ejecutando lógica de envío masivo (bypass total)...");
                                return processBulkTemplate(req, res, deps);
                            }
                        });
                    } else {
                        return bodyParser.json()(req, res, () => {
                            if (isSend) {
                                const { chatId, message } = req.body;
                                return processSendMessage(req, res, chatId || '', message || '', null, deps);
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

        // APLICAR COMPATIBILIDAD DESPUÉS DEL INTERCEPTOR
        app.use(compatibilityLayer);
        app.use(rootRedirect);
        
        registerBackofficeRoutes(app, {
            adapterProvider,
            groupProvider,
            HistoryHandler,
            openaiMain,
            upload
        });
        registerDashboardRoutes(app);
    }

    // 6. Initialize AI Manager and flows
    const aiManager = new AiManager(openaiMain, ASSISTANT_ID, errorReporter, {
        welcomeFlowTxt, welcomeFlowVoice, welcomeFlowButton
    });
    aiManagerInstance = aiManager;

    registerProcessCallback(async (item: any) => {
        const { ctx, flowDynamic, state, provider, gotoFlow } = item;
        await aiManager.processUserMessage(ctx, { flowDynamic, state, provider, gotoFlow });
    });

    // 7. Initialize Bot Instance
    const adapterFlow = createFlow([
        welcomeFlowTxt, welcomeFlowVoice, welcomeFlowImg, 
        welcomeFlowVideo, welcomeFlowDoc, locationFlow, 
        idleFlow, welcomeFlowButton
    ]);
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
        registerRailwayRoutes(app, { RailwayApi: (await import("./Api-RailWay/Railway")).RailwayApi });
        registerWebchatRoutes(app, { webChatManager, openaiVision, aiManager });
        registerStaticRoutes(app, { __dirname });

        // API Health & Info
        app.get("/health", (_req: any, res: any) => res.json({ status: "ok", time: new Date().toISOString() }));
        app.get("/api/assistant-name", (_req: any, res: any) => res.json({ name: process.env.ASSISTANT_NAME || "Bot" }));
        app.get("/api/dashboard-status", async (_req: any, res: any) => res.json(await hasActiveSession(adapterProvider, groupProvider)));

        // API Session Control
        app.post("/api/delete-session", async (_req: any, res: any) => {
            try {
                await deleteSessionFromDb();
                res.json({ success: true });
            } catch (err: any) {
                res.status(500).json({ success: false, error: err.message });
            }
        });
    }
        
    // 10. Workers Initialization
    startHumanInactivityWorker(15);

    // 11. Start Server and Sockets
    try {
        httpServer(+PORT);
        setTimeout(() => {
            if (app?.server) {
                console.log("✅ [Socket.IO] app.server detected, initializing...");
                initSocketIO(app.server, { processUserMessage: aiManager.processUserMessage });
            }
        }, 1000);
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
