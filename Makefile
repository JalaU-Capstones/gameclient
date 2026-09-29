.DEFAULT_GOAL := help
.PHONY: help install dev build preview start test test-cov lint format check \
	docker-build docker-up docker-down docker-logs docker-reset clean

help:
	@echo "Comandos disponibles:"
	@echo "  make install        Instala dependencias con pnpm"
	@echo "  make dev            Ejecuta el servidor de desarrollo"
	@echo "  make build          Compila para producción"
	@echo "  make preview        Sirve el build de producción (Vite preview)"
	@echo "  make start          Sirve el build de producción (adapter-node)"
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

docker-reset:
	docker compose down -v