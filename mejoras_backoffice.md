# Mejoras Backoffice - Bot-ApiSWS

## 1. Visualización de Contacto
- El número de teléfono se muestra como dato principal en la lista de chats y en la cabecera.
- El nombre del cliente se muestra opcionalmente debajo (si está disponible).
- Se agregó el estado '🤖 Bot' / '👤 Humano' debajo del nombre.

## 2. Marcadores de Fecha
- Se implementaron separadores de fecha (estilo WhatsApp) dentro del historial de mensajes para distinguir entre días.

## 3. Gestión de Etiquetas (Tags)
- Se implementó un sistema de etiquetas con nombre y color.
- Las etiquetas se guardan en la base de datos (Supabase) y son específicas por bot (vía `project_id`).
- Interfaz para crear, editar y eliminar etiquetas.
- Posibilidad de asignar múltiples etiquetas a cada chat.
- Las etiquetas asignadas son visibles en la cabecera del chat y en la lista lateral.

## 4. Mensajería Multimedia
- Soporte para enviar imágenes y otros archivos cuando hay intervención humana.
- Botón de adjunto (📎) integrado en el área de entrada.
- Los mensajes multimedia se guardan en el historial.

## 5. Buscador y Filtros
- Buscador por número de teléfono o nombre en la lista de chats.
- Filtro por etiquetas para segmentar chats rápidamente.

## 6. Retorno Automático a Modo Bot
- Implementación de un worker en el backend que revisa la inactividad humana.
- Si pasan 15 minutos sin que un humano envíe mensajes en un chat con intervención activa, el bot se reactiva automáticamente.
- El worker revisa cada minuto.
- Enviar un mensaje desde el backoffice actualiza el timestamp de "última actividad humana" para reiniciar el contador de 15 minutos.

## 7. Diseño Visual (WhatsApp Web Estética)
- Rediseño completo inspirado en WhatsApp Web Dark Mode.
- **Paleta de Colores**: Uso de variables CSS para consistencia (Sidebar: `#111b21`, Chat: `#0b141a`, Burbujas: `#005c4b` y `#202c33`).
- **Burbujas de Mensaje**: Implementación de "colas" (tails) en las burbujas mediante pseudo-elementos (`::before`).
- **Layout**: Estructura de tres secciones (Sidebar, Chat content, Tag manager) con scrollbars personalizados.
- **Multimedia**: Previsualización de imágenes y videos directamente en las burbujas de chat.
- **Avatar**: Visualización de fotos de perfil (vía proxy de API) con iniciales de respaldo.

## Requisitos Técnicos
- Base de datos: Tablas `tags` y `chat_tags` en Supabase.
- Backend: `multer` para subida de archivos, nuevas rutas de API para tags, y worker de inactividad.
- Frontend: JavaScript nativo con Socket.IO para actualizaciones en tiempo real, CSS Variables y Flexbox/Grid para el layout fluido.
