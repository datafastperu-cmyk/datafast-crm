#!/bin/bash
# Verifica credenciales VPN usuario/contraseña contra el backend ERP.
# Llamado por OpenVPN via: auth-user-pass-verify <script> via-env
# OpenVPN inyecta: username y password como variables de entorno.

[ -z "${username}" ] && exit 1

RESPONSE=$(curl -sf -m 5 \
  -X POST "http://127.0.0.1:4000/api/v1/openvpn/mikrotik-clients/verify-auth" \
  -H 'Content-Type: application/json' \
  -d "{\"username\":\"${username}\",\"password\":\"${password}\"}" 2>/dev/null)

[ $? -ne 0 ] && exit 1

echo "${RESPONSE}" | grep -q '"success":true' && exit 0 || exit 1
