# Índice de decisiones arquitectónicas

Los ADR son registros inmutables. Una decisión reemplazada conserva su archivo y
se enlaza desde la decisión nueva. El estado operativo vive en
`docs/PROJECT_STATUS.md`.

| ADR | Estado | Decisión |
|---|---|---|
| [ADR-001](ADR-001-conversation-runtime.md) | Aceptado | Runtime único de conversación |
| [ADR-002](ADR-002-admin-authentication.md) | Aceptado | Autenticación, sesión y roles administrativos |
| [ADR-003](ADR-003-multi-location-business.md) | Aceptado | Modelo multi-sucursal y migración |
| [ADR-004](ADR-004-versioned-agent-configuration.md) | Aceptado | Configuración versionada del agente |
| [ADR-005](ADR-005-calendar-routing.md) | Aceptado | Enrutamiento de calendarios por asignación |
| [ADR-006](ADR-006-appointment-price-snapshots.md) | Aceptado | Money y snapshot de precios en citas |
| [ADR-007](ADR-007-ai-action-confirmation.md) | Aceptado | Confirmación de mutaciones solicitadas por IA |
| [ADR-008](ADR-008-intentional-call-completion.md) | Aceptado | Fin intencional de llamada después de respuesta y playback |

## Lectura histórica

Los apartados de implementación por fase en ADR-001 son evidencia de esas fases,
no pendientes actuales: la integración posterior agregó ARI y RTP. Consulte
[arquitectura actual](../ARCHITECTURE.md) y [estado](../PROJECT_STATUS.md).

## Cuándo crear un ADR

Se requiere antes de cambiar límites entre módulos, autoridad de datos,
seguridad, persistencia, compatibilidad o un contrato público. Un cambio local
que implementa una decisión ya aceptada sólo actualiza el roadmap y la
documentación del componente.
