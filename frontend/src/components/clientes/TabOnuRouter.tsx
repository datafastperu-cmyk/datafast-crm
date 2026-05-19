'use client';

import { useState } from 'react';
import {
  Radio, Wifi, WifiOff, Monitor, Phone, Download, ScrollText,
  Search, Shield, Server, Globe, ChevronRight, ChevronDown,
  Activity, Power, RotateCcw, RefreshCcw, Zap, X, Loader2,
  Settings, BarChart2, Home, Network, Plus, Link2,
} from 'lucide-react';
import { cn } from '@/lib/utils';

// ── Secciones del acordeón ────────────────────────────────────
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

// ── Estilos reutilizables ─────────────────────────────────────
const BTN_PRIMARY = 'px-3 py-1.5 text-xs font-semibold rounded bg-primary text-primary-foreground hover:bg-primary/90 transition-colors';
const BTN_OUTLINE = 'px-3 py-1.5 text-xs font-semibold rounded border border-border text-foreground hover:bg-accent transition-colors';
const INPUT_CLS   = 'w-full px-3 py-2 text-sm border border-input rounded-lg bg-background text-foreground focus:outline-none focus:ring-1 focus:ring-primary transition-colors';

// ── Modal Conectar ONU ────────────────────────────────────────
function ModalConectarOnu({ onClose, onConectar }: {
  onClose:    () => void;
  onConectar: (serial: string) => void;
}) {
  const [serial, setSerial] = useState('');
  const [mac,    setMac]    = useState('');
  const [modelo, setModelo] = useState('');
  const [loading, setLoading] = useState(false);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!serial.trim()) return;
    setLoading(true);
    await new Promise(r => setTimeout(r, 800)); // simula llamada API
    onConectar(serial.trim());
    setLoading(false);
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/50 backdrop-blur-sm">
      <div className="w-full max-w-md bg-card border border-border rounded-xl shadow-2xl">
        <div className="flex items-center justify-between px-5 py-4 border-b border-border">
          <div className="flex items-center gap-2">
            <Link2 className="w-4 h-4 text-primary" />
            <h2 className="text-sm font-semibold">Conectar ONU</h2>
          </div>
          <button onClick={onClose} className="text-muted-foreground hover:text-foreground transition-colors">
            <X className="w-4 h-4" />
          </button>
        </div>

        <form onSubmit={handleSubmit} className="p-5 space-y-4">
          <div>
            <label className="block text-xs font-semibold text-muted-foreground mb-1.5 uppercase tracking-wide">
              N° Serial / GPON SN <span className="text-destructive">*</span>
            </label>
            <input
              className={INPUT_CLS}
              placeholder="ZTEG12345678"
              value={serial}
              onChange={e => setSerial(e.target.value)}
              required
            />
          </div>
          <div>
            <label className="block text-xs font-semibold text-muted-foreground mb-1.5 uppercase tracking-wide">
              Dirección MAC
            </label>
            <input
              className={INPUT_CLS}
              placeholder="AA:BB:CC:DD:EE:FF"
              value={mac}
              onChange={e => setMac(e.target.value)}
            />
          </div>
          <div>
            <label className="block text-xs font-semibold text-muted-foreground mb-1.5 uppercase tracking-wide">
              Modelo ONU
            </label>
            <select className={INPUT_CLS} value={modelo} onChange={e => setModelo(e.target.value)}>
              <option value="">— Seleccionar modelo —</option>
              <option value="zte_f670l">ZTE F670L</option>
              <option value="zte_f6005">ZTE F6005</option>
              <option value="huawei_hg8145v5">Huawei HG8145V5</option>
              <option value="huawei_eg8145v5">Huawei EG8145V5</option>
              <option value="vsol_v2802rh">VSOL V2802RH</option>
              <option value="otro">Otro</option>
            </select>
          </div>

          <div className="flex justify-end gap-2 pt-2">
            <button type="button" onClick={onClose} className={BTN_OUTLINE}>
              Cancelar
            </button>
            <button type="submit" disabled={loading || !serial.trim()} className={cn(BTN_PRIMARY, 'flex items-center gap-1.5 disabled:opacity-50')}>
              {loading
                ? <><Loader2 className="w-3.5 h-3.5 animate-spin" /> Conectando…</>
                : <><Link2 className="w-3.5 h-3.5" /> Conectar ONU</>
              }
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}

