
import { HistoryHandler as CoreHistoryHandler, supabase, historyEvents } from "../../db/historyHandler";

/**
 * Proxy de HistoryHandler para el backoffice.
 * Redirige todas las llamadas al HistoryHandler central en src/db/
 * para garantizar que la configuración sea consistente en toda la aplicación.
 */
export const HistoryHandler = CoreHistoryHandler;
export { supabase, historyEvents };
