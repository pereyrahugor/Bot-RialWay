import { HistoryHandler } from '../db/historyHandler.js';

export class SystemLogger {
    static async error(service: 'OPENAI' | 'META' | 'SUPABASE' | 'SYSTEM' | 'RAILWAY', message: string, clientId: string | null = null, details: any = {}) {
        await HistoryHandler.saveSystemLog(service, 'ERROR', message, clientId, details);
    }
    static async warn(service: 'OPENAI' | 'META' | 'SUPABASE' | 'SYSTEM' | 'RAILWAY', message: string, clientId: string | null = null, details: any = {}) {
        await HistoryHandler.saveSystemLog(service, 'WARN', message, clientId, details);
    }
    static async info(service: 'OPENAI' | 'META' | 'SUPABASE' | 'SYSTEM' | 'RAILWAY', message: string, clientId: string | null = null, details: any = {}) {
        await HistoryHandler.saveSystemLog(service, 'INFO', message, clientId, details);
    }
}
