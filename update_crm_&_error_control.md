# Actualización CRM y Control de Errores - Especificaciones

Este documento detalla todas las mejoras, resoluciones de errores y arquitecturas aplicadas recientemente para optimizar la conexión del Backoffice (CRM) en tiempo real, así como el blindaje del flujo de comunicación con la API de OpenAI.

## 1. Reparación y Estabilización del CRM en Tiempo Real (Socket.IO)

### Problemas abordados
- Error `404 Not Found` al intentar cargar el script del cliente de Socket.IO (`socket.io.js`).
- Error `io is not defined` en la consola del frontend del Backoffice, lo que impedía que los nuevos mensajes aparecieran en pantalla sin recargar la página manualmente (F5).
- Desconexión del servicio si Socket.IO se iniciaba antes de que el servidor HTTP base estuviese listo en el entorno de Railway.

### Soluciones Aplicadas

**A. Refactorización en el Frontend (`src/html/backoffice.html`)**
- Se reemplazó la ruta de carga local del cliente por la CDN oficial para asegurar la disponibilidad del script:
  ```html
  <script src="https://cdn.socket.io/4.7.4/socket.io.min.js"></script>
  ```

**B. Inicialización Robusta del Servidor (`src/app.ts`)**
- Se redefinió la función `initSocketIO` para que inicialice con configuración CORS permisiva y compatibilidad (`allowEIO3: true`).
- Se introdujo un retraso (`setTimeout`) al momento de ligar Socket.IO al servidor HTTP, garantizando que el servidor base subyacente de Polka (o `adapterProvider`) estuviese completamente levantado antes de escuchar eventos WebSocket.
- Se conectaron con éxito los eventos provenientes del EventEmitter interno de la base de datos (`new_message`, `bot_toggled`) para que sean re-emitidos a los clientes web conectados:
  ```typescript
  historyEvents.on('new_message', (payload) => {
      io.emit('new_message', payload);
  });
  ```

## 2. Control Inteligente de Fallos y Tolerancia de Red (OpenAI / Red)

### Problemas abordados
- Interrupciones del bot, devoluciones de error o cuelgues ante caídas temporales de conexión con OpenAI o tiempos de espera agotados (`timeout`).
- Fugas de texto interno del sistema estructurado hacia el usuario final del tipo `[SYSTEM_DB_RESULT:...]` o `[SYSTEM_API_RESULT:...]` causadas por "alucinaciones" del asistente o un mal formateo en la generación de la AI.

### Soluciones Aplicadas

**A. Bucle de Reintentos con Demora Exponencial (`src/app.ts`)**
- Se creó/actualizó la función envoltura `safeToAsk` para gestionar la comunicación principal ("toAsk") con OpenAI.
- Ahora implementa un bucle `while` que soporta un máximo de **3 reintentos automáticos**. 
- Si la API falla, captura el error, espera un intervalo progresivo (2 segundos, luego 4 segundos, etc.) y lo vuelve a intentar en lugar de colapsar y responder con un error genérico.
  ```typescript
  export const safeToAsk = async (assistantId: string, message: string, state: any, maxRetries: number = 3) => {
      let attempt = 0;
      while (attempt < maxRetries) {
          // ...espera runs activos...
          try {
              return await toAsk(assistantId, message, state);
          } catch (err: any) {
              attempt++;
              if (attempt >= maxRetries) throw err;
              await new Promise(r => setTimeout(r, attempt * 2000));
          }
      }
  };
  ```

**B. Filtrado Seguro de Marcas del Sistema (`src/utils/AssistantResponseProcessor.ts`)**
- Se amplió la función de limpieza y tratamiento del lenguaje de salida de la AI (`limpiarBloquesJSON`).
- Se insertó una Expresión Regular (`Regex`) sumamente estricta que atrapa y elimina el texto residual de la comunicación entre código y asistente (ej. `SYSTEM_DB_RESULT`).
- La Regex está diseñada para atrapar incluso bloques truncados si el Asistente se quedó sin tokens o no cerró el corchete de forma correcta:
  ```typescript
  // 2d. Filtrar SYSTEM_DB_RESULT o SYSTEM_API_RESULT filtrados por error del asistente
  limpio = limpio.replace(/\[?\s*SYSTEM_(DB|API)_RESULT[\s\S]*?(?:\]|$)/gi, "");
  ```

## 3. Resolución de Problemas de Supabase / Sesiones

### Diagnóstico de "pérdida de datos"
- Se evaluó un supuesto borrado de tablas de historial de chat. Al revisar las tablas, se descubrió que los datos siguen intactos, sin embargo, el entorno estaba dividido.
- **Motivo**: El archivo `.env` apuntaba a una instancia nueva/limpia de Supabase (`nlotzwyzqrjrzcgihuhz`). Los datos viejos continuaban sanos y salvos en el clúster original (`ygyicozjewxbyixtpjlo`).

### Intervención Humana bloqueada
- Cuando un número pasaba a la base de datos como "Intervención Humana activa" (`bot_enabled: false`), el bot dejaba de responder. Debido a que ese número no cargaba en el nuevo CRM vacío, no había forma visual de revertir el estado.
- **Motivo de seguridad implementado**: La arquitectura está estructurada en `processUserMessage` de la forma en la que se pueden usar "Comandos Globales". Al escribir la directiva `#ON#` o `#GOBAL_ON#` directamente en el chat de WhatsApp desde el número afectado, se fuerza la reactivación remota del bot para el usuario.
