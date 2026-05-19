'use client';

import { useState } from 'react';
import { Settings2, Save } from 'lucide-react';

interface ToggleProps {
  label: string;
  description: string;
  checked: boolean;
  onChange: (v: boolean) => void;
}

function Toggle({ label, description, checked, onChange }: ToggleProps) {
  return (
    <div className="flex items-start gap-3 p-4 border border-border rounded-lg bg-background">
      <button
        onClick={() => onChange(!checked)}
        className={`relative mt-0.5 w-9 h-5 rounded-full transition-colors flex-shrink-0 ${
          checked ? 'bg-primary' : 'bg-muted-foreground/30'
        }`}
      >
        <span className={`absolute top-0.5 left-0.5 w-4 h-4 rounded-full bg-white shadow transition-transform ${
          checked ? 'translate-x-4' : 'translate-x-0'
        }`} />
      </button>
      <div>
        <p className="text-sm font-semibold text-foreground">{label}</p>
        <p className="text-xs text-muted-foreground mt-0.5">{description}</p>
      </div>
    </div>
  );
}

interface InputAddonProps {
  prefix?: string;
  suffix?: string;
  value: string;
  onChange: (v: string) => void;
  type?: string;
  step?: string;
}

function InputAddon({ prefix, suffix, value, onChange, type = 'text', step }: InputAddonProps) {
  return (
    <div className="flex items-center border border-border rounded-lg overflow-hidden bg-background">
      {prefix && (
        <span className="px-3 py-2.5 text-sm text-muted-foreground bg-muted border-r border-border whitespace-nowrap">
          {prefix}
        </span>
      )}
      <input
        type={type}
        step={step}
        value={value}
        onChange={e => onChange(e.target.value)}
        className="flex-1 px-3 py-2.5 text-sm bg-background text-foreground focus:outline-none focus:ring-1 focus:ring-primary min-w-0"
      />
      {suffix && (
        <span className="px-3 py-2.5 text-sm text-muted-foreground bg-muted border-l border-border whitespace-nowrap">
          {suffix}
        </span>
      )}
    </div>
  );
}

export default function LealtadConfigPage() {
  const [sistemaLealtad,   setSistemaLealtad]   = useState(false);
  const [sistemaReferidos, setSistemaReferidos] = useState(false);
  const [moneda,           setMoneda]           = useState('WispPoints');
  const [ratioPagos,       setRatioPagos]       = useState('10');
  const [valorPunto,       setValorPunto]       = useState('0.05');
  const [bonPago,          setBonPago]           = useState('0');
  const [bonReferido,      setBonReferido]       = useState('0');
  const [bonAniversario,   setBonAniversario]    = useState('0');
  const [minimoCanje,      setMinimoCanje]       = useState('100');

  return (
    <div className="p-6 space-y-6 max-w-5xl">

      {/* Header */}
      <div className="flex items-center gap-3">
        <Settings2 className="w-6 h-6 text-primary" />
        <div>
          <h1 className="text-xl font-bold text-foreground">Configuración de Lealtad</h1>
          <p className="text-xs text-muted-foreground">Ajustes generales del sistema de puntos y recompensas</p>
        </div>
      </div>

      {/* General */}
      <section className="space-y-3">
        <h2 className="text-base font-bold text-primary">General</h2>
        <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
          <Toggle
            label="Habilitar Sistema de Lealtad"
            description='Si se desactiva, los clientes no verán sus puntos ni podrán canjear premios.'
            checked={sistemaLealtad}
            onChange={setSistemaLealtad}
          />
          <Toggle
            label="Habilitar Sistema de Referidos"
            description='Si se desactiva, se oculta la sección "Invita y Gana" del portal.'
            checked={sistemaReferidos}
            onChange={setSistemaReferidos}
          />
        </div>

        <div className="space-y-1">
          <label className="text-sm font-semibold text-foreground">Nombre de la Moneda (Puntos)</label>
          <input
            value={moneda}
            onChange={e => setMoneda(e.target.value)}
            className="w-full px-3 py-2.5 text-sm border border-border rounded-lg bg-background text-foreground focus:outline-none focus:ring-1 focus:ring-primary"
          />
        </div>
      </section>

      <hr className="border-border" />

      {/* Reglas de Acumulación */}
      <section className="space-y-4">
        <h2 className="text-base font-bold text-primary">Reglas de Acumulación</h2>
        <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
          <div className="space-y-1">
            <label className="text-sm font-semibold text-foreground">Ratio de Conversión (Pagos)</label>
            <InputAddon
              prefix="1 Punto por cada"
              suffix="Moneda Local (S/)"
              value={ratioPagos}
              onChange={setRatioPagos}
              type="number"
            />
            <p className="text-xs text-muted-foreground">
              Ej: Si es {ratioPagos || '10'}, el cliente recibe 1 punto por cada {ratioPagos || '10'} soles pagados.
            </p>
          </div>
          <div className="space-y-1">
            <label className="text-sm font-semibold text-foreground">Valor del Punto (Canje)</label>
            <InputAddon
              prefix="1 Punto equivale a"
              suffix="Moneda Local (S/)"
              value={valorPunto}
              onChange={setValorPunto}
              type="number"
              step="0.01"
            />
            <p className="text-xs text-muted-foreground">
              Ej: Si es {valorPunto || '0.05'}, 100 puntos valen {((parseFloat(valorPunto) || 0.05) * 100).toFixed(2)} soles.
            </p>
          </div>
        </div>
      </section>

      <hr className="border-border" />

      {/* Bonificaciones Automáticas */}
      <section className="space-y-4">
        <h2 className="text-base font-bold text-primary">Bonificaciones Automáticas</h2>
        <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
          <div className="space-y-1">
            <label className="text-sm font-semibold text-foreground">Pago Puntual</label>
            <InputAddon suffix="Puntos" value={bonPago} onChange={setBonPago} type="number" />
            <p className="text-xs text-muted-foreground">Puntos extra por pagar antes de la fecha de vencimiento.</p>
          </div>
          <div className="space-y-1">
            <label className="text-sm font-semibold text-foreground">Referido Exitoso</label>
            <InputAddon suffix="Puntos" value={bonReferido} onChange={setBonReferido} type="number" />
          </div>
          <div className="space-y-1">
            <label className="text-sm font-semibold text-foreground">Aniversario (1 año)</label>
            <InputAddon suffix="Puntos" value={bonAniversario} onChange={setBonAniversario} type="number" />
          </div>
        </div>
      </section>

      <hr className="border-border" />

      {/* Reglas de Canje */}
      <section className="space-y-4">
        <h2 className="text-base font-bold text-primary">Reglas de Canje</h2>
        <div className="max-w-sm space-y-1">
          <label className="text-sm font-semibold text-foreground">Mínimo para Canjear</label>
          <InputAddon suffix="Puntos" value={minimoCanje} onChange={setMinimoCanje} type="number" />
          <p className="text-xs text-muted-foreground">El cliente debe tener al menos esta cantidad de puntos para poder canjear.</p>
        </div>
      </section>

      {/* Footer */}
      <div className="flex justify-end pt-2">
        <button className="flex items-center gap-2 px-5 py-2.5 rounded-lg bg-primary hover:bg-primary/90 text-primary-foreground font-semibold text-sm transition-colors shadow-sm">
          <Save className="w-4 h-4" />
          Guardar Configuración
        </button>
      </div>
    </div>
  );
}
