import { registerBackofficeRoutes } from './routes/backoffice.routes';
import { registerDashboardRoutes } from './routes/dashboard.routes';
import { registerStaticRoutes } from './routes/static.routes';
import { registerWebchatRoutes } from './webchat/routes/webchat.routes';
import { BackofficeConfig } from './types/provider.interface';
import { HistoryHandler } from './db/historyHandler';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

export const mountBackoffice = (app: any, config: BackofficeConfig) => {
    const { provider, groupProvider, openaiMain, upload, webChatManager, openaiVision, aiManager, safeToAsk, AssistantResponseProcessor, transcribeAudioFile, withRetry } = config;
    registerBackofficeRoutes(app, { adapterProvider: provider, groupProvider, HistoryHandler, openaiMain, upload });
    registerDashboardRoutes(app);
    registerStaticRoutes(app, { __dirname, provider, groupProvider });
    if (webChatManager) {
        registerWebchatRoutes(app, { webChatManager, openaiVision, aiManager, safeToAsk, AssistantResponseProcessor, transcribeAudioFile, withRetry });
    }
};
