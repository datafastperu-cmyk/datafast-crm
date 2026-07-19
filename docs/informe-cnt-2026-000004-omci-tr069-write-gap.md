# Informe técnico — CNT-2026-000004 (continuación)

## Escritura OMCI del Managed Entity 137 (TR069 Management Server) no persiste en Huawei EG8145V5 / V5R020C10S195

**Fecha de la investigación:** 2026-07-18
**Autor:** Equipo ErpDatafast (aprovisionamiento nativo, sin SmartOLT)
**Estado:** Causa raíz aislada al nivel de OMCI/firmware. Descartadas todas las
causas de infraestructura, red y configuración del lado del ERP.

---

## 1. Resumen ejecutivo

El ERP aprovisiona ONTs Huawei EG8145V5 directamente sobre una OLT Huawei
MA5800-X7 vía OMCI (SSH CLI), sin depender de SmartOLT. Todo el aprovisionamiento
GPON (line-profile, srv-profile, service-ports, WAN PPPoE) funciona
correctamente. El único punto que falla es la activación del carril de gestión
TR-069: el comando OMCI que configura el Managed Entity 137 (ME137, "TR-069
Management Server") es **aceptado sin error por el CLI de la OLT**, pero el
ONT **nunca transmite ni una sola trama Ethernet** hacia el ACS configurado —
ni siquiera un Inform de arranque.

La misma unidad física, con el mismo firmware, gestionada por **SmartOLT**
(plataforma de terceros), **sí** logra que el ONT informe correctamente a un
ACS (confirmado con captura de tráfico en vivo). Esto descarta hardware o
firmware defectuoso como causa y confirma que existe algún paso o mecanismo
adicional que SmartOLT aplica y que no hemos logrado identificar pese a
igualar exactamente la sintaxis y el orden de los comandos OMCI visibles por
CLI.

---

## 2. Entorno

| Componente | Detalle |
|---|---|
| OLT | Huawei MA5800-X7 |
| Firmware OLT | (uptime 33 días al momento de la prueba, versión no capturada explícitamente — disponible bajo pedido) |
| ONT de prueba | EchoLife EG8145V5 GPON Terminal (CLASS B+) |
| Firmware ONT | V5R020C10S195 |
| Hardware ONT | 26AD.A |
| SN (hex) | 4857544378CA0FAA (HWTC78CA0FAA) |
| Posición GPON | F/S/P 0/1/8, ONT-ID 43 |
| ACS propio (GenieACS) | `http://10.8.1.1:7547` (alcanzable vía VPN interna, confirmado con ping y con sesiones HTTP reales) |
| ACS de SmartOLT (referencia) | `http://10.69.69.1:14501` |

---

## 3. Secuencia OMCI aplicada por el ERP (idéntica a la de SmartOLT)

Confirmada byte a byte contra el `running-config` real de una ONU
gestionada por SmartOLT en la misma OLT (SN HWTC16A6BAAC, gpon-onu_0/1/6:0,
online y funcionando en producción):

```
config
interface gpon 0/1
ont ipconfig 8 43 ip-index 0 static ip-address 10.16.0.10 mask 255.255.255.0 \
    gateway 10.16.0.1 pri-dns 8.8.8.8 vlan 1600 priority 2
ont tr069-server-config 8 43 profile-id <N>
quit
service-port 2001 vlan 1600 gpon 0/1/8 ont 43 gemport 3 multi-service \
    user-vlan 1600 tag-transform translate inbound traffic-table index <N> \
    outbound traffic-table index <N>
interface gpon 0/1
display ont ipconfig 8 43
```

`tr069-server-profile` (creado previamente, formato confirmado idéntico al
usado por SmartOLT en esta misma OLT — sin `auth-realm`, sin barra final en
la URL, password posicional sin keyword):

```
ont tr069-server-profile add profile-id <N> profile-name "DATAFAST-ACS" \
    url "http://10.8.1.1:7547" user "tr069" "<password>"
```

**Puntos ya descartados como causa** (cada uno probado y corregido durante
la investigación, sin cambio de resultado):

1. **Sintaxis de los comandos OMCI** — corregida para coincidir exactamente
   con el `running-config` real de SmartOLT.
2. **Orden de los comandos** — se probó primero creando el `service-port`
   antes de la config OMCI del ONT (fallaba); se corrigió al orden real de
   SmartOLT (`service-port` al final, después de cerrar el contexto
   `interface gpon`) — sin cambio de resultado.
3. **Formato del `tr069-server-profile`** — se encontraron y corrigieron dos
   diferencias reales (URL con barra final, `auth-realm` forzado que
   SmartOLT no usa) — sin cambio de resultado.
4. **Reboot físico** de la ONU.
5. **Factory reset físico real** (botón sostenido, no power-cycle) —
   metodología estricta: estado "congelado" antes del reset, GenieACS/Mongo
   limpiados, sniffer preparado, solo se ejecutó el flujo estándar del ERP
   sin ningún comando manual adicional después del reset.
6. **Ruteo y firewall de red** — se auditaron dos routers MikroTik
   intermedios (rutas, firewall filter forward, mangle/PBR por
   `src-address-list`) — limpios, sin bloqueo alguno para este tráfico.
7. **VLAN de gestión en el uplink de la OLT** — la VLAN 1600 (nuestra) está
   configurada en el uplink de la OLT exactamente igual que la VLAN 1500
   (la que usa SmartOLT, con 40 service-ports activos reales).

---

## 4. Evidencia de tráfico (sniffer en vivo, MikroTik `/tool sniffer`)

**Vía ERP (VLAN 1600, IP de gestión 10.16.0.10):** 7+ intentos
independientes, en distintas condiciones (antes y después de reboot, antes y
después de factory reset, con la secuencia OMCI original y con la corregida)
→ **0 tramas Ethernet** de la ONU en todos los casos. La tabla ARP del
router muestra la entrada como `stale` (nunca se refresca).

**Vía SmartOLT (VLAN 1500, IP de gestión asignada 10.15.0.135 / 10.15.0.169):**
sesiones HTTP reales y repetidas hacia `10.69.69.1:14501` — capturadas en
detalle, con el patrón típico de un Inform CWMP (handshake TCP + varios
paquetes HTTP en menos de 1 segundo). La entrada ARP correspondiente aparece
como `reachable`.

**Confirmación cruzada con GenieACS (nuestro propio ACS):** con la ONU
recién factory-reseteada, aprovisionada por el ERP, y con los datos ACS
escritos **manualmente** en el panel web del propio equipo (mismos valores
reales: `http://10.8.1.1:7547`, ConnReq user/pass reales) — el equipo
**sí** informó a GenieACS, confirmado con `lastInform` fresco (<2 minutos
después de aplicar). Esto prueba que la infraestructura de red, el ACS y las
credenciales del lado del ERP son 100% funcionales — el problema está
acotado exclusivamente a la escritura **automática vía OMCI**.

---

## 5. Estado del `display ont info` tras el bootstrap OMCI

```
Config state            : failed
Match state             : mismatch
...
TR069 management        : Enable
TR069 IP index           : 0
...
TR069 server profile ID  : <N>
TR069 server profile name: DATAFAST-ACS
```

El campo `TR069 management: Enable` y el binding al profile-id correcto
están presentes — es decir, la OLT reporta la configuración como aplicada
correctamente a nivel de su propia base de datos (Config state "failed" es
un indicador de sincronización general del ONT, no específico de TR-069, y
ya se documentó en el incidente original que no es fiable para diagnosticar
este problema puntual). Pese a esto, el ONT no genera tráfico.

---

## 6. Pista sin resolver — "WAN remote access" de SmartOLT

Al revisar el panel de SmartOLT se identificó un campo `allow_remote_access`
("Enabled from everywhere in the internet") en la configuración WAN del
ONT, que habilita el acceso remoto al panel web del equipo sobre su IP WAN
pública (PPPoE). Se investigó buscando el comando OMCI CLI equivalente en la
MA5800 (`ont wan-config`, `ont internet-config`, `ont home-gateway-config`,
`ont wan-profile`) sin encontrar el parámetro exacto antes de que la sesión
de pruebas se interrumpiera por inestabilidad de la conexión SSH. **No se
determinó si este mecanismo tiene relación con el problema de ME137** — es
una pista abierta, no una causa confirmada.

---

## 7. Preguntas para soporte Huawei / expertos OMCI

1. ¿Existe alguna diferencia conocida entre el comando CLI `ont
   tr069-server-config <port> <onu_id> profile-id <n>` y el mecanismo real
   que usan las plataformas de gestión OSS certificadas (como SmartOLT) para
   activar el ME137 (TR069 Management Server) en firmware V5R020C10S195?
   ¿El CLI garantiza la misma secuencia de SET OMCI subyacente que un cliente
   OSS "oficial"?
2. ¿El ME137 requiere que el `Interface Stack` (ME 421 / GAL Ethernet
   Profile / etc.) del ONT esté vinculado explícitamente a la interfaz de
   gestión antes de que la reconfiguración de `URL`/`Username`/`Password` del
   ME137 tenga efecto? El CLI de la MA5800 no expone ese binding como un
   comando separado — ¿se resuelve automáticamente al crear el IP-Host
   (`ont ipconfig ... ip-index 0 static`), o requiere un paso adicional no
   visible en el CLI estándar?
3. ¿Existe una traza OMCI de bajo nivel (binario, no CLI) disponible desde
   la OLT MA5800 para comparar transacción por transacción una sesión que
   SÍ activa el ME137 (SmartOLT) contra una que no (nuestro caso)?
4. ¿El firmware V5R020C10S195 tiene algún comportamiento documentado donde
   el ME137 requiere que el ONT haya salido de un **estado "vendido"/no
   gestionado por ningún ACS previamente** — es decir, podría haber una
   diferencia de comportamiento entre un ONT que nunca fue gestionado por
   ningún ACS vs. uno que ya tuvo un ACS distinto activo (aunque se haya
   hecho factory reset)?
5. Comando/parámetro CLI exacto de la MA5800 equivalente al "WAN remote
   access" que expone SmartOLT en su panel (ver sección 6).

---

## 8. Cómo reproducir

Todo el código y las herramientas usadas están en el repositorio
`erpdatafast-isp`:

- Secuencia OMCI: `olt-automation-service/app/services/provisioning.py`,
  función `provision_mgmt_bootstrap`.
- Catálogo de capacidad por modelo/firmware:
  `backend/src/modules/olt-nativo/capability/cpe-provisioning-catalog.ts`.
- Resolver de canales (OMCI + fallback HTTP, con verificación real contra
  GenieACS antes de reportar éxito — nunca se asume éxito solo porque el
  CLI no reportó error):
  `backend/src/modules/olt-nativo/services/cpe-provisioning/provisioning-strategy-resolver.service.ts`.
