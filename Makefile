# ══════════════════════════════════════════════════════════════════════
#  CRM ISP DATAFAST — Makefile de despliegue
#  Uso: make <comando>
# ══════════════════════════════════════════════════════════════════════

.DEFAULT_GOAL := help
.PHONY: help install install-silent upgrade check status start stop restart \
        logs backup restore ssl update clean build push

SHELL := /bin/bash
VERSION := $(shell cat VERSION 2>/dev/null || echo "1.0.0")
DOCKER_REGISTRY := ghcr.io/datafastperu-cmyk
INSTALL_DIR := /opt/datafast

# ── Colores ─────────────────────────────────────────────────────────
CYAN  := \033[0;36m
GREEN := \033[0;32m
NC    := \033[0m

## help: Mostrar este menú de ayuda
help:
	@echo ""
	@echo -e "$(CYAN)CRM ISP DATAFAST v$(VERSION) — Comandos disponibles$(NC)"
	@echo ""
	@grep -E '^## ' $(MAKEFILE_LIST) | \
	  sed 's/## //' | \
	  awk -F': ' '{printf "  \033[36m%-20s\033[0m %s\n", $$1, $$2}'
	@echo ""

## install: Instalar CRM ISP DATAFAST en este servidor (interactivo)
install:
	@echo -e "$(CYAN)Instalando CRM ISP DATAFAST...$(NC)"
	@sudo bash install.sh

## install-silent: Instalar sin preguntas (requiere variables de entorno)
install-silent:
	@sudo bash install.sh --silent

## upgrade: Actualizar CRM ISP DATAFAST a la última versión
upgrade:
	@sudo bash install.sh --upgrade

## check: Verificar requisitos del sistema sin instalar
check:
	@sudo bash install.sh --check

# ── Gestión del servicio ─────────────────────────────────────────────
## status: Ver estado completo del sistema
status:
	@datafast status

## start: Iniciar la aplicación
start:
	@datafast start

## stop: Detener la aplicación
stop:
	@datafast stop

## restart: Reiniciar todos los servicios
restart:
	@datafast restart

## reload: Recargar sin downtime (zero-downtime)
reload:
	@datafast reload

## logs: Ver logs del backend
logs:
	@datafast logs backend 100

## logs-frontend: Ver logs del frontend
logs-frontend:
	@datafast logs frontend 100

# ── Datos ────────────────────────────────────────────────────────────
## backup: Crear backup manual de la base de datos
backup:
	@datafast backup

## restore: Restaurar la base de datos desde un backup
restore:
	@datafast restore

## db-stats: Ver estadísticas de la base de datos
db-stats:
	@datafast db stats

## db-size: Ver tamaño de la base de datos
db-size:
	@datafast db size

# ── SSL ──────────────────────────────────────────────────────────────
## ssl: Configurar SSL (uso: make ssl DOMAIN=erp.tuisp.pe)
ssl:
	@[[ -n "$(DOMAIN)" ]] || (echo "Uso: make ssl DOMAIN=tu-dominio.pe" && exit 1)
	@datafast ssl $(DOMAIN)

# ── Docker ───────────────────────────────────────────────────────────
## build: Construir imágenes Docker
build:
	@echo -e "$(CYAN)Construyendo imágenes Docker...$(NC)"
	docker compose build

## push: Publicar imágenes en el registry
push:
	@echo -e "$(CYAN)Publicando imágenes v$(VERSION)...$(NC)"
	docker compose build
	docker tag datafast/backend:latest  $(DOCKER_REGISTRY)/datafast-backend:$(VERSION)
	docker tag datafast/frontend:latest $(DOCKER_REGISTRY)/datafast-frontend:$(VERSION)
	docker push $(DOCKER_REGISTRY)/datafast-backend:$(VERSION)
	docker push $(DOCKER_REGISTRY)/datafast-frontend:$(VERSION)
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
	sudo -u datafast pm2 flush 2>/dev/null || true
	@echo -e "$(GREEN)✓ Limpieza completada$(NC)"

## update: Actualizar CRM ISP DATAFAST (código + dependencias + migraciones)
update:
	@datafast update

## info: Ver información del sistema
info:
	@datafast info
