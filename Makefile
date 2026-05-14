# ══════════════════════════════════════════════════════════════════════
#  FibraNet ISP ERP — Makefile de despliegue
#  Uso: make <comando>
# ══════════════════════════════════════════════════════════════════════

.DEFAULT_GOAL := help
.PHONY: help install install-silent upgrade check status start stop restart \
        logs backup restore ssl update clean build push

SHELL := /bin/bash
VERSION := $(shell cat VERSION 2>/dev/null || echo "1.0.0")
DOCKER_REGISTRY := ghcr.io/tu-org
INSTALL_DIR := /opt/fibranet

# ── Colores ─────────────────────────────────────────────────────────
CYAN  := \033[0;36m
GREEN := \033[0;32m
NC    := \033[0m

## help: Mostrar este menú de ayuda
help:
	@echo ""
	@echo -e "$(CYAN)FibraNet ISP ERP v$(VERSION) — Comandos disponibles$(NC)"
	@echo ""
	@grep -E '^## ' $(MAKEFILE_LIST) | \
	  sed 's/## //' | \
	  awk -F': ' '{printf "  \033[36m%-20s\033[0m %s\n", $$1, $$2}'
	@echo ""

## install: Instalar FibraNet en este servidor (interactivo)
install:
	@echo -e "$(CYAN)Instalando FibraNet ISP ERP...$(NC)"
	@sudo bash install.sh

## install-silent: Instalar sin preguntas (requiere variables de entorno)
install-silent:
	@sudo bash install.sh --silent

## upgrade: Actualizar FibraNet a la última versión
upgrade:
	@sudo bash install.sh --upgrade

## check: Verificar requisitos del sistema sin instalar
check:
	@sudo bash install.sh --check

# ── Gestión del servicio ─────────────────────────────────────────────
## status: Ver estado completo del sistema
status:
	@fibranet status

## start: Iniciar la aplicación
start:
	@fibranet start

## stop: Detener la aplicación
stop:
	@fibranet stop

## restart: Reiniciar todos los servicios
restart:
	@fibranet restart

## reload: Recargar sin downtime (zero-downtime)
reload:
	@fibranet reload

## logs: Ver logs del backend
logs:
	@fibranet logs backend 100

## logs-frontend: Ver logs del frontend
logs-frontend:
	@fibranet logs frontend 100

# ── Datos ────────────────────────────────────────────────────────────
## backup: Crear backup manual de la base de datos
backup:
	@fibranet backup

## restore: Restaurar la base de datos desde un backup
restore:
	@fibranet restore

## db-stats: Ver estadísticas de la base de datos
db-stats:
	@fibranet db stats

## db-size: Ver tamaño de la base de datos
db-size:
	@fibranet db size

# ── SSL ──────────────────────────────────────────────────────────────
## ssl: Configurar SSL (uso: make ssl DOMAIN=erp.tuisp.pe)
ssl:
	@[[ -n "$(DOMAIN)" ]] || (echo "Uso: make ssl DOMAIN=tu-dominio.pe" && exit 1)
	@fibranet ssl $(DOMAIN)

# ── Docker ───────────────────────────────────────────────────────────
## build: Construir imágenes Docker
build:
	@echo -e "$(CYAN)Construyendo imágenes Docker...$(NC)"
	docker compose build

## push: Publicar imágenes en el registry
push:
	@echo -e "$(CYAN)Publicando imágenes v$(VERSION)...$(NC)"
	docker compose build
	docker tag fibranet/backend:latest  $(DOCKER_REGISTRY)/fibranet-backend:$(VERSION)
	docker tag fibranet/frontend:latest $(DOCKER_REGISTRY)/fibranet-frontend:$(VERSION)
	docker push $(DOCKER_REGISTRY)/fibranet-backend:$(VERSION)
	docker push $(DOCKER_REGISTRY)/fibranet-frontend:$(VERSION)
	@echo -e "$(GREEN)✓ Imágenes publicadas$(NC)"

## docker-up: Iniciar con Docker Compose
docker-up:
	docker compose up -d
	docker compose ps

## docker-down: Detener Docker Compose
docker-down:
	docker compose down

## docker-logs: Ver logs de Docker
docker-logs:
	docker compose logs -f

# ── Mantenimiento ────────────────────────────────────────────────────
## clean: Limpiar logs antiguos y cachés
clean:
	@echo -e "$(CYAN)Limpiando archivos temporales...$(NC)"
	find $(INSTALL_DIR)/logs -name "*.log" -mtime +30 -delete 2>/dev/null || true
	sudo -u fibranet pm2 flush 2>/dev/null || true
	@echo -e "$(GREEN)✓ Limpieza completada$(NC)"

## update: Actualizar FibraNet (código + dependencias + migraciones)
update:
	@fibranet update

## info: Ver información del sistema
info:
	@fibranet info
