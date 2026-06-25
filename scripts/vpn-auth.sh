#!/bin/bash
# Verifica credenciales VPN contra el backend ERP.
# Llamado por OpenVPN con: auth-user-pass-verify <script> via-file
# OpenVPN escribe un archivo temporal: línea 1 = username, línea 2 = password.
#
# SEGURIDAD: username y password se escapan antes de embeber en JSON
# para evitar JSON injection. Se usa via-file para que las credenciales
# nunca queden expuestas en variables de entorno del proceso.

TMPFILE="$1"
[ -z "$TMPFILE" ]  && exit 1
[ ! -f "$TMPFILE" ] && exit 1

VPN_USER=$(sed -n '1p' "$TMPFILE")
VPN_PASS=$(sed -n '2p' "$TMPFILE")

[ -z "$VPN_USER" ] && exit 1

# Escapar caracteres especiales JSON: \ → \\ y " → \"
json_escape() {
  printf '%s' "$1" | sed 's/\\/\\\\/g; s/"/\\"/g'
}

UN=$(json_escape "$VPN_USER")
PW=$(json_escape "$VPN_PASS")

RESPONSE=$(curl -sf -m 5 \
  -X POST "http://127.0.0.1:4000/api/v1/openvpn/mikrotik-clients/verify-auth" \
  -H 'Content-Type: application/json' \
  -d "{\"username\":\"${UN}\",\"password\":\"${PW}\"}" 2>/dev/null)

[ $? -ne 0 ] && exit 1

echo "$RESPONSE" | grep -q '"success":true' && exit 0 || exit 1
