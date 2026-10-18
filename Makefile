.DEFAULT_GOAL := help
.PHONY: help install dev build preview start build-node build-static preview-static verify-health test test-cov lint format check \
	docker-build docker-up docker-down docker-logs docker-rebuild docker-verify docker-reset clean

help:
	@echo "Comandos disponibles:"
	@echo "  make install        Instala dependencias con pnpm"
	@echo "  make dev            Ejecuta el servidor de desarrollo"
	@echo "  make build          Compila para producción"
	@echo "  make build-node     Compila el artefacto del adapter-node (Docker)"
	@echo "  make build-static   Compila el artefacto del adapter-static (Render Static Site)"
	@echo "  make preview        Sirve el build de producción (Vite preview)"
	@echo "  make preview-static Sirve el artefacto estático localmente"
	@echo "  make start          Sirve el build de producción (adapter-node)"
	@echo "  make verify-health  Comprueba el endpoint /health del contenedor local"
	@echo "  make test           Ejecuta tests con Vitest"
	@echo "  make test-cov       Ejecuta tests con cobertura"
	@echo "  make lint           Ejecuta Prettier check + ESLint"
	@echo "  make format         Formatea el código con Prettier"
	@echo "  make check          Ejecuta svelte-check (typecheck)"
	@echo "  make clean          Limpia cachés y artefactos"
	@echo "  make docker-build   Construye la imagen Docker"
	@echo "  make docker-up      Levanta el contenedor con docker-compose"
	@echo "  make docker-down    Detiene el contenedor"
	@echo "  make docker-logs    Ver logs del contenedor"
	@echo "  make docker-rebuild Reconstruye sin caché y reinicia Docker"
	@echo "  make docker-verify  Verifica configuración y conectividad Docker"
	@echo "  make docker-reset   Detiene y borra el volumen (no persistimos datos)"

install:
	pnpm install

dev:
	pnpm dev

build:
	pnpm build

preview:
	pnpm preview

start:
	pnpm start

build-node:
	pnpm build:node

build-static:
	pnpm build:static

preview-static:
	pnpm preview:static

verify-health:
	@echo "--- GET /health on the local container ---"
	curl -fsS http://127.0.0.1:${APP_PORT:-3000}/health || (echo "Health check failed" && exit 1)

test:
	pnpm test

test-cov:
	pnpm test:cov

lint:
	pnpm lint

format:
	pnpm format

check:
	pnpm check

clean:
	rm -rf .svelte-kit build coverage node_modules/.vite

docker-build:
	docker build -t gameclient:local .

docker-up:
	docker compose up --build -d

docker-down:
	docker compose down

docker-logs:
	docker compose logs -f frontend

docker-rebuild:
	docker compose build --no-cache frontend
	docker compose up -d
	@echo "Rebuilt and restarted. Check http://localhost:3000"

docker-verify:
	@echo "--- Build args resolved by Compose ---"
	docker compose config | grep -A4 "args:"
	@echo ""
	@echo "--- URL embedded in the bundle ---"
	docker compose exec frontend sh -c 'grep -roE "host\\.docker\\.internal:8080|localhost:8080" build/ | head -3' || true
	@echo ""
	@echo "--- Container can reach the backend ---"
	docker compose exec frontend sh -c 'wget -qO- http://host.docker.internal:8080/health' || echo "Backend unreachable"

docker-reset:
	docker compose down -v