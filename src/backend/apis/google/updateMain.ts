import { updateAllSheets } from "./updateSheet";
import { updateAllDocs } from "./updateDoc";

/**
 * Carga los datos de todas las hojas y documentos principales usando las funciones unificadas.
 */
export const updateMain = async (projectId?: string, serviceId?: string) => {
    try {
        await updateAllSheets({ projectId, serviceId });
        await updateAllDocs(projectId, serviceId);
        console.log("✅ Todas las hojas y documentos procesados correctamente.");
    } catch (error) {
        console.error("❌ Error al actualizar datos:", error);
    }
};
