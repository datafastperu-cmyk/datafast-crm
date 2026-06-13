FROM python:3.11-slim AS base

# easysnmp requiere libsnmp de Net-SNMP; curl para healthcheck
RUN apt-get update && apt-get install -y --no-install-recommends \
        libsnmp-dev \
        snmp \
        curl \
    && rm -rf /var/lib/apt/lists/*

WORKDIR /app

COPY requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt

# ── Producción ────────────────────────────────────────────────────────────────
FROM base AS production

COPY . .

EXPOSE 8001
CMD ["uvicorn", "app.main:app", "--host", "0.0.0.0", "--port", "8001", "--workers", "2"]

# ── Desarrollo (hot-reload) ───────────────────────────────────────────────────
FROM base AS development

EXPOSE 8001
CMD ["uvicorn", "app.main:app", "--host", "0.0.0.0", "--port", "8001", "--reload"]
