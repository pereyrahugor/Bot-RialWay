# 🔄 Control del Bot

Endpoints para gestionar el ciclo de vida del proceso en Railway.

## 🔗 Endpoints

### Reiniciar Bot
Solicita a la API de Railway que reinicie el despliegue activo. Esto es útil para aplicar cambios de configuración o intentar recuperarse de estados de error críticos.

- **Método**: `POST`
- **Ruta**: `/api/restart-bot`

#### Respuesta (200 OK)
```json
{
  "success": true,
  "message": "Reinicio solicitado correctamente."
}
```

---

## 🛠️ Lógica Interna
El bot utiliza el módulo `RailwayApi` para comunicarse con `https://backboard.railway.app/graphql/v2`. 

Requiere que el token `RAILWAY_TOKEN` tenga permisos suficientes sobre el proyecto.

---

## 🔗 Enlaces Cruzados
- [Railway API (Módulo)](../modulos/railway-api.md)
- [Variables Railway](./variables.md)
