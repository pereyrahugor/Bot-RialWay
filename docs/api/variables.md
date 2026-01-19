# 📋 Variables Railway

Gestión dinámica de las variables de entorno de Railway a través de la API.

## 🔗 Endpoints

### Obtener Variables
Muestra todas las variables de entorno configuradas actualmente en el proyecto Railway.

- **Método**: `GET`
- **Ruta**: `/api/variables`

#### Respuesta (200 OK)
```json
{
  "success": true,
  "variables": {
    "ASSISTANT_ID": "asst_...",
    "OPENAI_API_KEY": "sk-...",
    "RAILWAY_PROJECT_ID": "...",
    "..." : "..."
  }
}
```

---

### Actualizar Variables
Permite modificar o agregar nuevas variables de entorno en el servicio. **Esta acción suele gatillar un nuevo despliegue (redeploy) automático en Railway.**

- **Método**: `POST`
- **Ruta**: `/api/update-variables`

#### Parámetros de Entrada (Body)
| Parámetro | Tipo | Descripción | Requerido |
| :--- | :--- | :--- | :--- |
| `variables` | Object | Mapa clave-valor con las variables a actualizar. | Sí |

#### Ejemplo de Request
```json
{
  "variables": {
    "msjCierre": "Gracias por contactarnos! Que tengas un gran día.",
    "timeOutCierre": "10"
  }
}
```

#### Respuesta (200 OK)
```json
{
  "success": true,
  "message": "Variables actualizadas y reinicio solicitado."
}
```

---

## 🔗 Enlaces Cruzados
- [Variables de Entorno](../configuracion/variables-entorno.md)
- [Control del Bot](./restart.md)
