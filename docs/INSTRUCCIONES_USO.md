# 📘 Guía de Instrucciones de Uso - Bot-RialWay

Esta guía detalla el funcionamiento integral del sistema, desde la conexión inicial hasta la gestión avanzada de clientes, automatizaciones de IA e importación masiva de datos.

---

## 1. Conexión del Bot (WhatsApp)
Existen dos formas de conectar el sistema a WhatsApp, dependiendo de tus necesidades de estabilidad y volumen.

### 1-a. Proveedor No Oficial (Baileys / Código QR)
Este método utiliza una instancia de WhatsApp Web para conectar el bot:
1. Accede a la sección **Conexión** (Icono QR) en el menú lateral.
2. Si el bot no está vinculado, aparecerá un Código QR.
3. Desde tu teléfono de WhatsApp Business, ve a **Dispositivos Vinculados > Vincular un dispositivo**.
4. Escanea el QR. Una vez vinculado, verás el estado "Conectado".
- **Ventaja**: Implementación inmediata sin procesos de aprobación de Meta.
- **Limitación**: Sujeto a cierres de sesión por inactividad del teléfono físico.

### 1-b. Proveedor Oficial (Meta Cloud API)
Este método utiliza la API oficial de WhatsApp para empresas:
1. Accede a **Meta Info** en el menú lateral (icono de Meta).
2. Configura los parámetros desde el portal [Meta for Developers](https://developers.facebook.com/):
    - **WABA ID / Phone ID**: Identificadores únicos de tu cuenta y número.
    - **Access Token**: Token de acceso permanente (System User).
    - **Webhook**: Configura la URL de tu servidor y el *Verify Token* definido en `System Config`.
3. **Sincronización SMB**: Desde este panel puedes forzar la sincronización de contactos e historial de mensajes acumulados en Meta.
- **Ventaja**: Máxima estabilidad, soporte multi-agente robusto y cumplimiento oficial de políticas.

---

## 2. Importación Masiva y Plantillas (Excel)
Carga bases de datos de clientes existentes de forma masiva:
- **Ubicación**: En la sección de **Conversaciones**, haz clic en el botón de la nube (Importar).
- **Plantilla Oficial**: Haz clic en **"Descargar Plantilla Excel"** para obtener el formato compatible.
- **Campos**: `phone` (obligatorio), `name` y `tags` (opcionales).
- **Resultado**: El sistema creará los chats y asignará etiquetas inmediatamente, permitiendo segmentar tu base antes de que los clientes escriban.

---

## 3. Atención Multimedia y Notas de Voz
> [!IMPORTANT]
> **Funcionalidad exclusiva de la versión con Bot de Inteligencia Artificial.**

El asistente no solo lee texto, sino que interactúa con contenido multimedia:
- **Notas de Voz**: El bot escucha y transcribe los audios de los clientes para responder contextualmente.
- **Análisis de Imágenes**: Puede procesar fotos (comprobantes, capturas de pantalla, productos) para extraer información o responder dudas sobre lo que "ve".
- **Interacción Fluida**: Los usuarios pueden alternar entre audio y texto sin que el bot pierda el hilo de la conversación.

---

## 4. Automatización y Derivación Inteligente
> [!IMPORTANT]
> **Funcionalidad exclusiva de la versión con Bot de Inteligencia Artificial.**

La IA actúa como un gestor activo del flujo de ventas:
- **Movimiento de Columnas en CRM**: Al detectar un avance (ej: el cliente pide presupuesto o confirma una compra), la IA mueve la tarjeta del lead automáticamente en el tablero CRM.
- **Handover (Derivación entre Asistentes)**: El sistema puede derivar a un cliente entre diferentes "perfiles" de IA (ej: de un *Recepcionista* a un *Vendedor Especializado*) de forma transparente para el usuario.
- **Asignación de Etiquetas**: La IA categoriza al cliente en tiempo real (ej: "Urgente", "Interesado en Plan X") basándose en el análisis de la conversación.

---

## 5. Gestión de CRM y Tablero Kanban
El centro de gestión comercial de tu equipo:
- **Tablero Visual**: Organiza a tus clientes en columnas según su etapa de venta.
- **Búsqueda y Filtros**: Puedes buscar clientes por nombre, teléfono, notas o etiquetas. Utiliza la barra de búsqueda superior para encontrar contactos específicos rápidamente.
- **Ficha del Lead**: Haz clic en cualquier tarjeta para ver el historial de notas, datos fiscales y actualizar el estado manualmente si es necesario.
- **Sincronización Real-Time**: Todos los movimientos se reflejan instantáneamente en las pantallas de todo el equipo mediante WebSockets.

---

## 6. Coexistencia Bot/Humano
Intervención manual sin conflictos:
- **Interruptor Bot/Humano**: Pausa la IA en cualquier momento para tomar el control de la charla.
- **Reactivación**: El bot puede configurarse para reanudarse tras un periodo de inactividad del humano (Parametrizado por el administrador).

---

## 7. Comandos de Control (WhatsApp)
Controla el sistema mediante mensajes de texto (Solo números autorizados):
- **#ON#**: Activa el bot **exclusivamente para el chat actual**.
- **#OFF#**: Desactiva el bot para el chat actual. No se reactiva por tiempo.
- **#RESET#**: Borra el historial de memoria del asistente para ese usuario.
- **#ACTUALIZAR#**: 
    - *Solo IA*: Sincroniza en caliente los datos de Google Sheets y refresca las instrucciones (Prompts) sin reiniciar el servidor.

---

## 8. Reportes Externos (Google Sheets)
> [!NOTE]
> **Los resúmenes automáticos requieren la versión con Bot de Inteligencia Artificial.**

- **Sincronización de Resúmenes**: Al finalizar o pausarse una conversación, la IA genera un resumen estructurado.
- **Hoja de Cálculo Central**: Este resumen se envía automáticamente a una Google Sheet configurada, permitiendo llevar un registro de ventas, tickets o consultas fuera del sistema para análisis posterior.

---

## 9. Dashboards y KPIs
Visualiza el rendimiento operativo en tiempo real:
- **Métricas**: Tasa de conversión, volumen de mensajes y proactividad del bot.
- **Ayuda Visual**: Pasa el ratón sobre el icono `(i)` para ver el detalle de cada cálculo.

---

## 10. Gestión de Equipo (Multi-agentes)
- **Roles**: Administradores (acceso total) y Operadores (acceso limitado).
    - *Nota: El rol de administrador debe solicitar la creación de sus credenciales directamente al equipo de Soporte.*
- **Asignación de Leads**: Los administradores pueden asignar clientes a operadores específicos. Los operadores solo verán sus clientes asignados o aquellos "Libres".
