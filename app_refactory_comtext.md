# Contexto de Refactorización: app.ts

## 🎯 Objetivo Principal
Desacoplar el archivo `app.ts` (actualmente de ~1395 líneas) en módulos más pequeños y específicos. El objetivo crítico es aislar las responsabilidades para solucionar problemas persistentes de manejo de *streams* y *middlewares* (específicamente el error "Unexpected end of form" en la subida de archivos) y mejorar la mantenibilidad general del sistema.

## 🏗️ Estado Actual (`app.ts`)
El archivo principal actualmente mezcla múltiples capas de la aplicación:
1. Inicialización del Bot (proveedores, base de datos, flujos).
2. Servidor HTTP (Polka).
3. Middlewares globales y específicos (ej. `backofficeAuth`).
4. Rutas API del Backoffice (auth, send-message, chats, etc.).
5. Rutas API de Railway (restart, update variables).
6. Servidor de archivos estáticos y renderizado HTML.
7. Lógica y eventos de Socket.IO.

## 🗺️ Plan de Ataque (Ejecución por Fases)

### Fase 1: Middlewares y Utilidades
**Objetivo:** Extraer la lógica de interceptación de peticiones antes de tocar las rutas.
* [ ] Crear el directorio `src/middleware/`.
* [ ] Extraer el middleware `backofficeAuth` a `src/middleware/auth.ts`.
* [ ] Extraer la capa de compatibilidad y cualquier otro middleware global a `src/middleware/global.ts`.
* [ ] **Nota para el Agente:** Prestar especial atención a cómo los middlewares leen o consumen el cuerpo de la petición (*request body/stream*), ya que esto es la causa probable del error de *form-data*.

### Fase 2: Extracción de Rutas API
**Objetivo:** Limpiar el archivo principal de endpoints HTTP.
* [ ] Crear el directorio `src/routes/`.
* [ ] Mover las rutas del Backoffice a `src/routes/backoffice.routes.ts`.
* [ ] Mover las rutas de Railway a `src/routes/railway.routes.ts`.
* [ ] Configurar un enrutador o función exportable en cada archivo para inyectarlos limpiamente en Polka dentro de `app.ts`.

### Fase 3: Aislamiento de Socket.IO
**Objetivo:** Separar la comunicación en tiempo real (WebChat) del servidor HTTP estático.
* [ ] Crear el directorio `src/sockets/` o `src/services/`.
* [ ] Extraer toda la inicialización y manejo de eventos de Socket.IO a `src/sockets/index.ts`.
* [ ] La función exportada debe recibir la instancia del servidor HTTP (`http.Server`) generado por Polka para acoplarse.

### Fase 4: Limpieza y Orquestación de `app.ts`
**Objetivo:** Reducir `app.ts` a un archivo de configuración e inyección de dependencias.
* [ ] Refactorizar `app.ts` para que importe las rutas, middlewares y sockets.
* [ ] El flujo en `app.ts` debe ser estrictamente secuencial:
  1. Inicializar Bot.
  2. Inicializar Polka.
  3. Aplicar Middlewares globales.
  4. Registrar Rutas (inyectando dependencias del bot si es necesario).
  5. Levantar servidor HTTP.
  6. Inicializar Socket.IO sobre el servidor HTTP.

## ⚠️ Reglas Estrictas para el Agente
1. **Paso a paso:** Ejecutar una fase a la vez y confirmar que el proyecto sigue compilando en TypeScript antes de avanzar a la siguiente.
2. **Preservar el orden:** El orden en que Polka registra los middlewares y las rutas es vital. Asegurar que el refactor no altera la secuencia de ejecución de las peticiones HTTP.
3. **Manejo de Streams:** Si se encuentra código relacionado con `multer`, `busboy` o parsing manual de formularios, aislarlo con cuidado para no consumir el stream antes de tiempo.