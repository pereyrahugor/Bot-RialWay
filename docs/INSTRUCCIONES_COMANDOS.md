# <i class="fas fa-terminal"></i> Guia de Instrucciones de Comandos Operativos y de Control

Esta guia detalla el funcionamiento, sintaxis, alcance y comportamiento de todos los comandos de control `#xxxx#` disponibles en el sistema **Bot-RialWay**, tanto para canales de **WhatsApp** (Meta API y Baileys) como para el entorno de pruebas de **WebChat** y las acciones operativas del **Backoffice**.

---

## 1. Caracteristicas Generales de los Comandos

- **Tolerancia de Formato**: Todos los comandos admiten tanto el formato cerrado con almohadillas (`#COMANDO#`) como el formato abierto (`#COMANDO`).
- **Insensibilidad a Mayusculas/Minusculas**: Los comandos se pueden escribir en mayusculas, minusculas o combinacion de ambas (ej: `#reset#`, `#Reset#`, `#RESET#`).
- **Prioridad de Ejecucion**: Los comandos de administracion se interceptan y procesan de forma inmediata en el servidor, incluso si el bot se encuentra desactivado temporalmente para la conversacion.
- **Segregacion Multi-Tenant y Multi-Servicio**: Las operaciones se ejecutan respetando de forma estricta el `project_id` y `service_id` de la instancia activa.

---

## 2. Comandos para WhatsApp (Meta Cloud API / Baileys)

Los siguientes comandos pueden enviarse directamente en cualquier conversacion de WhatsApp:

| Comando | Sintaxis Aceptada | Descripcion y Comportamiento |
| :--- | :--- | :--- |
| **Reset Asistente** | `#RESET#`<br>`#RESET` | Restablece la asignacion de agente a `asistente1`, elimina el `thread_id` en el estado y en la base de datos para que OpenAI inicie una sesion limpia de conversacion sin memoria previa. |
| **Hilo Nuevo** | `#HILO_NUEVO#`<br>`#HILO_NUEVO` | **Borra todo el historial de mensajes** del chat en la base de datos, restablece el agente a `asistente1` y limpia el `thread_id` de OpenAI, dejando el chat en estado inicial. |
| **Eliminar Contexto** | `#CLEAR_CONTEXT#`<br>`#ELIMINAR_CONTEXTO#` | Limpia los metadatos y datos recordados del cliente (nombre, direccion, DNI/CUIT, notas temporales) y vacia el hilo de memoria de la sesion. |
| **Activar Bot (Chat)** | `#ON#`<br>`#ON` | Reactiva las respuestas automaticas del bot **unicamente para la conversacion actual**. Si el contacto esta en la Lista Negra, el sistema impedira la activacion y mostrara una advertencia. |
| **Desactivar Bot (Chat)** | `#OFF#`<br>`#OFF` | Pausa el bot para la conversacion actual, activando el modo de **intervencion humana**. El bot permanecera silenciado hasta que un operador lo reactive o se ejecute `#ON#`. |
| **Activar Bot Global** | `#FULL_ON#`<br>`#FULL_ON` | Activa las respuestas automaticas del bot **globalmente en todas las conversaciones** del proyecto. |
| **Desactivar Bot Global** | `#FULL_OFF#`<br>`#FULL_OFF` | Apaga el bot **globalmente para todo el proyecto**. Ninguna conversacion entrante recibira respuestas automaticas de la IA hasta su reactivacion. |
| **Sincronizacion Total** | `#ACTUALIZAR#`<br>`#ACTUALIZAR` | Ejecuta la sincronizacion en caliente de: <br>1. Tablas y bases operativas de **Google Sheets**.<br>2. Re-indexacion de documentos y base vectorial **RAG**.<br>3. Herramientas y funciones (*Tools*) configuradas en los asistentes de OpenAI. |
| **Prueba de Grupos** | `#GRUPO_TEST#`<br>`#GRUPO_TEST` | Envia un mensaje de verificacion y prueba al grupo de reportes y resumenes configurado (`ID_GRUPO_RESUMEN`) mediante la sesion de Baileys. |

---

## 3. Comandos y Acciones en WebChat (Modo Prueba)

El modulo de **WebChat** cuenta con un entorno aislado para pruebas operativas de los asistentes de IA sin alterar las conversaciones reales de los clientes de WhatsApp.

### 3-a. Intercepcion de Comandos por Texto
Si escribes cualquiera de los comandos anteriores (`#RESET#`, `#HILO_NUEVO#`, `#CLEAR_CONTEXT#`, `#ACTUALIZAR#`, `#ON#`, `#OFF#`, etc.) en el campo de texto del WebChat, el sistema los interceptara inmediatamente sin enviarlos al modelo de lenguaje como mensajes normales, respondiendo con la confirmacion de la accion en tiempo real.

### 3-b. Botones de Accion Rapida (Barra Lateral y Movil)
El panel lateral del WebChat incluye botones dedicados para facilitar las pruebas:

- **<i class="fas fa-rotate-left"></i> Reset**: Reinicia el asistente a `asistente1` y limpia el hilo de memoria de la sesion actual de pruebas.
- **<i class="fas fa-broom"></i> Hilo Nuevo**: Limpia la pantalla del chat, vacia el historial de mensajes de la sesion y comienza una prueba desde cero.
- **<i class="fas fa-eraser"></i> Eliminar Contexto**: Borra variables temporales y datos recordados del cliente de prueba sin cerrar la conversacion.

---

## 4. Botones Operativos en la Vista de Conexion & Backoffice

En la vista **Conexion & Chatbot** (`/conexion`), dispones de herramientas de control global y por lotes:

### 4-a. Control de Sincronizacion y Motor
- **Toggle Estado Global**: Permite habilitar o deshabilitar la IA para todo el tenant al instante.
- **Recargar Motor**: Reinicia el proceso del contenedor para refrescar variables de entorno o reiniciar conexiones de socket sin ingresar a la consola del servidor.
- **Actualizar (Sincronizacion)**: Ejecuta el proceso equivalente a `#ACTUALIZAR#` sincronizando Google Sheets, base vectorial RAG y tools de OpenAI para todos los asistentes registrados (`asst_...`).

### 4-b. Gestion de Historial por Lotes
- **Seleccionar Chats**: Abre un modal con buscador que permite seleccionar uno, varios o todos los contactos registrados.
- **Reset**: Ejecuta `#RESET#` para todos los chats seleccionados, restableciendo su asistente asignado a `asistente1` y vaciando el thread en base de datos.
- **Hilo Nuevo**: Ejecuta `#HILO_NUEVO#` para todos los chats seleccionados tras confirmacion, eliminando el historial de mensajes y memoria de forma masiva.

---

## 5. Buenas Practicas y Recomendaciones

1. **Uso de `#ACTUALIZAR#` tras modificar Google Sheets**: Cada vez que agregues nuevos productos, precios o modifiques celdas en las hojas de Google integradas, ejecuta `#ACTUALIZAR#` (o pulsa *Actualizar* en el panel de Conexion) para que la IA absorba los cambios de inmediato.
2. **Uso de `#RESET#` ante cambios en Prompts**: Si ajustas las instrucciones del asistente en el panel de OpenAI o en las variables de configuracion, aplica un `#RESET#` en el chat del usuario para descartar el hilo anterior y forzar al modelo a cargar el nuevo comportamiento.
3. **Control de Intervencion Humana**: Si un operador toma la atencion de un chat en WhatsApp, puede enviar `#OFF#` para evitar que la IA responda por encima del agente humano.
