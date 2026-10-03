# GameClient

Frontend de SvelteKit para el juego. Este cliente encapsula el acceso HTTP y WebSocket hacia el backend FastAPI para que las pantallas de UI solo consuman módulos de API y stores, sin tener que manejar fetch ni sockets directamente.

## Stack

- SvelteKit
- TypeScript
- Tailwind CSS
- Vitest
- pnpm
- Docker

## Requisitos

- Node 22+
- pnpm 9+
- Docker

## Instalación

```bash
pnpm install
cp .env.example .env
```

## Comandos con Makefile

| Comando               | Descripción                             |
| --------------------- | --------------------------------------- |
| `make install`        | Instala dependencias con pnpm           |
| `make dev`            | Inicia el servidor de desarrollo        |
| `make build`          | Compila en producción                   |
| `make preview`        | Previsualiza el build                   |
| `make start`          | Sirve el build con adapter-node         |
| `make test`           | Ejecuta los tests                       |
| `make test-cov`       | Ejecuta tests con cobertura             |
| `make lint`           | Ejecuta Prettier y ESLint               |
| `make format`         | Formatea el proyecto                    |
| `make check`          | Ejecuta el typecheck de Svelte          |
| `make clean`          | Elimina cachés y artefactos             |
| `make docker-build`   | Compila la imagen Docker                |
| `make docker-up`      | Levanta el contenedor                   |
| `make docker-down`    | Detiene el contenedor                   |
| `make docker-rebuild` | Reconstruye sin caché y reinicia Docker |
| `make docker-logs`    | Muestra logs del contenedor             |

## Desarrollo

```bash
pnpm dev
```

La aplicación se ejecuta en `http://localhost:5173` y usa el proxy de Vite para redirigir `/api` y `/health` hacia `http://localhost:8080`.

## Docker

El cliente incluye un `Dockerfile` multi-stage y un `docker-compose.yml`
para desarrollo local y pruebas. El contenedor sirve el SPA construido
con `adapter-node` en el puerto `3000`.

### Levantar el stack

```bash
make docker-up       # o: docker compose up --build -d
```

Una vez arriba, abre <http://localhost:3000>.

### Build args vs runtime env vars

Las variables `PUBLIC_*` de SvelteKit se inline-an en el bundle **durante
el build**, no se leen en runtime. Por eso se pasan como `build.args` en
`docker-compose.yml` y no como `environment:`. Si solo se definieran en
`environment:`, el SPA se compilaría con valores vacíos y las peticiones
saldrían hacia el propio contenedor (404).

Variables de build:

- `PUBLIC_API_BASE` — Base URL del backend HTTP.
- `PUBLIC_WS_BASE` — Base URL del WebSocket.
- `PUBLIC_REQUEST_TIMEOUT_MS` — Timeout HTTP en milisegundos.

Variables de runtime (leídas por `adapter-node`):

- `PORT` — Puerto de escucha.
- `HOST` — Host de escucha.
- `ORIGIN` — Origen público del servidor (para URLs absolutas y
  redirects).

**Cualquier cambio en las variables de build requiere reconstruir la
imagen**, no solo reiniciar el contenedor:

```bash
docker compose build --no-cache frontend
docker compose up -d
```

### Comunicación con el backend

Dentro del contenedor **no existe el proxy de Vite**. El SPA necesita
URLs absolutas para hablar con el backend. Se configuran mediante dos
variables específicas de Docker:

| Variable                 | Default                 | Descripción                    |
| ------------------------ | ----------------------- | ------------------------------ |
| `DOCKER_PUBLIC_API_BASE` | `http://localhost:8080` | Base URL HTTP del backend      |
| `DOCKER_PUBLIC_WS_BASE`  | `http://localhost:8080` | Base URL WebSocket del backend |

**Nunca** se leen desde `PUBLIC_API_BASE`/`PUBLIC_WS_BASE` porque esos
valores están pensados para el modo `pnpm dev` (donde el proxy de Vite
los resuelve).

### Apuntar el contenedor a un backend desplegado

```bash
DOCKER_PUBLIC_API_BASE=https://gameapi-9vos.onrender.com \
DOCKER_PUBLIC_WS_BASE=https://gameapi-9vos.onrender.com \
docker compose up --build
```

