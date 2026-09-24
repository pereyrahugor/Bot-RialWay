# 📋 Registro Semanal de Cambios (Semana del 21 al 27 de Septiembre, 2026)

> Este documento acumula de forma continua las novedades, mejoras y correcciones realizadas durante la semana. Se actualiza automáticamente antes de cada commit.

---

### 🚀 Novedades
* **Agenda Central y Directorio de Contactos (24/09)**:
  * Nueva vista completa de Contactos con soporte multicanal (WhatsApp, Instagram, Facebook, Telegram y Webchat).
  * Ficha expandible por cliente con datos de contacto, ubicación, CUIT/DNI, condición fiscal, empresa y notas históricas.
  * Selector visual de etiquetas para clasificación y segmentación de clientes.
  * Formulario completo para agregar nuevos contactos y descargar plantilla de importación.
* **Sistema de Banners de Notificaciones Prioritarias (23/09)**:
  * Sistema de avisos emergentes superiores en tiempo real para comunicar a los usuarios del CRM novedades, mantenimientos programados o alertas técnicas directamente desde la consola y sin necesidad de deploys.

---

### ✨ Mejoras
* **Paginación y Navegación de Leads (24/09)**:
  * Barra de paginación al pie de la tabla de contactos que permite navegar rápidamente entre miles de leads y clientes.
  * Controles de primera/última página, anterior/siguiente y selector de cantidad de filas por pantalla (25, 50, 100, 200).
  * Contador dinámico que muestra el total exacto de contactos registrados por instancia.
* **Filtros Rápidos en Tiempo Real (24/09)**:
  * Búsqueda instantánea con reinicio automático de página al filtrar por canal, etiqueta o estado comercial (Leads / Oportunidades).

---

### 🐛 Correcciones
* **Navegación y Scroll en Contactos (24/09)**:
  * Resuelto el bloqueo que impedía hacer scroll con la rueda del mouse o barra lateral en pantallas con alta densidad de contactos.
* **Sincronización de Ajustes Multi-Servicio (23/09)**:
  * Corregido el error de duplicidad de clave única en base de datos al inicializar ajustes por servicio.
* **Recepción de Mensajes en Canales WhatsApp (22/09)**:
  * Ajustada la verificación de webhooks entrantes para garantizar la recepción continua e inmediata de mensajes hacia el bot y el CRM.
