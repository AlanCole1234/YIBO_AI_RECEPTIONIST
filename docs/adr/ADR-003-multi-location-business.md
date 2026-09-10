# ADR-003: Perfil de negocio multi-sucursal determinado por número marcado

- Estado: Aceptado
- Fecha: 10 de septiembre de 2026
- Alcance: Business, Calls, Scheduling, Appointments e integraciones

## Contexto

El perfil vigente representa un tenant como una sola sede. Zona horaria,
horarios, números, servicios, profesionales y calendario están mezclados, por
lo que no es posible operar sucursales con políticas distintas sin confiar en
una selección realizada por el caller o por el modelo.

## Decisión

- Servicios y profesionales forman catálogos compartidos por tenant.
- Cada sucursal tiene `LocationId`, nombre, dirección, zona IANA, locale,
  números, horarios, cierres y políticas de agenda.
- Las ofertas de servicio, profesionales y calendarios son asignaciones de una
  sucursal; no duplican los catálogos.
- Cada número activo pertenece exactamente a una sucursal activa.
- El número marcado es la única fuente para resolver `{tenantId, locationId}`.
  El caller, el dashboard operativo y el modelo no pueden sustituir esa
  resolución durante una llamada.
- El perfil se versiona. Un lector acepta la forma histórica y la convierte de
  manera pura a una sucursal `default`, preservando IDs, números y horarios.
- La migración persistente agrega `location_id` sin borrar datos y rellena
  registros existentes con la sucursal predeterminada.

## Consecuencias

- Calls propaga tenant y sucursal como contexto confiable a tools, agenda y
  citas.
- Las APIs administrativas editan el documento versionado con concurrencia
  optimista; las fachadas históricas sólo viven durante la transición.
- Scheduling interpreta horas locales con la zona de la sucursal, mientras
  instantes persistidos continúan en UTC.
- No se implementa selección o cambio de sucursal por lenguaje natural.

## Compatibilidad

El perfil actual es la versión de entrada histórica. La actualización a la
versión multi-sucursal es automática e idempotente; ningún consumidor debe
inventar defaults distintos al upgrader canónico.