### Apuntar el contenedor a un backend en el host

Cuando el backend corre en tu máquina (por ejemplo con `make dev` en el
repositorio `gameapi`) y el frontend corre en Docker, el contenedor
necesita una dirección para alcanzar el host.

El `docker-compose.yml` ya incluye:

```yaml
extra_hosts:
  - 'host.docker.internal:host-gateway'
```

Esto hace que `host.docker.internal` funcione igual en Linux, macOS y
Windows sin configuración adicional.

Configura el `.env`:

```
DOCKER_PUBLIC_API_BASE=http://localhost:8080
DOCKER_PUBLIC_WS_BASE=http://localhost:8080
```

El navegador es quien realiza las llamadas del SPA. Si el navegador y el
backend están en la misma máquina, debe usar `localhost`; el alias
`host.docker.internal` de `extra_hosts` solo se resuelve dentro de los
contenedores Docker y no en el navegador del host.

La entrada `host.docker.internal:host-gateway` permite verificar desde
el contenedor que se alcanza un backend que escucha en una interfaz del
host. Para comprobarlo, reconstruye y ejecuta `make docker-verify`:

```bash
make docker-rebuild
make docker-verify
```

### CORS en el backend

Cuando el frontend corre en `http://localhost:3000` y llama al backend en
`http://localhost:8080`, la petición es **cross-origin**. El backend debe
permitir ese origen con credenciales:

```
# En el .env del backend
CORS_ORIGINS=http://localhost:3000
```

Si el backend corre con `CORS_ORIGINS=*` y `allow_credentials=True`, el
navegador **rechazará** las respuestas por seguridad. Es una regla del
estándar CORS: no se puede combinar wildcard con credenciales.

### Troubleshooting

**Error 404 en `/api/v2/auth/*` desde el navegador:**

El contenedor está sirviendo el SPA pero no encuentra las rutas de la
API. Confirma que los build args y la URL configurada estén presentes:

```bash
# 1. Confirmar que Compose resolvió los build args
docker compose config | grep -A4 "args:"

# 2. Confirmar que la URL está en el bundle construido
docker compose exec frontend sh -c \
  'grep -roE "host\.docker\.internal:8080|localhost:8080" build/ | head -3'

# 3. Confirmar que el contenedor puede alcanzar el backend en el host
docker compose exec frontend sh -c \
  'wget -qO- http://host.docker.internal:8080/health || echo FAIL'
```

La primera salida debe mostrar las bases URL resueltas. La segunda debe
mostrar al menos una coincidencia con la URL configurada. La tercera
debe devolver `{"status":"ok"}`.

**Error CORS en el navegador:**

El backend no está permitiendo el origen del frontend. Verifica:

```bash
curl -i -X OPTIONS http://localhost:8080/api/v2/auth/login \
  -H "Origin: http://localhost:3000" \
  -H "Access-Control-Request-Method: POST" \
  -H "Access-Control-Request-Headers: content-type"
```

Debe devolver `Access-Control-Allow-Origin: http://localhost:3000` y
`Access-Control-Allow-Credentials: true`.

**Las cookies no se envían al backend:**

Los JWT viajan en cookies `HttpOnly`. Con `SameSite=Lax`, el navegador
las envía en peticiones cross-origin **siempre que ambos hosts
compartan el mismo dominio registrable**. `localhost:3000` y
`localhost:8080` lo comparten, por lo que las cookies funcionan en
local. En producción, si frontend y backend están en dominios
distintos, hay que configurar `SameSite=None; Secure` en el backend y
usar HTTPS.

## Estructura del proyecto

```text
src/
├── app.css
├── app.html
├── lib/
│   ├── api/
│   │   ├── client.ts
│   │   ├── errors.ts
│   │   ├── health.ts
│   │   └── ws.ts
│   ├── components/
│   │   └── GameTitle.svelte
│   ├── config.ts
│   ├── stores/
│   │   └── session.ts
│   ├── types/
│   │   ├── api.ts
│   │   └── ws.ts
│   └── index.ts
├── routes/
│   └── +page.svelte
├── vitest-setup.ts
└── app.d.ts
```

