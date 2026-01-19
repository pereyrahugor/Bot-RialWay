# ☁️ Railway API

Este módulo permite al bot interactuar con su propia infraestructura de despliegue en Railway de manera programática.

## 🔗 Clase `RailwayApi`

Ubicada en `src/Api-RailWay/Railway.ts`, esta clase encapsula las consultas GraphQL necesarias para gestionar el servicio.

### Métodos Principales

#### `getVariables()`
Recupera el mapa completo de variables de entorno del entorno actual.

#### `updateVariables(variables: object)`
Realiza un `upsert` de las variables enviadas. **Advertencia**: Railway gatillará un nuevo deploy automáticamente al completar esta operación.

#### `restartActiveDeployment()`
Fuerza el reinicio del contenedor actual sin necesidad de un nuevo commit o deploy.

---

## 🔐 Seguridad
Requiere el uso de un `RAILWAY_TOKEN` (API Token Personal o de Proyecto). Se recomienda usar tokens de proyecto para mayor granularidad.

---

## 🔗 Enlaces Cruzados
- [Variables Railway (API)](../api/variables.md)
- [Control del Bot (API)](../api/restart.md)
