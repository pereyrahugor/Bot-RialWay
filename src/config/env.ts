import "dotenv/config";

const has = (key: string) => !!(process.env[key]?.trim());

export const ENV_FEATURES = {
    HAS_OPENAI:       has('OPENAI_API_KEY'),
    HAS_META:         has('META_ACCESS_TOKEN') && has('META_PHONE_ID'),
    HAS_GOOGLE:       has('GOOGLE_CLIENT_EMAIL') && has('GOOGLE_PRIVATE_KEY'),
    HAS_GOOGLE_MAPS:  has('GOOGLE_MAPS_API_KEY'),
    HAS_RAILWAY:      has('RAILWAY_TOKEN'),
    HAS_OWN_SUPABASE: has('SUPABASE_URL') && has('SUPABASE_KEY'),
    PORT: process.env.PORT ?? '8080',
};

const icon = (active: boolean, onText: string, offText: string) =>
    active ? `✅ ${onText}` : `⚠️  ${offText}`;

export function printEnvStatus(): void {
    const f = ENV_FEATURES;
    console.log(`
╔══════════════════════════════════════════════════╗
║          BOT-RIALWAY — ESTADO INICIAL            ║
╚══════════════════════════════════════════════════╝
  🤖 IA / OpenAI     ${icon(f.HAS_OPENAI,       'Activo',               'Sin configurar — IA desactivada')}
  📱 Meta API        ${icon(f.HAS_META,          'Activo',               'Sin configurar — modo Baileys QR')}
  🗓️  Google APIs    ${icon(f.HAS_GOOGLE,        'Activo',               'Sin configurar — Calendar/Drive off')}
  🗺️  Google Maps    ${icon(f.HAS_GOOGLE_MAPS,   'Activo',               'Sin configurar — Ubicaciones off')}
  🚂 Railway API     ${icon(f.HAS_RAILWAY,       'Activo',               'Sin configurar')}
  🗄️  Supabase       ${f.HAS_OWN_SUPABASE ? '✅ Config propia (env)' : 'ℹ️  Usando credenciales de vault'}
  🌐 Puerto          ${f.PORT}
`);
}