## Cliente HTTP y WebSocket

La capa de cliente se compone por capas pequeñas y reutilizables:

- `config`: lee `PUBLIC_*` y construye URLs para HTTP/WS.
- `api/client`: wrapper HTTP con timeout, parseo de JSON, manejo de `204` y errores tipados.
- `api/errors`: `ApiError`, `NetworkError` y `TimeoutError`.
- `api/health`: ejemplo concreto de endpoint de salud.
- `api/ws`: cliente WebSocket con handshake de autenticación, reconexión y ping/pong.
- `stores/session`: estado mínimo del usuario autenticado.

### Uso HTTP

```ts
import type { User } from '$lib/types/api';
import { httpClient } from '$lib/api/client';

const users = await httpClient.get<User[]>('/api/v1/users');
```

### Uso de endpoint concreto

```ts
import { healthApi } from '$lib/api/health';

const status = await healthApi.check();
```

### Manejo de errores

```ts
import { ApiError } from '$lib/api/errors';

try {
  await httpClient.get('/api/v1/profile');
} catch (err) {
  if (err instanceof ApiError && err.isUnauthorized) {
    // redirect o limpieza de sesión
  }
}
```

### Uso WebSocket

```ts
import { createGameplaysClient } from '$lib/api/ws';

const client = createGameplaysClient();
client.connect('jwt-token');

client.on('game_message', (payload) => {
  console.log('message', payload);
});

// cuando la pantalla termina:
client.disconnect();
```

### Variables de entorno

| Variable                    | Descripción                                                                                      |
| --------------------------- | ------------------------------------------------------------------------------------------------ |
| `PUBLIC_API_BASE`           | Base para llamadas HTTP. En desarrollo se deja vacía para usar el proxy de Vite.                 |
| `PUBLIC_WS_BASE`            | Base para WebSockets. En desarrollo se puede dejar vacía para derivarse desde `window.location`. |
| `PUBLIC_REQUEST_TIMEOUT_MS` | Timeout global de cada request HTTP, por defecto `15000`.                                        |

### Variables de entorno y CI

`src/lib/config.ts` lee las variables `PUBLIC_*` de manera defensiva: si
una variable no está definida, se usa un valor por defecto. Esto evita que
`svelte-check` falle en CI cuando no existe `.env`.

Aun así, los pipelines de GitHub Actions y GitLab CI declaran valores
placeholder en sus bloques `env:` y `variables:` para que `svelte-kit sync`
genere los tipos correctamente. Los valores reales se inyectan en el bundle
durante `pnpm build` (en Docker, mediante `build.args`).

### Pruebas

La capa de networking se valida con:

- `msw` para mocks de HTTP.
- `vitest-websocket-mock` para pruebas del cliente WebSocket.

### Reglas para los compañeros de UI

- Importa siempre módulos de endpoint (`healthApi`, `usersApi`, ...) en lugar de hacer `fetch` directo.
- Lee el estado de autenticación desde `$session` y `$isAuthenticated`; no duplicar el estado del usuario en componentes.
- Instancia clientes WebSocket por pantalla y llama a `disconnect()` en `onDestroy` cuando la vista deje de usarse.

## Tests

```bash
pnpm test
pnpm test:cov
```

La suite de clientes HTTP/WebSocket usa mocks reales y el umbral de cobertura actual es del 70%.

## Lint y calidad

```bash
pnpm lint
pnpm check
pnpm format
```

## Diseño visual

La interfaz usa una estética retro tipo arcade con fondo oscuro y colores neon. Los componentes visuales se mantienen mínimos en D2 para dejar la capa de negocio y la validación del backend bien estabilizada.

### Recursos y créditos

Los sonidos arcade, la tipografía y el favicon están documentados en
[`CREDITS.md`](./CREDITS.md), con sus respectivas licencias (CC0, SIL OFL,
MIT).

## Integración continua

El proyecto usa Vitest y SvelteKit para validar calidad en cada cambio. La cobertura mínima se deja en 70% para evitar regresiones en la capa de cliente.

## Licencia

Este proyecto se distribuye bajo la licencia MIT. Consulte [LICENSE](LICENSE).
