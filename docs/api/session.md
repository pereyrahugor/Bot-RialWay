# 🗄️ Gestión de Sesión

Controla la persistencia y la limpieza de la sesión de WhatsApp (Baileys) vinculada al bot.

## 🔗 Endpoints

### Eliminar Sesión
Borra tanto los archivos locales de la carpeta `bot_sessions` como el registro correspondiente en la base de datos de Supabase. Esto desconectará el bot y requerirá un nuevo escaneo de QR.

- **Método**: `POST`
- **Ruta**: `/api/delete-session`

#### Respuesta (200 OK)
```json
{
  "success": true
}
```

#### Respuesta de Error (500)
```json
{
  "success": false,
  "error": "Motivo del fallo detallado"
}
```

---

## ☁️ Persistencia Externa
El bot utiliza un sistema de **Session Sync** que:
1. Al iniciar, descarga `creds.json` de Supabase.
2. Cada 10 minutos (configurables), sube cualquier cambio en las credenciales a la nube.
3. Esto permite que, ante un reinicio en Railway, el bot no pierda la conexión y no requiera re-escanear el código QR.

> **Nota**: Si decides desvincular el bot desde el teléfono (Dispositivos vinculados), es recomendable llamar a `/api/delete-session` para limpiar el estado del servidor.

---

## 🔗 Enlaces Cruzados
- [Persistencia de Sesión (Módulo)](../modulos/session-sync.md)
- [Dashboard](./dashboard.md)
