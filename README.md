# GameClient

Frontend de SvelteKit para un juego de Tic-Tac-Toe que se integra con el backend FastAPI existente. Este cliente está pensado para trabajar con la API versionada del backend: `/api/v1` para REST heredados y `/api/v2` para REST y WebSocket.

[![CI](https://github.com/JalaU-Capstones/gameclient/actions/workflows/ci.yml/badge.svg)](https://github.com/JalaU-Capstones/gameclient/actions/workflows/ci.yml)

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

El proyecto incluye un `Makefile` que envuelve los comandos de pnpm para estandarizar el flujo de trabajo. Ejecuta `make help` para ver la lista completa.

| Comando             | Descripción                          |
| ------------------- | ------------------------------------ |
| `make install`      | Instala dependencias con pnpm        |
| `make dev`          | Servidor de desarrollo (Vite)        |
| `make build`        | Compila para producción              |
| `make preview`      | Previsualiza el build (Vite preview) |
| `make start`        | Sirve el build con adapter-node      |
| `make test`         | Ejecuta los tests                    |
| `make test-cov`     | Tests con cobertura                  |
| `make lint`         | Prettier check + ESLint              |
| `make format`       | Formatea con Prettier                |
| `make check`        | Typecheck con svelte-check           |
| `make clean`        | Limpia cachés y artefactos           |
| `make docker-build` | Construye la imagen Docker           |
| `make docker-up`    | Levanta el contenedor                |
| `make docker-down`  | Detiene el contenedor                |
| `make docker-logs`  | Ver logs del contenedor              |

## Desarrollo

```bash
pnpm dev
```

La aplicación se ejecuta en `http://localhost:5173`.

## Tests

```bash
pnpm test
pnpm test:cov
```

La suite tiene 8 tests. La cobertura actual es de 100% en líneas, 100% en funciones, 75% en ramas y 93.93% en sentencias.

## Lint y calidad

```bash
pnpm lint
pnpm check
pnpm format
```

## Estructura del proyecto

```text
.github/workflows/ci.yml
.gitlab-ci.yml
Makefile
src/
├── app.css
├── app.html
├── app.d.ts
├── lib/
│   ├── api/
│   │   └── client.ts
│   ├── components/
│   │   ├── GameTitle.svelte
│   │   ├── GameTitle.test.ts
│   │   ├── ThemeToggle.svelte
│   │   └── ThemeToggle.test.ts
│   ├── stores/
│   │   ├── theme.ts
│   │   └── theme.test.ts
│   ├── types/
│   │   └── api.ts
│   └── utils/
│       └── format.ts
├── routes/
│   ├── +layout.svelte
│   ├── +layout.ts
│   ├── +page.svelte
│   ├── login/+page.svelte
│   ├── register/+page.svelte
│   ├── lobby/+page.svelte
│   ├── game/[id]/+page.svelte
│   ├── profile/+page.svelte
│   ├── history/+page.svelte
│   └── logs/+page.svelte
├── vitest-setup.ts
└── app.css
```

## Diseño visual

La interfaz usa una estética retro tipo arcade con fondo oscuro, neon magenta, cyan y amarillo. Las fuentes utilizadas son:

- Press Start 2P para títulos
- Fredoka para texto general

El tema por defecto es oscuro y se puede alternar con un modo claro. La preferencia se guarda en `localStorage` y se aplica con la clase `dark` en el elemento `html`.

> Las fuentes Press Start 2P y Fredoka se distribuyen bajo la licencia Open Font License (OFL).

## Integración continua

El proyecto tiene pipelines configurados para GitHub Actions y GitLab CI.

### GitHub Actions (`.github/workflows/ci.yml`)

- `quality`: Prettier, ESLint y svelte-check con Node 22.
- `test`: matriz Node 22/24, tests con cobertura y compilación.
- `docker`: construye la imagen y ejecuta un smoke test en pushes a `main` y tags.

### GitLab CI (`.gitlab-ci.yml`)

Incluye jobs paralelos de lint, svelte-check, una matriz de tests con Node 22/24, compilación y construcción Docker en `main` y tags.

### Estrategia de cobertura

El umbral actual es **60%** en D1 (bootstrap). Se elevará a **70%** cuando se implementen las pantallas de autenticación, lobby y tablero (D2+). Los stubs de API y utilidades, las declaraciones de tipos, las rutas placeholder y el archivo barrel se excluyen temporalmente de la métrica.

## Docker

```bash
docker build -t gameclient:dev .
docker compose up
```

Variables de entorno relevantes:

- `PUBLIC_API_BASE`: URL pública de la API del backend.
- `ORIGIN`: URL pública del frontend, requerida por `adapter-node` para evitar redirecciones incorrectas.
- `APP_PORT`: puerto expuesto por Docker Compose.

## Integración con el backend

En desarrollo, el cliente usa un proxy de Vite para redirigir `/api` hacia `http://localhost:8080`. En producción se recomienda usar `PUBLIC_API_BASE` con la URL pública del backend para evitar depender del proxy local.

## Roadmap

Pantallas pendientes por implementar:

- Login
- Registro
- Lobby
- Tablero del juego
- Perfil de usuario
- Historial de partidas
- Logs del sistema
- Autenticación y guardas de rutas
- Integración WebSocket con el backend

## Licencia

Este proyecto se distribuye bajo la licencia MIT. Consulte [LICENSE](LICENSE).
