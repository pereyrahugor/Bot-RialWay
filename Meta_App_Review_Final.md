# Guía de Permisos y Justificaciones para Meta App Review

Este documento contiene los textos necesarios (en español e inglés) para completar la solicitud de revisión de la aplicación en el Meta Developer Portal.

## 1. Permisos Solicitados

| Permiso | Propósito |
| :--- | :--- |
| `business_management` | Gestionar la integración con Business Manager y WABA. |
| `whatsapp_business_messaging` | Enviar y recibir mensajes de clientes vía WhatsApp. |
| `pages_messaging` | Gestionar mensajes de clientes vía Messenger. |
| `instagram_manage_messages` | Gestionar mensajes de clientes vía Instagram. |
| `pages_show_list` | Descubrir páginas de Facebook para vincular a la plataforma. |
| `whatsapp_business_management` | Gestionar plantillas y perfiles de WhatsApp Business. |

---

## 2. Justificación Técnica (Texto para enviar a Meta)

### Permiso: `business_management` (Crítico)

**Español:**
> Nuestra plataforma ofrece una solución integral de CRM y gestión de clientes para pequeñas y medianas empresas. Requerimos el permiso `business_management` para automatizar el proceso de "Onboarding" de cuentas de WhatsApp Business (WABA). Este permiso permite que nuestros usuarios vinculen sus cuentas de Business Manager con nuestra aplicación de forma transparente, permitiéndonos leer la salud de la cuenta (status de verificación y límites de mensajería) y gestionar sus activos de mensajería directamente desde nuestro panel de control. Sin este permiso, la experiencia de configuración sería altamente técnica y propensa a errores para el usuario final.

**English:**
> Our platform provide a comprehensive CRM and customer management solution for small and medium-sized businesses. We require the `business_management` permission to automate the onboarding process for WhatsApp Business Accounts (WABA). This permission allows our users to link their Business Manager accounts with our application seamlessly, enabling us to retrieve account health status (verification status and messaging tiers) and manage their messaging assets directly from our unified dashboard. Without this permission, the setup experience would be highly technical and error-prone for the end user.

---

### Permisos de Mensajería (`whatsapp_business_messaging`, `pages_messaging`, `instagram_manage_messages`)

**Español:**
> La función principal de nuestra aplicación es centralizar la comunicación de múltiples canales. Estos permisos son esenciales para que nuestra IA asistente y los agentes humanos puedan recibir mensajes entrantes de clientes y responder a sus consultas de soporte y ventas en tiempo real, manteniendo un historial unificado en nuestra base de datos para seguimiento post-venta.

**English:**
> The core functionality of our application is to centralize communication across multiple channels. These permissions are essential for our AI assistant and human agents to receive incoming customer messages and respond to their support and sales inquiries in real-time, maintaining a unified history in our database for post-sales tracking.

---

## 3. Guía para el Video de Demostración (Screencast)

Para que Meta apruebe estos permisos, el video debe mostrar:
1.  **Dashboard de Conexión:** Muestre la pantalla donde se ven los estados de la WABA (Verificado/No Verificado) y el Messaging Limit.
2.  **Onboarding:** Inicie la sesión con Facebook Login (si está implementado) o muestre cómo se vincula el ID de la WABA.
3.  **Chat en Tiempo Real:** Envíe un mensaje desde un teléfono de prueba a la WABA y muestre cómo llega al panel de control de la aplicación.
4.  **Respuesta de la IA:** Muestre a la IA respondiendo automáticamente basándose en la configuración del asistente.

---

Este documento ha sido generado para ayudar en el proceso de revisión de Meta.
