# Índice de decisiones arquitectónicas

Los ADR son registros inmutables. Una decisión reemplazada conserva su archivo y
se enlaza desde la decisión nueva. El estado operativo vive en
`docs/PROJECT_STATUS.md`.

| ADR | Estado | Decisión |
|---|---|---|
| [ADR-001](ADR-001-conversation-runtime.md) | Aceptado | Runtime único de conversación |
| [ADR-002](ADR-002-admin-authentication.md) | Aceptado | Autenticación, sesión y roles administrativos |
| [ADR-003](ADR-003-multi-location-business.md) | Aceptado | Modelo multi-sucursal y migración |
| ADR-004 | Pendiente | Configuración versionada del agente |
| ADR-005 | Pendiente | Enrutamiento de calendarios |
| ADR-006 | Pendiente | Snapshot de precios en citas |
| ADR-007 | Pendiente | Confirmación de mutaciones solicitadas por IA |

## Cuándo crear un ADR

Se requiere antes de cambiar límites entre módulos, autoridad de datos,
seguridad, persistencia, compatibilidad o un contrato público. Un cambio local
que implementa una decisión ya aceptada sólo actualiza el roadmap y la
documentación del componente.
