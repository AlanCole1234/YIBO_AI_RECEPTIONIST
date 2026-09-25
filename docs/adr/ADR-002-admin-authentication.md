# ADR-002: Sesiones administrativas firmadas y autorización por rol

- Estado: Aceptado
- Fecha: 10 de septiembre de 2026
- Alcance: API y dashboard administrativos

## Contexto

La aplicación obtiene el tenant local desde bootstrap y permite mutar negocio y
agente sin identidad administrativa. Ampliar esa superficie antes de establecer
autoridad convertiría `tenantId` en un dato controlable por el navegador.

## Decisión

- El dominio de autenticación expone contratos neutrales; Fastify y cookies son
  adaptadores.
- `AdminPrincipal` contiene `subject`, `tenantId`, roles, emisión y expiración.
- Roles iniciales: `tenant_admin` configura y opera; `operator` sólo opera.
- El login verifica credenciales tenant-scoped almacenadas con scrypt.
- La sesión dura ocho horas y viaja en cookie HttpOnly, SameSite=Lax y Secure
  fuera de desarrollo, firmada HMAC-SHA256.
- El tenant efectivo procede exclusivamente de la sesión y debe coincidir con el
  tenant del proceso durante la etapa local actual.
- Las mutaciones verifican Origin además de la cookie.
- Cierre de sesión y revocación invalidan el identificador de sesión.

## Consecuencias

- Health y callbacks externos explícitos pueden permanecer públicos.
- Las rutas administrativas deben declarar el rol requerido.
- Ninguna API administrativa acepta tenant por body, query o header.
- Cambiar a OIDC sustituirá puertos/adaptadores sin alterar autorización.
