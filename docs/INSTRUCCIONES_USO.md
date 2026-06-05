# <i class="fas fa-book-open"></i> Guia de Instrucciones de Uso - Bot-RialWay

Esta guia detalla el funcionamiento integral del sistema, desde la conexion inicial hasta la gestion avanzada de clientes, automatizaciones de IA e importacion masiva de datos.

---

## 1. Conexion del Bot (WhatsApp)
Existen dos formas de conectar el sistema a WhatsApp, dependiendo de tus necesidades de estabilidad y volumen.

### 1-a. Proveedor No Oficial (Baileys / Codigo QR)
Este metodo utiliza una instancia de WhatsApp Web para conectar el bot:
1. Accede a la seccion **Conexion** (Icono QR) en el menu lateral.
2. Si el bot no esta vinculado, aparecera un Codigo QR.
3. Desde tu telefono de WhatsApp Business, ve a **Dispositivos Vinculados > Vincular un dispositivo**.
4. Escanea el QR. Una vez vinculado, veras el estado "Conectado".
- **Ventaja**: Implementacion inmediata sin procesos de aprobacion de Meta.
- **Limitacion**: Sujeto a cierres de sesion por inactividad del telefono fisico.

### 1-b. Proveedor Oficial (Meta Cloud API)
Este metodo utiliza la API oficial de WhatsApp para empresas:
1. Accede a **Meta Info** en el menu lateral (icono de Meta).
2. Configura los parametros desde el portal [Meta for Developers](https://developers.facebook.com/):
    - **WABA ID / Phone ID**: Identificadores unicos de tu cuenta y numero.
    - **Access Token**: Token de acceso permanente (System User).
    - **Webhook**: Configura la URL de tu servidor y el *Verify Token* definido en `System Config`.
3. **Sincronizacion SMB**: Desde este panel puedes forzar la sincronizacion de contactos e historial de mensajes acumulados en Meta.
- **Ventaja**: Maxima estabilidad, soporte multi-agente robusto y cumplimiento oficial de politicas.

---

## 2. Importacion Masiva y Plantillas (Excel)
Carga bases de datos de clientes existentes de forma masiva:
- **Ubicacion**: En la seccion de **Conversaciones**, haz clic en el boton de la nube (Importar).
- **Plantilla Oficial**: Haz clic en **"Descargar Plantilla Excel"** para obtener el formato compatible.
- **Campos**: `phone` (obligatorio), `name` y `tags` (opcionales).
- **Resultado**: El sistema creara los chats y asignara etiquetas inmediatamente, permitiendo segmentar tu base antes de que los clientes escriban.

---

## 3. Atencion Multimedia y Notas de Voz
> [!IMPORTANT]
> **Funcionalidad exclusiva de la version con Bot de Inteligencia Artificial.**

El asistente no solo lee texto, sino que interactua con contenido multimedia:
- **Notas de Voz**: El bot escucha y transcribe los audios de los clientes para responder contextualmente.
- **Analisis de Imagenes**: Puede procesar fotos (comprobantes, capturas de pantalla, productos) para extraer informacion o responder dudas sobre lo que "ve".
- **Interaccion Fluida**: Los usuarios pueden alternar entre audio y texto sin que el bot pierda el hilo de la conversacion.

---

## 4. Automatizacion y Derivacion Inteligente
> [!IMPORTANT]
> **Funcionalidad exclusiva de la version con Bot de Inteligencia Artificial.**

La IA actua como un gestor activo del flujo de ventas:
- **Movimiento de Columnas en CRM**: Al detectar un avance (ej: el cliente pide presupuesto o confirma una compra), la IA mueve la tarjeta del lead automaticamente en el tablero CRM.
- **Handover (Derivacion entre Asistentes)**: El sistema puede derivar a un cliente entre diferentes "perfiles" de IA (ej: de un *Recepcionista* a un *Vendedor Especializado*) de forma transparente para el usuario.
- **Asignacion de Etiquetas**: La IA categoriza al cliente en tiempo real (ej: "Urgente", "Interesado en Plan X") basandose en el analisis de la conversacion.

---

## 5. Gestion de CRM y Tablero Kanban
El centro de gestion comercial de tu equipo:
- **Tablero Visual**: Organiza a tus clientes en columnas segun su etapa de venta.
- **Busqueda y Filtros**: Puedes buscar clientes por nombre, telefono, notas o etiquetas. Utiliza la barra de busqueda superior para encontrar contactos especificos rapidamente.
- **Ficha del Lead**: Haz clic en cualquier tarjeta para ver el historial de notas, datos fiscales y actualizar el estado manualmente si es necesario.
- **Sincronizacion Real-Time**: Todos los movimientos se reflejan instantaneamente en las pantallas de todo el equipo mediante WebSockets.

---

## 6. Coexistencia Bot/Humano
Intervencion manual sin conflictos:
- **Interruptor Bot/Humano**: Pausa la IA en cualquier momento para tomar el control de la charla.
- **Reactivacion**: El bot puede configurarse para reanudarse tras un periodo de inactividad del humano (Parametrizado por el administrador).

---

## 7. Comandos de Control (WhatsApp)
Controla el sistema mediante mensajes de texto (Solo numeros autorizados):
- **#ON#**: Activa el bot **exclusivamente para el chat actual**.
- **#OFF#**: Desactiva el bot para el chat actual. No se reactiva por tiempo.
- **#RESET#**: Borra el historial de memoria del asistente para ese usuario.
- **#ACTUALIZAR#**: 
    - *Solo IA*: Sincroniza en caliente los datos de Google Sheets y refresca las instrucciones (Prompts) sin reiniciar el servidor.

---

## 8. Reportes Externos (Google Sheets)
> [!NOTE]
> **Los resumenes automaticos requieren la version con Bot de Inteligencia Artificial.**

- **Sincronizacion de Resumenes**: Al finalizar o pausarse una conversacion, la IA genera un resumen estructurado.
- **Hoja de Calculo Central**: Este resumen se envia automaticamente a una Google Sheet configurada, permitiendo llevar un registro de ventas, tickets o consultas fuera del sistema para analisis posterior.

---

## 9. Dashboards y KPIs
Visualiza el rendimiento operativo en tiempo real:
- **Metricas**: Tasa de conversion, volumen de mensajes y proactividad del bot.
- **Ayuda Visual**: Pasa el raton sobre el icono `(i)` para ver el detalle de cada calculo.

---

## 10. Gestion de Equipo (Multi-agentes)
- **Roles**: Administradores (acceso total) y Operadores (acceso limitado).
    - *Nota: El rol de administrador debe solicitar la creacion de sus credenciales directamente al equipo de Soporte.*
- **Asignacion de Leads**: Los administradores pueden asignar clientes a operadores especificos. Los operadores solo veran sus clientes asignados o aquellos "Libres".
