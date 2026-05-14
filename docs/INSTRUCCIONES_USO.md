# 📘 Guía de Instrucciones de Uso - Bot-RialWay

Esta guía detalla el funcionamiento integral del sistema, desde la conexión inicial hasta la gestión avanzada de clientes, automatizaciones de IA e importación masiva de datos.

---

## 1. Conexión del Bot (WhatsApp)
Para poner en marcha el asistente:
1. Accede a la sección **Conexión** (Icono QR) en el menú lateral.
2. Si el bot no está vinculado, aparecerá un Código QR.
3. Desde tu teléfono de WhatsApp Business, ve a **Dispositivos Vinculados > Vincular un dispositivo**.
4. Escanea el QR. Una vez vinculado, verás el estado "Conectado" y la información del dispositivo.

---

## 2. Importación Masiva de Contactos (Excel)
Ahora puedes cargar bases de datos completas de clientes de forma sencilla:
- **Ubicación**: En la sección de **Conversaciones**, haz clic en el botón de la nube (Importar).
- **Plantilla Oficial**: Es fundamental usar el formato correcto. Haz clic en **"Descargar Plantilla Excel"** dentro del panel de importación.
- **Campos Admitidos**:
    - `phone`: Número con código de país (ej: 54911...).
    - `name`: Nombre del contacto.
    - `tags`: Etiquetas separadas por comas (ej: "Cliente, Interesado").
- **Procesamiento**: Al subir el archivo, el sistema creará los chats y asignará las etiquetas automáticamente, permitiendo que el bot inicie seguimientos o que los agentes los visualicen de inmediato.

---

## 3. Automatización de CRM y Estados de Lead
El sistema cuenta con una capa de inteligencia que gestiona el tablero Kanban sin intervención manual:
- **Asignación Automática de Estados**: Cuando el bot genera un resumen de la conversación, si detecta una etapa del proceso (ej: "Presupuesto", "Cierre"), el lead se moverá **automáticamente** a la columna correspondiente en el CRM.
- **Sincronización de Etiquetas**: Si la IA identifica nuevos intereses del cliente, las etiquetas se actualizarán en tiempo real tanto en la ficha del cliente como en el listado de chats.
- **Actualización en Tiempo Real**: Gracias a la tecnología de WebSockets, no necesitas refrescar la página. El tablero CRM se mueve y se actualiza solo ante cambios detectados por el backend o la IA.

---

## 4. Gestión de CRM (Tablero Kanban)
El CRM visual permite gestionar el embudo de ventas:
- **Lead Card**: Representa a un cliente potencial. Se crean automáticamente cuando alguien escribe o mediante importación.
- **Detalle del Lead**: Haz clic en cualquier tarjeta para gestionar:
    - Datos fiscales, dirección y producto de interés.
    - **Notas de Seguimiento**: Historial de comentarios con fecha y hora.
    - **Guardado rápido**: El botón "Guardar Ficha de Cliente" sincroniza instantáneamente los cambios con la base de datos central.

---

## 5. Coexistencia Bot/Humano
El sistema permite que un humano intervenga en cualquier conversación:
- **Interruptor Bot/Humano**: En cada chat puedes pausar la IA.
- **Modo Humano**: Al desactivar el bot, la IA dejará de responder. Útil para cierres de ventas complejos.
- **Reactivación**: El bot puede configurarse para reanudarse tras un periodo de inactividad del humano (Configurable en `System Config`).

---

## 6. Configuración Avanzada (System Config)
Control total sobre la inteligencia y seguridad del sistema:
- **Editor de Prompts**: Interfaz avanzada con resaltado de sintaxis para editar las instrucciones de hasta 5 asistentes diferentes.
- **Sincronización con OpenAI**: El botón "Sincronizar" permite traer las instrucciones configuradas directamente en el panel de OpenAI (Assistant ID) al backoffice.
- **Protección de Claves**: Las variables críticas (API Keys) están protegidas contra autocompletado accidental de navegadores y cuentan con una lista de "Keys Protegidas" para evitar sobreescrituras por error.
- **Persistencia Inteligente**: Las variables guardadas aquí tienen prioridad sobre los archivos de configuración estáticos, permitiendo cambios en caliente sin reiniciar el servidor en la mayoría de los casos.

---

## 7. Dashboards y KPIs
Visualiza el rendimiento de tu operación:
- **Tasa de Conversión**: Efectividad de cierre de leads.
- **Volumen de Mensajes**: Actividad total del día.
- **Proactividad del Bot**: Proporción de atención automática vs humana.
- **Tooltips Informativos**: Pasa el ratón sobre el icono `(i)` para entender cómo se calcula cada métrica.

---

## 8. Gestión de Equipo (Multi-agentes)
- **Roles**: Administradores (acceso total) y Sub-usuarios (acceso limitado).
- **Asignación de Chats**: Los admins pueden repartir la carga de trabajo asignando chats específicos a operadores.
- **Privacidad**: Los operadores solo visualizan en su tablero los clientes asignados a ellos o aquellos marcados como "Libres".
