# 📊 Dashboard y QR

El bot provee una interfaz web para el monitoreo del estado y la vinculación con WhatsApp.

## 🔗 Endpoints Visuales

### Dashboard Principal
- **Ruta**: `/dashboard`
- **Descripción**: Interfaz central para ver si el bot está conectado y acceder al código QR si es necesario vincular una nueva sesión.

### Visualización de QR
- **Ruta**: `/qr.png`
- **Descripción**: Sirve la imagen dinámica del código QR generado por Baileys.

---

## ⚙️ API de Estado

### Obtener Nombre del Asistente
Retorna el nombre configurado comercialmente para el bot.

- **Método**: `GET`
- **Ruta**: `/api/assistant-name`

#### Respuesta (200 OK)
```json
{
  "name": "Test Dev"
}
```

### Estado de la Sesión
Verifica si hay una sesión activa conectada, local o remota en Supabase.

- **Método**: `GET`
- **Ruta**: `/api/dashboard-status`

#### Respuesta (200 OK)
Muestra el estado detallado de la conexión.

```json
{
  "active": true,
  "source": "connected",
  "phoneNumber": "549113079xxxx"
}
```

#### Parámetros de Retorno (Tabla)
| Campo | Tipo | Descripción |
| :--- | :--- | :--- |
| `active` | Boolean | Indica si el bot está enviando/recibiendo mensajes actualmente. |
| `source` | String | Fuente de la sesión (`connected`, `local`). |
| `phoneNumber` | String | Número de WhatsApp vinculado (si está listo). |
| `hasRemote` | Boolean | Indica si existe una sesión guardada en Supabase pendiente de restaurar. |

---

## 🔗 Enlaces Cruzados
- [Gestión de Sesión](./session.md)
- [Control del Bot](./restart.md)
