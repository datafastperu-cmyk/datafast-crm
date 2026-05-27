#!/bin/bash
# Rechaza conexiones de clientes no registrados en la DB

CN="${common_name}"
[ -z "$CN" ] && exit 1

# CN solo puede tener: a-z A-Z 0-9 - _ (generado por el sistema)
if ! echo "$CN" | grep -qE "^[a-zA-Z0-9_-]+$"; then
  exit 1
fi

RESULT=$(PGPASSWORD=3WawA4MuRZxTcXcyQkeaHGlq psql -h localhost -U datafast_db_user -d datafast_db -tAc \
  "SELECT COUNT(*) FROM vpn_clientes WHERE (nombre_cert = '${CN}' OR vpn_usuario = '${CN}') AND activo = true AND estado != 'revocado'" 2>/dev/null)

[ "$RESULT" = "1" ] && exit 0 || exit 1
