#!/bin/bash
# Llama al backend para verificar si la conexión VPN del CN es legítima.
# Si hay sesión activa que no responde al API → la mata y permite la nueva.
# Si hay sesión activa que SÍ responde → rechaza la nueva (es un duplicado).

CN="${common_name}"
[ -z "$CN" ] && exit 1

# CN solo puede tener: a-z A-Z 0-9 - _ (generado por el sistema)
if ! echo "$CN" | grep -qE "^[a-zA-Z0-9_-]+$"; then
  exit 1
fi

IP="${trusted_ip}"

RESPONSE=$(curl -sf -m 5 -X POST http://127.0.0.1:3000/api/v1/openvpn/mikrotik-clients/verificar-sesion-cn \
  -H 'Content-Type: application/json' \
  -d "{\"cn\":\"${CN}\",\"ipNueva\":\"${IP}\"}" 2>/dev/null)

# Si el backend no responde (caído/reiniciando) → fail open para no bloquear routers legítimos
[ $? -ne 0 ] && exit 0

PERMITIR=$(echo "$RESPONSE" | grep -o '"permitir":[^,}]*' | cut -d':' -f2 | tr -d ' "')

[ "$PERMITIR" = "true" ] && exit 0 || exit 1
