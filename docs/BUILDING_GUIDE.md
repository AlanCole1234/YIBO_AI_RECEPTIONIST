# Guía para construir YIBO

## Fuentes de verdad

1. `YIBO_ARCHITECTURE_AND_CODEX_CONTRACTS.md`: invariantes generales.
2. `docs/adr/`: decisiones aceptadas y sus reemplazos.
3. `docs/ARCHITECTURE.md`: estructura y comportamiento presentes.
4. `docs/PROJECT_STATUS.md`: checkpoint, tareas y evidencia.

Si se contradicen, no se implementa silenciosamente: se corrige el documento
desactualizado o se registra un ADR que cambie la decisión.

## Flujo de una tarea

1. Marcar una sola tarea `IN_PROGRESS` en el estado del proyecto.
2. Identificar módulo dueño, contrato público, datos confiables e invariantes.
3. Escribir o ajustar la prueba que demuestre el comportamiento.
4. Implementar el cambio mínimo sin mezclar refactors no relacionados.
5. Ejecutar `pnpm typecheck` y las pruebas relevantes.
6. Actualizar arquitectura/ADR/runbook afectado y marcar la tarea `DONE`.
7. Crear un commit enfocado con código, prueba y documentación.

Un checkpoint exige además `pnpm test` y `pnpm build`.

## Reglas de diseño

- Los módulos se consumen mediante su `index.ts`; infraestructura implementa
  puertos y no define contratos de negocio.
- La IA nunca es frontera de autorización. Toda tool recibe datos no confiables
  y se combina con contexto de servidor.
- Toda consulta y mutación tenant-owned incluye tenant y, cuando corresponde,
  location como contexto confiable del servidor.
- Scheduling sólo consulta/valida. Appointments es dueño de mutaciones y vuelve
  a validar bajo control de concurrencia.
- Fechas internas en UTC; fechas humanas se interpretan en la zona IANA del
  negocio o sucursal.
- Errores externos se traducen a errores propios, tipados y seguros.
- Configuraciones persistidas se versionan y tienen un upgrader idempotente.
- Una migración nunca depende de borrar o recrear datos existentes.

## Cambios que requieren ADR previo

- Límites o dirección de dependencia entre módulos.
- Autoridad de tenant/location/cliente o política de autorización.
- Forma persistida incompatible o estrategia de migración.
- Nuevas garantías de concurrencia, confirmación o consistencia externa.
- Exposición de datos sensibles o cambios de retención.
- Integración de un proveedor que cambie contratos públicos.

## Pruebas esperadas

- Unitarias para reglas, validadores y upgraders puros.
- Contrato para puertos y adaptadores externos.
- Integración para SQLite, API, OAuth y composición.
- End-to-end para recorridos de llamada/voz y cita.
- Casos negativos de tenant, ownership, argumentos adicionales, replay,
  idempotencia, concurrencia, zona horaria y fallo externo.

## Comandos

```sh
pnpm typecheck
pnpm test
pnpm build
```

Para una prueba específica:

```sh
pnpm test -- tests/ruta/al-archivo.test.ts
```

## Definition of Done

- Una sola intención funcional completa.
- Contratos e índices públicos coherentes.
- Pruebas de éxito, fallo y aislamiento cuando aplique.
- Typecheck aprobado y sin secretos/PII en logs o fixtures.
- Documentación actualizada en el mismo commit.
- `PROJECT_STATUS.md` indica resultado y siguiente tarea.
