# 🔄 Persistencia de Sesión (Session Sync)

El módulo `sessionSync.ts` soluciona el problema de pérdida de sesión en entornos efímeros (como contenedores Docker en Railway).

## 🛠 Funcionamiento

1. **Supabase como Almacenamiento**: No utilizamos el sistema de archivos del contenedor para guardar la sesión de forma permanente, sino que codificamos la carpeta `bot_sessions` y la guardamos en una tabla de Supabase.
2. **Restauración Inicial**: Al arrancar (`main()`), el bot consulta a Supabase si existe una sesión previa. Si existe, descarga y descomprime los archivos en `bot_sessions/` antes de que Baileys se inicialice.
3. **Sincronización Periódica**: Mientras el bot está corriendo, existe un proceso en segundo plano que sube el estado de `creds.json` cada cierto tiempo para asegurar que los tokens de actualización (refresh tokens) se guarden.

## 🗄️ Estructura de Datos
La sesión se guarda vinculada al `RAILWAY_PROJECT_ID` y un `BOT_NAME` para permitir múltiples bots en un mismo proyecto de Supabase.

---

## 🔗 Enlaces Cruzados
- [Variables de Entorno](../configuracion/variables-entorno.md)
- [Gestión de Sesión (API)](../api/session.md)
