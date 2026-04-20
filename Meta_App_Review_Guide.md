# Guía de Permisos para App Review de Meta

Esta guía contiene la lista de permisos necesarios para habilitar todas las funcionalidades de **Neurolinks Bot Manager** (WhatsApp, Instagram y Messenger) y los textos justificativos recomendados para la revisión de Meta.

## 📋 Listado de Permisos a Solicitar

| Permiso | Uso Principal | Plataforma |
| :--- | :--- | :--- |
| `business_management` | Consultar estado de verificación y límites de WABA | Meta |
| `whatsapp_business_management` | Gestión de plantillas y configuración de WABA | WhatsApp |
| `whatsapp_business_messaging` | Envío y recepción de mensajes de clientes | WhatsApp |
| `instagram_manage_messages` | Bandeja de entrada unificada para Instagram | Instagram |
| `pages_messaging` | Bandeja de entrada unificada para Facebook | Messenger |
| `pages_show_list` | Listar páginas para selección del usuario | Facebook |
| `pages_read_engagement` | Lectura de eventos básicos de la página | Facebook |

---

## ✍️ Textos para la Justificación (Copy & Paste)

### 1. Business Management
**Explicación:**
Utilizamos este permiso para proporcionar transparencia proactiva a los dueños de negocios sobre la salud de sus activos. La plataforma consulta el `verification_status` y el `messaging_limit_tier` de sus cuentas de WhatsApp Business (WABA). Esto permite mostrar alertas críticas en nuestro tablero cuando un cliente alcanza su límite de mensajes y necesita completar la verificación de empresa para evitar interrupciones en su servicio de atención al cliente.

### 2. WhatsApp Business Management & Messaging
**Explicación:**
Nuestra aplicación integra la API de WhatsApp Cloud bajo el modelo "On-Behalf-Of" (OBO).
- **Messaging:** Permite la comunicación bidireccional entre la empresa y sus clientes finales, centralizando todas las conversaciones en nuestro CRM.
- **Management:** Permite a los usuarios finales gestionar sus plantillas de mensajes (Templates) y supervisar el estado de sus números de teléfono vinculados sin salir de nuestra interfaz de gestión.

### 3. Instagram Manage Messages
**Explicación:**
Requerimos este permiso para integrar la mensajería de Instagram Direct en nuestra bandeja de entrada unificada. Esto permite que agentes humanos respondan consultas de preventa y soporte técnico generadas en Instagram desde nuestra plataforma centralizada, permitiendo una gestión multi-agente eficiente de las solicitudes de los clientes.

### 4. Pages Messaging
**Explicación:**
Este permiso es esencial para habilitar la comunicación vía Facebook Messenger. El sistema recibe notificaciones de mensajes entrantes a través de webhooks y habilita a los operadores de chat para responder en tiempo real, garantizando que el negocio mantenga una tasa de respuesta alta y centralizada con sus clientes de Facebook.

---

## 🎥 Requisitos del Video de Demostración (Screencast)

Para que aprueben la solicitud, el video que subas debe mostrar obligatoriamente:

1.  **Login with Facebook:** El inicio de sesión desde tu aplicación web.
2.  **Uso de Permisos:**
    - Mostrar la lista de páginas de Facebook (usa `pages_show_list`).
    - Mostrar el panel donde aparecen el **Estado de Verificación** y los **Límite de Mensajería** (usa `business_management`).
    - Enviar un mensaje de prueba desde Instagram o Facebook y mostrar que llega a tu aplicación web.
3.  **App Icon y Branding:** Tu logo debe ser visible en el video para confirmar que la app es propia.

---

## 💡 Notas Adicionales para el Revisor
*"Nuestra plataforma es un CRM Multi-Agente diseñado para pequeñas y medianas empresas. La intención de solicitar estos permisos es permitir que los negocios unifiquen su comunicación en un solo tablero, automatizando respuestas simples con IA y derivando consultas complejas a agentes humanos de manera organizada."*
