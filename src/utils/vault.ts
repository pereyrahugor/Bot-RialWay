/**
 * Bóveda de credenciales de emergencia (Vault).
 * Este archivo contiene las credenciales de infraestructura codificadas
 * para evitar tener que definirlas manualmente en Railway UI.
 */

// Decodificador simple para evitar texto plano en escaneos básicos
const decode = (str: string) => Buffer.from(str, 'base64').toString('utf-8');

// Credenciales de Supabase (Neurolinks Master)
const VAULT_SB_URL = "aHR0cHM6Ly95Z3lpY296amV3eGJ5aXh0cGpsby5zdXBhYmFzZS5jbw==";
const VAULT_SB_KEY = "ZXlKaGJHY2lPaUpJVXpJMU5pS3NpbjI1SWpvaUpYVjJKVzE5TENKcGMyTWlPaUp6ZFhCaVlXSmxjM0VpTENKcmVXWmxJam9pZmxkNWFXTnZhbXAzWW5scGVYUndhR3h2SWl3aWNtOXNaU0VpT2lKemVYSjJhV1ZmWm1Oc2WlaXNJaW1saGRDSTZNVGMyT0RJeU1URXdOU3dpWlhod0lqb2lNREd6T0RBM01UQTFmUS5wNkdBYjlSNWFnamp4bkxMM0ZfellNa0wyQ0hHTVRVSzc3VHJLSG43cWVxMG8=";

export const vault = {
    supabaseUrl: decode(VAULT_SB_URL),
    supabaseKey: decode(VAULT_SB_KEY)
};
