# ADR-005: Enrutamiento de calendarios por sucursal y profesional

- Estado: Aceptado
- Fecha: 10 de septiembre de 2026
- Alcance: Business, Scheduling, Appointments e integración Google

## Contexto

Un `calendarId` global no distingue sucursales ni profesionales y permite que
una llamada consulte o mute el calendario equivocado. OAuth, en cambio, sí es
una credencial compartida por el tenant y no debe duplicarse por calendario.

## Decisión

- Toda operación resuelve calendario con el contexto confiable
  `{tenantId, locationId, employeeId}`.
- La asignación del profesional tiene prioridad; el calendario predeterminado
  de la sucursal es el fallback.
- La zona horaria procede de la misma sucursal resuelta.
- OAuth y sus tokens cifrados permanecen tenant-scoped.
- `GOOGLE_CALENDAR_ID` deja de dirigir operaciones. Durante la transición sólo
  se importa una vez al default de la sucursal si ésta aún no tiene calendario.

## Consecuencias

- Consultar, crear y cancelar deben usar el resolver y fallar cerrados si no
  existe una asignación.
- Cambiar una asignación no cambia las credenciales OAuth del tenant.
- La administración y verificación de cada asignación usa el documento de
  negocio versionado. Un mapeo nuevo o cambiado sólo se guarda después de que
  Google confirme acceso con la credencial del tenant; las lecturas exponen un
  estado seguro por mapeo, nunca tokens.
