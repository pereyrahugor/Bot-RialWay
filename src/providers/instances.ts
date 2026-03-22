let adapterProvider: any;
let groupProvider: any;

/**
 * Establece el proveedor principal (Meta o Baileys)
 */
export const setAdapterProvider = (instance: any) => {
    adapterProvider = instance;
};

/**
 * Obtiene el proveedor principal (Meta o Baileys)
 */
export const getAdapterProvider = () => adapterProvider;

/**
 * Establece el proveedor de grupos (Baileys)
 */
export const setGroupProvider = (instance: any) => {
    groupProvider = instance;
};

/**
 * Obtiene el proveedor de grupos (Baileys)
 */
export const getGroupProvider = () => groupProvider;
