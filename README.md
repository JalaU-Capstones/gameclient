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

| Comando             | Descripción                      |
| ------------------- | -------------------------------- |
| `make install`      | Instala dependencias con pnpm    |
| `make dev`          | Inicia el servidor de desarrollo |
| `make build`        | Compila en producción            |
| `make preview`      | Previsualiza el build            |
| `make start`        | Sirve el build con adapter-node  |
| `make test`         | Ejecuta los tests                |
| `make test-cov`     | Ejecuta tests con cobertura      |
| `make lint`         | Ejecuta Prettier y ESLint        |
| `make format`       | Formatea el proyecto             |
| `make check`        | Ejecuta el typecheck de Svelte   |
| `make clean`        | Elimina cachés y artefactos      |
| `make docker-build` | Compila la imagen Docker         |
| `make docker-up`    | Levanta el contenedor            |
| `make docker-down`  | Detiene el contenedor            |
| `make docker-logs`  | Muestra logs del contenedor      |

## Desarrollo

```bash
pnpm dev
```

La aplicación se ejecuta en `http://localhost:5173` y usa el proxy de Vite para redirigir `/api` y `/health` hacia `http://localhost:8080`.

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

## Integración continua

El proyecto usa Vitest y SvelteKit para validar calidad en cada cambio. La cobertura mínima se deja en 70% para evitar regresiones en la capa de cliente.

## Docker

```bash
docker build -t gameclient:dev .
docker compose up
```

Variables relevantes:

- `PUBLIC_API_BASE`
- `PUBLIC_WS_BASE`
- `PUBLIC_REQUEST_TIMEOUT_MS`
- `ORIGIN` para `adapter-node`
- `APP_PORT`

## Licencia

Este proyecto se distribuye bajo la licencia MIT. Consulte [LICENSE](LICENSE).
