'use client';

import { useState } from 'react';
import {
  Radio, Wifi, Monitor, Phone, Download, ScrollText,
  Search, Shield, Server, Globe, ChevronRight, ChevronDown,
  Activity, Power, RotateCcw, RefreshCcw, Zap,
  Settings, BarChart2, Home, Network, Plus, Eye, EyeOff,
} from 'lucide-react';
import { cn } from '@/lib/utils';

const SECTIONS = [
  { key: 'general',         label: 'General',                   icon: Home      },
  { key: 'ppp',             label: 'PPP Interface 3.1',         icon: Globe     },
  { key: 'portforward',     label: 'Port Forward',              icon: Network   },
  { key: 'ipinterface',     label: 'IP Interface 4.1',          icon: Globe     },
  { key: 'landhcp',         label: 'LAN DHCP Server',           icon: Server    },
  { key: 'lanports',        label: 'LAN Ports',                 icon: Network   },
  { key: 'lancounters',     label: 'LAN Counters',              icon: BarChart2 },
  { key: 'wlan1',           label: 'Wireless LAN 1',            icon: Wifi      },
  { key: 'wlan5',           label: 'Wireless LAN 5',            icon: Wifi      },
  { key: 'wlancounters',    label: 'WLAN Counters',             icon: BarChart2 },
  { key: 'wifi24',          label: 'Wifi 2.4GHz Site Survey',   icon: Radio     },
  { key: 'wifi5',           label: 'Wifi 5GHz Site Survey',     icon: Radio     },
  { key: 'hosts',           label: 'Hosts',                     icon: Monitor   },
  { key: 'security',        label: 'Security',                  icon: Shield    },
  { key: 'voicelines',      label: 'Voice lines',               icon: Phone     },
  { key: 'misc',            label: 'Miscellaneous',             icon: Settings  },
  { key: 'troubleshooting', label: 'Troubleshooting',           icon: Search    },
  { key: 'devicelogs',      label: 'Device Logs',               icon: ScrollText},
  { key: 'firmware',        label: 'File & Firmware management',icon: Download  },
];

const BTN_PRIMARY = 'px-3 py-1.5 text-xs font-semibold rounded bg-primary text-primary-foreground hover:bg-primary/90 transition-colors';
const BTN_OUTLINE = 'px-3 py-1.5 text-xs font-semibold rounded border border-border text-foreground hover:bg-accent transition-colors';
const INPUT_CLS   = 'w-full px-3 py-2 text-sm border border-input rounded-lg bg-background text-foreground focus:outline-none focus:ring-1 focus:ring-primary transition-colors';

// ── Fila de info (label: valor) ───────────────────────────────
function InfoRow({ label, value }: { label: string; value?: React.ReactNode }) {
  return (
    <div className="flex items-start gap-2 py-1.5 border-b border-border/40 last:border-0">
      <span className="text-xs text-muted-foreground min-w-[130px] flex-shrink-0">{label}</span>
      <span className="text-xs text-foreground font-medium">{value ?? <span className="text-muted-foreground/50">—</span>}</span>
    </div>
  );
}

