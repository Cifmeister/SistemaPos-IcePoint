# Notas de Lanzamiento v1.6.0 - Auditoría de Caja y Flujo de Efectivo

## 🛡️ Nueva Funcionalidad: Auditoría de Caja (Cartola)
Se ha implementado un sistema completo de seguimiento de efectivo para eliminar descuadres de caja y proporcionar transparencia total.

- **Cartola de Caja en Tiempo Real**: Visualización de cada movimiento de efectivo (ventas, pagos, ingresos/egresos manuales) con marca de tiempo y origen.
- **Resumen de Cuadratura**: Panel interactivo con Apertura, Ingresos Totales, Egresos Totales y Monto Esperado en Caja.
- **Movimientos Manuales**: Nuevos controles para registrar entradas y salidas de efectivo no relacionadas con ventas (ej. pago a proveedores, retiro de excedentes).
- **Registro Automático de Ventas y Fiados**: Cada transacción en efectivo se vincula automáticamente a la auditoría del turno actual.
- **Trazabilidad de Anulaciones**: Los reembolsos por ventas anuladas se registran automáticamente como egresos de caja.

## 🧾 Mejoras en Historial
- Se optimizó la carga de datos en el historial de ventas.
- Se corrigió el error que impedía visualizar el resumen de ventas en algunos entornos.

## 🛠️ Correcciones Técnicas
- **Hotfix IPC/Preload**: Se restauraron llamadas a funciones del puente de Electron que causaban bloqueos en la pestaña de reportes.
- **Estabilidad de Base de Datos**: Nueva tabla de movimientos auto-gestionada por el turno activo.
