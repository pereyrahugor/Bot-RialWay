/**
 * Extrae datos de un resumen en formato texto plano, devolviendo un objeto genérico
 * con todas las claves y valores detectados (clave: valor) en cada línea.
 */
export type GenericResumenData = Record<string, string>;

const extraerDatosResumen = (resumen: string): GenericResumenData => {
    const data: GenericResumenData = {};
    const lines = resumen.split(/\r?\n/);

    const cleanValue = (val: string): string => {
        let cleaned = val.trim();
        let changing = true;
        while (changing) {
            const len = cleaned.length;
            if (len < 2) {
                changing = false;
                break;
            }
            const first = cleaned[0];
            const last = cleaned[len - 1];
            if ((first === "'" && last === "'") ||
                (first === '"' && last === '"') ||
                (first === '`' && last === '`') ||
                (first === '´' && last === '´') ||
                (first === '’' && last === '’') ||
                (first === '‘' && last === '‘') ||
                (first === '[' && last === ']') ||
                (first === '{' && last === '}') ||
                (first === '(' && last === ')')) {
                cleaned = cleaned.slice(1, -1).trim();
                continue;
            }
            if (["'", '"', '`', '´', '’', '‘', '[', ']', '{', '}', '(', ')'].includes(first)) {
                cleaned = cleaned.slice(1).trim();
                continue;
            }
            if (["'", '"', '`', '´', '’', '‘', '[', ']', '{', '}', '(', ')'].includes(last)) {
                cleaned = cleaned.slice(0, -1).trim();
                continue;
            }
            changing = false;
        }
        return cleaned;
    };

    for (const line of lines) {
        // Regex mejorado para capturar "Clave: Valor" ignorando prefijos de markdown como -, *, # o números
        const match = line.match(/^\s*(?:[-*#\s\d.]*)\s*([\wÁÉÍÓÚáéíóúñÑ ._-]+)\s*[:=]\s*(.+)$/);
        if (match) {
            const key = match[1].trim().replace(/^[-–—\s]+/, '');
            const value = cleanValue(match[2]);
            data[key] = value;
            const lowerKey = key.toLowerCase();
            // Si la clave es 'Tipo', 'Type' o similar, normalizar a 'tipo'
            if (lowerKey === 'tipo' || lowerKey === 'type') {
                data['tipo'] = value;
            }
            // Si la clave es 'Tag', 'Tags', 'Etiqueta', 'Etiquetas' o similar, normalizar a 'tag'
            if (lowerKey === 'tag' || lowerKey === 'tags' || lowerKey === 'etiqueta' || lowerKey === 'etiquetas') {
                data['tag'] = value;
            }
        }
    }
    console.log('[extractJsonData] data extraído:', data);
    return data;
};

export { extraerDatosResumen };