// ── Panel superior de info ONU ────────────────────────────────
function OnuInfoPanel() {
  const [showPppoePass, setShowPppoePass] = useState(false);
  const [showPppoeUser, setShowPppoeUser] = useState(false);

  return (
    <div className="grid grid-cols-1 md:grid-cols-2 gap-0 border-b border-border">
      {/* Columna izquierda */}
      <div className="px-5 py-4 border-b md:border-b-0 md:border-r border-border/60">
        <InfoRow label="OLT"               value={undefined} />
        <InfoRow label="Board"             value={undefined} />
        <InfoRow label="Port"              value={undefined} />
        <InfoRow label="ONU"               value={undefined} />
        <InfoRow label="GPON channel"      value={undefined} />
        <InfoRow label="SN"                value={undefined} />
        <InfoRow label="ONU type"          value={undefined} />
        <InfoRow label="Zone"              value={undefined} />
        <InfoRow label="ODB (Splitter)"    value={undefined} />
        <InfoRow label="Name"              value={undefined} />
        <InfoRow label="Address or comment" value={undefined} />
        <InfoRow label="Contact"           value={undefined} />
        <InfoRow label="Authorization date" value={undefined} />
        <InfoRow label="ONU external ID"   value={undefined} />
      </div>

      {/* Columna derecha */}
      <div className="px-5 py-4">
        {/* Imagen ONU placeholder */}
        <div className="flex justify-center mb-4">
          <div className="w-48 h-20 rounded-lg bg-muted/40 border border-border/60 flex items-center justify-center">
            <Radio className="w-10 h-10 text-muted-foreground/30" />
          </div>
        </div>

        <InfoRow label="Status"         value={undefined} />
        <InfoRow label="ONU/OLT Rx signal" value={undefined} />
        <InfoRow label="Attached VLANs" value={undefined} />
        <InfoRow label="ONU mode"       value={undefined} />
        <InfoRow label="TR069"          value={undefined} />
        <InfoRow label="Mgmt IP"        value={undefined} />
        <InfoRow label="WAN setup mode" value={undefined} />

        {/* PPPoE username con ojo */}
        <div className="flex items-start gap-2 py-1.5 border-b border-border/40">
          <span className="text-xs text-muted-foreground min-w-[130px] flex-shrink-0">PPPoE username</span>
          <div className="flex items-center gap-1">
            <span className="text-xs text-foreground font-medium font-mono">
              {showPppoeUser ? '—' : '—'}
            </span>
            <button onClick={() => setShowPppoeUser(v => !v)} className="text-muted-foreground hover:text-foreground transition-colors">
              {showPppoeUser ? <EyeOff className="w-3 h-3" /> : <Eye className="w-3 h-3" />}
            </button>
          </div>
        </div>

        {/* PPPoE password con ojo */}
        <div className="flex items-start gap-2 py-1.5">
          <span className="text-xs text-muted-foreground min-w-[130px] flex-shrink-0">PPPoE password</span>
          <div className="flex items-center gap-1">
            <span className="text-xs text-foreground font-medium font-mono">
              {showPppoePass ? '—' : '—'}
            </span>
            <button onClick={() => setShowPppoePass(v => !v)} className="text-muted-foreground hover:text-foreground transition-colors">
              {showPppoePass ? <EyeOff className="w-3 h-3" /> : <Eye className="w-3 h-3" />}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}

// ── Componente principal ──────────────────────────────────────
export function TabOnuRouter({ clienteId }: { clienteId: string }) {
  const [live,     setLive]     = useState(false);
  const [expanded, setExpanded] = useState<string | null>(null);
  const [fwFile,   setFwFile]   = useState('');

  function toggle(key: string) {
    setExpanded(prev => prev === key ? null : key);
  }

  return (
    <div className="p-4 space-y-4">

      {/* ── Header ─────────────────────────────────────────────── */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <Radio className="w-4 h-4 text-primary" />
          <span className="text-sm font-semibold text-foreground">ONU / Router</span>
        </div>
        <button
          className="flex items-center gap-1.5 px-4 py-2 text-xs font-semibold rounded-lg
                     bg-primary text-primary-foreground hover:bg-primary/90 transition-colors shadow-sm"
        >
          <Plus className="w-3.5 h-3.5" />
          Conectar ONU
        </button>
      </div>

      {/* ── Panel principal ─────────────────────────────────────── */}
      <div className="border border-border rounded-xl overflow-hidden">

        {/* Info ONU */}
        <OnuInfoPanel />

        {/* Botones de acción */}
        <div className="flex items-center gap-2 flex-wrap px-4 py-3 border-b border-border bg-muted/20">
          <button className={BTN_PRIMARY}>Get status</button>
          <button className={BTN_OUTLINE}>Show running-config</button>
          <button className={BTN_OUTLINE}>SW info</button>
          <button className={BTN_OUTLINE}>TR069 Stat</button>
          <button
            onClick={() => setLive(v => !v)}
            className={cn(
              'flex items-center gap-1.5 px-3 py-1.5 text-xs font-bold rounded transition-colors',
              live
                ? 'bg-emerald-500 text-white hover:bg-emerald-600'
                : 'bg-muted text-muted-foreground hover:bg-accent border border-border',
            )}
          >
            <Zap className="w-3.5 h-3.5" />
            LIVE{live ? '!' : ''}
          </button>
        </div>

        {/* Acordeón */}
        <div className="divide-y divide-border/60">
          {SECTIONS.map(({ key, label, icon: Icon }) => {
            const open = expanded === key;
            return (
              <div key={key}>
                <button
                  onClick={() => toggle(key)}
                  className="w-full flex items-center gap-3 px-4 py-3 text-left
                             hover:bg-muted/30 transition-colors"
                >
                  <Icon className="w-4 h-4 text-muted-foreground flex-shrink-0" />
                  <span className="flex-1 text-sm text-foreground">{label}</span>
                  {open
                    ? <ChevronDown  className="w-4 h-4 text-muted-foreground" />
                    : <ChevronRight className="w-4 h-4 text-muted-foreground" />
                  }
                </button>
                {open && (
                  <div className="px-6 py-4 bg-muted/10 border-t border-border/40">
                    <p className="text-xs text-muted-foreground italic">
                      Sin datos — requiere integración TR-069 / ACS con la ONU.
                    </p>
                  </div>
                )}
              </div>
            );
          })}
        </div>

        {/* File Download */}
        <div className="flex items-center gap-3 px-4 py-3 border-t border-border bg-muted/10 flex-wrap">
          <span className="text-xs font-semibold text-muted-foreground whitespace-nowrap">
            File Download (ACS → ONU)
          </span>
          <select
            value={fwFile}
            onChange={e => setFwFile(e.target.value)}
            className="flex-1 min-w-[180px] max-w-xs px-3 py-1.5 text-xs border border-input rounded-lg
                       bg-background text-foreground focus:outline-none focus:ring-1 focus:ring-primary"
          >
            <option value="">— none —</option>
            <option value="fw_1">Firmware v1.0.28</option>
            <option value="fw_2">Firmware v1.1.04</option>
            <option value="cfg_1">Config backup 2026-05</option>
          </select>
          <button
            disabled={!fwFile}
            className="flex items-center gap-1.5 px-3 py-1.5 text-xs font-semibold rounded
                       bg-emerald-600 hover:bg-emerald-700 text-white transition-colors
                       disabled:opacity-40 disabled:cursor-not-allowed"
          >
            <Download className="w-3.5 h-3.5" /> Start download
          </button>
        </div>

        {/* Botones inferiores */}
        <div className="flex items-center justify-end gap-2 px-4 py-3 border-t border-border bg-muted/10 flex-wrap">
          <button className="flex items-center gap-1.5 px-3 py-1.5 text-xs font-semibold rounded
                             bg-primary hover:bg-primary/90 text-primary-foreground transition-colors">
            <RefreshCcw className="w-3.5 h-3.5" /> Refresh interfaces
          </button>
          <button className="flex items-center gap-1.5 px-3 py-1.5 text-xs font-semibold rounded
                             bg-orange-500 hover:bg-orange-600 text-white transition-colors">
            <Power className="w-3.5 h-3.5" /> Reboot
          </button>
          <button className="flex items-center gap-1.5 px-3 py-1.5 text-xs font-semibold rounded
                             bg-destructive hover:bg-destructive/90 text-white transition-colors">
            <RotateCcw className="w-3.5 h-3.5" /> Reset to factory
          </button>
        </div>
      </div>
    </div>
  );
}
