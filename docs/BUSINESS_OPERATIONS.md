# Operación diaria del negocio

Verificado contra la implementación del 21 de septiembre de 2026. Este documento
describe el workspace operativo añadido sobre las capacidades de agenda existentes.

## Workspace de oficina

La navegación **Office schedule** concentra la operación diaria. Permite cambiar
entre día, semana, mes y agenda; filtrar por sucursal, servicio, profesional y
estado; ver citas y huecos calculados por el mismo dominio que utiliza el agente;
y abrir el detalle de una cita sin abandonar el calendario.

Desde un hueco disponible se puede buscar o crear un cliente y reservar. Desde una
cita se puede cancelar, reprogramar, marcar como completada o no presentada según
el rol y las políticas de la sucursal. El historial del cliente, la línea de tiempo
de la cita y el estado de las notificaciones se muestran en el mismo flujo.

## Perfil de cliente

Los clientes conservan nombre y teléfono y pueden incluir correo, idioma preferido,
consentimiento de correo, fuente y marcas de creación/actualización. La búsqueda es
tenant-scoped. El historial de citas también queda limitado al tenant autenticado;
los identificadores de tenant o región enviados por el navegador se rechazan.

La vista **Customers** funciona como libreta completa: carga todos los pacientes del
tenant sin un límite de búsqueda, permite filtrar por nombre/contacto o profesional,
muestra el equipo de atención inferido de las citas y abre la historia completa. El
panel lateral **Doctors & patients** incluye también profesionales sin pacientes.

La vista **Availability** consulta el mismo servicio de Scheduling para todos los
profesionales asignados al servicio y presenta sus huecos en paralelo. Elegir un
paciente en Customers permite reservar directamente desde uno de esos huecos.

## Ciclo de vida de una cita

Las mutaciones registran eventos de creación, reprogramación, cancelación,
finalización y ausencia. El precio y nombre del servicio permanecen congelados en
la cita. El resultado operativo (`COMPLETED` o `NO_SHOW`) no altera el historial
económico ni borra el evento de calendario.

## Correo transaccional

Las confirmaciones, reprogramaciones y cancelaciones pueden enviarse con Resend
cuando `RESEND_API_KEY` y `YIBO_EMAIL_FROM` están configurados. El envío ocurre sólo
después de que la mutación de cita y calendario haya tenido éxito. Una falla de
correo no revierte una cita confirmada: queda registrada como `FAILED`; ausencia de
correo, consentimiento, política o proveedor queda como `SKIPPED`. Sólo se persiste
un destino enmascarado, nunca el contenido completo ni la credencial.

## Reglas estructuradas por sucursal

Además de incrementos, anticipación, horizonte, capacidad y avisos ya existentes,
cada sucursal controla reserva el mismo día, cancelación, reprogramación y override
de personal. Las capacidades del agente permiten activar o desactivar reserva,
cambios, cancelación, precios, descripciones, alternativas, captura de contacto,
correo, transferencia y conducta fuera de horario. El backend vuelve a aplicar las
reglas; el prompt no es una frontera de autorización.

## Roles

Los roles actuales son `owner`, `office_manager`, `secretary`, `read_only` y los
roles compatibles históricos `tenant_admin` y `operator`. `read_only` no puede
realizar mutaciones. El owner y tenant_admin conservan acceso total; office_manager
administra configuración y operación; secretary opera clientes y agenda. El tenant
siempre procede de la sesión firmada.

## Readiness

`GET /api/admin/readiness` entrega a un administrador los bloqueos de proveedores y
los problemas de configuración por sucursal sin exponer secretos. Revisa Realtime,
telefonía, calendario, correo, números, catálogos, asignaciones y políticas. No
sustituye las pruebas live con PBX, calendario y correo de prueba.

## Persistencia y compatibilidad

La migración 10 añade metadatos de cliente, resultado de cita, eventos operativos y
entregas de notificación. Es aditiva e idempotente mediante `schema_migrations`.
Las configuraciones de sucursal antiguas reciben defaults conservadores al editarse,
por lo que el comportamiento anterior se conserva hasta que el administrador cambie
una regla.