// ── Componente principal ──────────────────────────────────────
export function TabOnuRouter({ clienteId }: { clienteId: string }) {
  const [showModal,  setShowModal]  = useState(false);
  const [conectada,  setConectada]  = useState(false);
  const [serialOnu,  setSerialOnu]  = useState('');
  const [live,       setLive]       = useState(false);
  const [expanded,   setExpanded]   = useState<string | null>(null);
  const [fwFile,     setFwFile]     = useState('');

  function handleConectar(serial: string) {
    setSerialOnu(serial);
    setConectada(true);
    setShowModal(false);
  }

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
          {conectada && (
            <span className="flex items-center gap-1 text-[11px] font-semibold px-2 py-0.5 rounded-full
                             bg-emerald-100 text-emerald-700 dark:bg-emerald-900/30 dark:text-emerald-400">
              <span className="w-1.5 h-1.5 rounded-full bg-emerald-500 animate-pulse" />
              {serialOnu}
            </span>
          )}
        </div>
        <button
          onClick={() => setShowModal(true)}
          className="flex items-center gap-1.5 px-4 py-2 text-xs font-semibold rounded-lg
                     bg-primary text-primary-foreground hover:bg-primary/90 transition-colors shadow-sm"
        >
          <Plus className="w-3.5 h-3.5" />
          Conectar ONU
        </button>
      </div>

      {/* ── Sin ONU ────────────────────────────────────────────── */}
      {!conectada && (
        <div className="flex flex-col items-center justify-center py-20 text-center">
          <div className="w-16 h-16 rounded-2xl bg-muted flex items-center justify-center mb-4">
            <Radio className="w-7 h-7 text-muted-foreground" />
          </div>
          <p className="text-sm font-semibold text-foreground">Sin ONU conectada</p>
          <p className="text-xs text-muted-foreground mt-1 max-w-xs">
            Asocia la ONU del abonado para gestionar su configuración y estado en tiempo real.
          </p>
          <button
            onClick={() => setShowModal(true)}
            className="mt-5 flex items-center gap-2 px-5 py-2.5 text-sm rounded-lg font-medium
                       bg-primary text-primary-foreground hover:bg-primary/90 transition-all shadow-sm"
          >
            <Link2 className="w-4 h-4" /> Conectar ONU
          </button>
        </div>
      )}

      {/* ── ONU conectada ──────────────────────────────────────── */}
      {conectada && (
        <div className="border border-border rounded-xl overflow-hidden">

          {/* Botones de acción superiores */}
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

          {/* Acordeón de secciones */}
          <div className="divide-y divide-border/60">
            {SECTIONS.map(({ key, label, icon: Icon }) => {
              const open = expanded === key;
              return (
                <div key={key}>
                  <button
                    onClick={() => toggle(key)}
                    className="w-full flex items-center gap-3 px-4 py-3 text-left
                               hover:bg-muted/30 transition-colors group"
                  >
                    <Icon className="w-4 h-4 text-primary flex-shrink-0" />
                    <span className="flex-1 text-sm text-foreground font-medium">{label}</span>
                    {open
                      ? <ChevronDown className="w-4 h-4 text-muted-foreground transition-transform" />
                      : <ChevronRight className="w-4 h-4 text-muted-foreground transition-transform" />
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
                               border border-border text-foreground hover:bg-accent transition-colors">
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
      )}

      {/* Modal */}
      {showModal && (
        <ModalConectarOnu
          onClose={() => setShowModal(false)}
          onConectar={handleConectar}
        />
      )}
    </div>
  );
}
