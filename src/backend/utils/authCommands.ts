/**
 * Utilidades para verificación de comandos restringidos de administración / supervisor.
 */

// Lista autorizada de teléfonos (en formato 10 dígitos locales de Argentina)
export const AUTHORIZED_SUPERVISOR_PHONES = [
    '1130792789', // +5491130792789
    '1155891098', // +5491155891098
    '1169585061', // +5491169585061
    '1166370320', // +5491166370320
    '1123352827', // +5491123352827
    '1130719174'  // +5491130719174
];

/**
 * Valida si el remitente coincide con alguno de los números autorizados.
 */
export function isAuthorizedApiKeyRequester(rawSender: string | null | undefined): boolean {
    if (!rawSender) return false;
    const cleanDigits = String(rawSender).replace(/\D/g, '');
    if (!cleanDigits || cleanDigits.length < 10) return false;
    return AUTHORIZED_SUPERVISOR_PHONES.some(phoneSuffix => cleanDigits.endsWith(phoneSuffix));
}

/**
 * Valida si el texto recibido corresponde al comando #API_KEY# o sus variantes:
 * #API_KEY#, #API_KEY, API_KEY#, API_KEY, #APIKEY#, #APIKEY, APIKEY, #API-KEY#, #api_key#, etc.
 */
export function isApiKeyCommand(rawText: string | null | undefined): boolean {
    if (!rawText) return false;
    const trimmed = String(rawText).trim();
    return /^#?API[_\-\s]?KEY#?$/i.test(trimmed);
}

/**
 * Valida si el texto contiene el comando #API_KEY# (incluso si incluye argumentos como un número).
 */
export function containsApiKeyCommand(rawText: string | null | undefined): boolean {
    if (!rawText) return false;
    const trimmed = String(rawText).trim();
    return /(?:^|\s)#?API[_\-\s]?KEY#?(?:$|\s)/i.test(trimmed);
}
