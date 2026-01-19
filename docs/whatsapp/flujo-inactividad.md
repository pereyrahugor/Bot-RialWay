# ⏳ Inactividad (Idle Flow)

El **Idle Flow** es un mecanismo de seguimiento automático diseñado para reactivar conversaciones que han quedado en pausa o para cerrarlas formalmente tras un tiempo determinado.

## 🕒 Etapas de Seguimiento
El comportamiento se configura mediante variables de entorno que definen los tiempos (en minutos) y los mensajes a enviar.

### 1. Primer Seguimiento
- **Variable**: `timeOutSeguimiento1` (no vista directamente en todo el código, pero sigue el patrón).
- **Mensaje**: `msjSeguimiento1`.
- **Acción**: Se envía un recordatorio amistoso al usuario.

### 2. Segundo Seguimiento
- **Variable**: `timeOutSeguimiento2`.
- **Mensaje**: `msjSeguimiento2`.

### 3. Cierre Automático
- **Variable**: `timeOutCierre`.
- **Mensaje**: `msjCierre`.
- **Acción**: El bot se despide y marca el hilo como finalizado. Envía un reporte al grupo de WhatsApp configurado en `ID_GRUPO_RESUMEN_2`.

---

## ⚙️ Configuración Dinámica
Estos tiempos y mensajes pueden ser modificados en caliente desde el Dashboard web sin reiniciar el código, simplemente actualizando las variables de entorno de Railway.

---

## 🔗 Enlaces Cruzados
- [Variables de Entorno](../configuracion/variables-entorno.md)
- [Dashboard](../api/dashboard.md)
