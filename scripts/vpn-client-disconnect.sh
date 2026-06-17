#!/bin/bash
# Notifica al backend ERP cuando OpenVPN cierra un túnel cliente.
# Llamado por OpenVPN via: client-disconnect <script>
# OpenVPN inyecta: common_name como variable de entorno.
#
# Este script actualiza el estado del cliente en BD inmediatamente,
# evitando que el frontend muestre túneles como activos cuando ya cayeron.

CN="${common_name}"
[ -z "$CN" ] && exit 0

# CN solo puede tener: a-z A-Z 0-9 - _ (generado por el sistema)
if ! echo "$CN" | grep -qE '^[a-zA-Z0-9_-]+$'; then
  exit 0
fi

curl -sf -m 3 \
  -X POST "http://127.0.0.1:4000/api/v1/openvpn/mikrotik-clients/disconnect-notify" \
  -H 'Content-Type: application/json' \
  -d "{\"cn\":\"${CN}\"}" 2>/dev/null || true

exit 0
