# ADR-010: Operación de oficina y notificaciones posteriores al commit

- Estado: Aceptado
- Fecha: 21 de septiembre de 2026

## Contexto

El dominio ya era autoridad para disponibilidad, citas, calendarios y clientes,
pero el dashboard no ofrecía un workspace diario ni una cronología operativa. Las
notificaciones tampoco podían participar de la transacción del proveedor de
calendario: un correo fallido no debe convertir una cita confirmada en fallida.

## Decisión

1. El calendario de oficina consulta Scheduling para huecos y Appointments para
   lecturas y mutaciones; no calcula disponibilidad en el navegador.
2. Los clientes y su historial permanecen tenant-scoped a partir de la sesión.
3. Cada mutación exitosa de cita agrega un evento operativo inmutable. El resultado
   completada/no presentada es un dato separado del estado de sincronización.
4. El correo transaccional se intenta después de persistir la cita y completar la
   operación de calendario. Su entrega tiene estado propio y no revierte la cita.
5. Las reglas de agenda y capacidades de IA son configuración estructurada por
   sucursal y se vuelven a comprobar en el backend.
6. Los roles de negocio se mapean sobre las dos capacidades históricas: administrar
   configuración y operar. `read_only` puede leer, pero un guard transversal rechaza
   todas sus mutaciones.

## Consecuencias

- La migración 10 es aditiva y crea eventos y entregas sin reescribir citas.
- El proveedor de correo puede cambiar detrás de `EmailSender`.
- Los reintentos de correo y recordatorios programados pueden añadirse después sin
  acoplarlos al servicio de citas.
- La aceptación live de PBX, Google y correo continúa siendo un gate del operador;
  el endpoint de readiness sólo informa configuración y relaciones conocidas.
