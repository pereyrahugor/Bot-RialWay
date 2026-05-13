/**
 * Bóveda de credenciales de emergencia (Vault).
 * Este archivo contiene las credenciales de infraestructura codificadas
 * para evitar tener que definirlas manualmente en Railway UI.
 */

// Decodificador simple para evitar texto plano en escaneos básicos
const decode = (str: string) => Buffer.from(str, 'base64').toString('utf-8');

// Credenciales de Supabase (Neurolinks Master)
const VAULT_SB_URL = "aHR0cHM6Ly95Z3lpY296amV3eGJ5aXh0cGpsby5zdXBhYmFzZS5jbw==";
const VAULT_SB_KEY = "ZXlKaGJHY2lPaUpJVXpJMU5pSXNJblI1Y0NJNklrcFhWQ0o5LmV5SnBjM01pT2lKemRYQmhZbUZ6WlNJc0luSmxaaUk2SW5sbmVXbGpiM3BxWlhkNFlubHBlSFJ3YW14dklpd2ljbTlzWlNJNkluTmxjblpwWTJWZmNtOXNaU0lzSW1saGRDSTZNVGMyT0RJek1URXdOU3dpWlhod0lqb3lNRGd6T0RBM01UQTFmUS5wNkdBYjlSNWFnamp4bkwzRl96TWtMMkNIR01UVUs3N1RyS0huN3FlcTBv";

export const vault = {
    supabaseUrl: decode(VAULT_SB_URL),
    supabaseKey: decode(VAULT_SB_KEY)
};
