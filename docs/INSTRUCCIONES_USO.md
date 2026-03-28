# 📘 Guía de Instrucciones de Uso - Bot-RialWay

Esta guía detalla el funcionamiento integral del sistema, desde la conexión inicial hasta la gestión avanzada de clientes en el CRM.

---

## 1. Conexión del Bot (WhatsApp)
Para poner en marcha el asistente:
1. Accede a la sección **Conexión** (Icono QR) en el menú lateral.
2. Si el bot no está vinculado, aparecerá un Código QR.
3. Desde tu teléfono de WhatsApp Business, ve a **Dispositivos Vinculados > Vincular un dispositivo**.
4. Escanea el QR. Una vez vinculado, verás el estado "Conectado" y la información del dispositivo.

---

## 2. Coexistencia Bot/Humano
El sistema permite que un humano intervenga en cualquier conversación sin que el bot interfiera:
- **Indicador de Estado**: En el Backoffice, cada chat tiene un interruptor (Bot/Humano).
- **Modo Humano (Manual)**: Al desactivar el bot, la IA dejará de responder a ese número. Esto es útil para cierres de ventas o soporte personalizado.
- **Temporizador de Inactividad**: El bot puede configurarse para reactivarse automáticamente o cerrar el ticket tras un tiempo de inactividad (Configurable en `System Config`).
- **Último Mensaje**: Debajo del indicador, verás la hora exacta del último mensaje para monitorear la actividad.

---

## 3. Herramientas del Backoffice
El Backoffice es el centro de monitoreo en tiempo real:
- **Lista de Chats**: Filtrable por nombre, teléfono o etiquetas.
- **Historial**: Visualiza la conversación completa (mensajes del usuario, del asistente y del sistema).
- **Etiquetas**: Asigna categorías a los chats (ej: "Interesado", "Soporte", "Urgente") para segmentar la base de datos.
- **Búsqueda Rápida**: Puedes buscar palabras clave dentro de las notas y perfiles de los clientes.

---

## 4. Gestión de CRM y Leads
El CRM visual permite gestionar el embudo de ventas mediante un tablero Kanban:

### Cards y Leads
- **Lead Card**: Cada tarjeta en el tablero representa un cliente potencial.
- **Crear Lead Card**: Usa el botón verde en el CRM para crear una ficha manualmente si el cliente no inició por WhatsApp.
- **Detalle del Lead**: Haz clic en cualquier tarjeta para ver/editar:
    - Datos fiscales (CUIT/DNI, Dirección).
    - Producto ofrecido.
    - Notas con fecha (historial de seguimiento).
    - Recordatorios/Alertas visuales.

### Gestión de Equipo (Multi-agentes)
- **Nuevo Usuario**: (Solo Admins) Permite crear accesos para otros operadores.
- **Asignación**: Los administradores pueden asignar leads específicos a un miembro del equipo.
- **Privacidad**: Los operadores solo verán en su tablero los leads que tengan asignados o aquellos que estén "Libres" (sin asignar).

---

## 5. Tickets e Incidencias
Cada vez que un cliente requiere atención o avanza en el proceso, se genera un "Ticket":
- **Estados**: Abierto, En Progreso, Cerrado.
- **Sincronización**: Al mover una card entre columnas en el CRM, el ticket se actualiza automáticamente.
- **Historial de Interacciones**: Todas las acciones realizadas sobre un ticket quedan registradas para auditoría.

---

## 6. Configuración del Sistema (System Config)
Permite ajustar el comportamiento del bot sin tocar código:
- **Mensajes de IA**: Edita las instrucciones del asistente (Prompt) para cambiar su personalidad o conocimiento.
- **Hot Updates**: Los campos de **Usuario Admin** y **Contraseña** se pueden actualizar mediante el botón "Hot Update" y tienen efecto inmediato sin reiniciar el servidor.
- **Sincronización de Variables**: Para cambios estructurales (APIs, Tokens de Railway), usa el botón de "Sincronizar Variables" (requiere reinicio automático de ~2 min).

---

## 7. Dashboards y KPIs
En la sección principal encontrarás métricas clave:
- **Tasa de Conversión**: Porcentaje de leads que llegan al cierre.
- **Volumen de Mensajes**: Actividad total del día.
- **Proactividad del Bot**: Proporción de mensajes respondidos por IA vs Humanos.
- **Tiempo de Respuesta**: Promedio de demora en la atención.
- **Tooltips Informativos**: Pasa el ratón sobre el icono `(i)` de cada métrica para ver una explicación detallada de su cálculo.
