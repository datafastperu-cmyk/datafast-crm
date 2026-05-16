'use client';

import React, { useState, useCallback, useRef } from 'react';
import {
  X, Wifi, MapPin, FileText, Copy, Check, RefreshCw,
  AlertTriangle, CheckCircle2, Loader2, Terminal,
  Shield, Router, Info, ArrowRight,
} from 'lucide-react';
import { vpnApi, VpnCliente, ValidarTunelResult } from '@/lib/api/vpn';

// ── Tipos ─────────────────────────────────────────────────────
type Step = 'form' | 'script' | 'connecting';

interface FormData {
  nombre:      string;
  ubicacion:   string;
  descripcion: string;
}

interface VpnClienteModalProps {
  onClose:   () => void;
  onSuccess: (cliente: VpnCliente) => void;
}

// ── Componente principal ──────────────────────────────────────
export function VpnClienteModal({ onClose, onSuccess }: VpnClienteModalProps) {
  const [step, setStep]           = useState<Step>('form');
  const [form, setForm]           = useState<FormData>({ nombre: '', ubicacion: '', descripcion: '' });
  const [errors, setErrors]       = useState<Partial<FormData>>({});
  const [loading, setLoading]     = useState(false);
  const [cliente, setCliente]     = useState<VpnCliente | null>(null);
  const [script, setScript]       = useState('');
  const [copied, setCopied]       = useState(false);
  const [validating, setValidating] = useState(false);
  const [validResult, setValidResult] = useState<ValidarTunelResult | null>(null);
  const pollRef = useRef<NodeJS.Timeout | null>(null);

  // ── Validación del formulario ─────────────────────────────────
  const validate = (): boolean => {
    const e: Partial<FormData> = {};
    if (!form.nombre.trim())    e.nombre    = 'El nombre es obligatorio';
    if (!form.ubicacion.trim()) e.ubicacion = 'La ubicación es obligatoria';
    setErrors(e);
    return Object.keys(e).length === 0;
  };

  // ── Paso 1 → Generar script ───────────────────────────────────
  const handleGenerar = async () => {
    if (!validate()) return;
    setLoading(true);
    try {
      const res = await vpnApi.crear({
        nombre:      form.nombre.trim(),
        ubicacion:   form.ubicacion.trim(),
        descripcion: form.descripcion.trim() || undefined,
      });
      setCliente(res.cliente);
      setScript(res.script);
      setStep('script');
    } catch (err: any) {
      setErrors({ nombre: err?.response?.data?.message || 'Error al generar el cliente VPN' });
    } finally {
      setLoading(false);
    }
  };

  // ── Copiar script ─────────────────────────────────────────────
  const handleCopy = async () => {
    await navigator.clipboard.writeText(script);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  // ── Paso 2 → Validar túnel (polling) ─────────────────────────
  const handleConectar = useCallback(() => {
    if (!cliente) return;
    setStep('connecting');
    setValidating(true);
    setValidResult(null);

    let attempts = 0;
    const MAX_ATTEMPTS = 24; // 2min (cada 5s)

    const poll = async () => {
      try {
        attempts++;
        const res = await vpnApi.validarTunel(cliente.id);
        if (res.conectado) {
          setValidResult(res);
          setValidating(false);
          if (pollRef.current) clearInterval(pollRef.current);
          onSuccess({ ...cliente, vpnIp: res.vpnIp, estado: 'conectado', routerId: res.routerId });
          return;
        }
        if (attempts >= MAX_ATTEMPTS) {
          setValidResult({ conectado: false, mensaje: 'Tiempo de espera agotado. Verifica que el script se ejecutó correctamente.' });
          setValidating(false);
          if (pollRef.current) clearInterval(pollRef.current);
        }
      } catch {
        // Silenciar errores de red durante polling
      }
    };

    poll();
    pollRef.current = setInterval(poll, 5000);
  }, [cliente, onSuccess]);

  // ── Cleanup polling ───────────────────────────────────────────
  const handleClose = () => {
    if (pollRef.current) clearInterval(pollRef.current);
    onClose();
  };

  // ── Render ────────────────────────────────────────────────────
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/70 backdrop-blur-sm">
      <div className="relative w-full max-w-2xl max-h-[90vh] flex flex-col bg-[#0f1117] border border-white/10 rounded-2xl shadow-2xl overflow-hidden">

        {/* Header */}
        <div className="flex items-center justify-between px-6 py-4 border-b border-white/8 bg-gradient-to-r from-blue-900/20 to-transparent">
          <div className="flex items-center gap-3">
            <div className="p-2 bg-blue-500/15 rounded-lg">
              <Wifi className="w-5 h-5 text-blue-400" />
            </div>
            <div>
              <h2 className="text-base font-semibold text-white">Agregar Cliente VPN MikroTik</h2>
              <p className="text-xs text-white/40 mt-0.5">
                {step === 'form'       && 'Configura los datos del router'}
                {step === 'script'     && 'Copia el script y ejecútalo en el MikroTik'}
                {step === 'connecting' && 'Esperando conexión del router...'}
              </p>
            </div>
          </div>
          <button onClick={handleClose} className="p-1.5 rounded-lg text-white/40 hover:text-white hover:bg-white/8 transition-colors">
            <X className="w-4 h-4" />
          </button>
        </div>

        {/* Indicador de pasos */}
        <div className="flex items-center gap-2 px-6 py-3 border-b border-white/6 bg-black/20">
          {(['form', 'script', 'connecting'] as Step[]).map((s, i) => (
            <React.Fragment key={s}>
              <div className={`flex items-center gap-1.5 text-xs font-medium transition-colors ${
                step === s ? 'text-blue-400' :
                (['form','script','connecting'].indexOf(step) > i) ? 'text-green-400' : 'text-white/30'
              }`}>
                <span className={`w-5 h-5 rounded-full flex items-center justify-center text-[10px] font-bold border transition-colors ${
                  step === s ? 'border-blue-400 bg-blue-400/15 text-blue-400' :
                  (['form','script','connecting'].indexOf(step) > i) ? 'border-green-400 bg-green-400/15 text-green-400' :
                  'border-white/20 text-white/30'
                }`}>{i + 1}</span>
                {s === 'form' ? 'Datos' : s === 'script' ? 'Script' : 'Validar'}
              </div>
              {i < 2 && <ArrowRight className="w-3 h-3 text-white/20" />}
            </React.Fragment>
          ))}
        </div>

        {/* Contenido scrollable */}
        <div className="flex-1 overflow-y-auto">

          {/* PASO 1: Formulario */}
          {step === 'form' && (
            <div className="p-6 space-y-5">
              {/* Nombre del router */}
              <div className="space-y-1.5">
                <label className="text-xs font-medium text-white/60 flex items-center gap-1.5">
                  <Router className="w-3.5 h-3.5" />
                  Nombre del Router <span className="text-red-400">*</span>
                </label>
                <input
                  type="text"
                  value={form.nombre}
                  onChange={e => { setForm(f => ({ ...f, nombre: e.target.value })); setErrors(e => ({ ...e, nombre: '' })); }}
                  placeholder="Ej: Router Castilla Norte"
                  maxLength={100}
                  className={`w-full px-3 py-2.5 bg-white/5 border rounded-lg text-sm text-white placeholder-white/25 focus:outline-none focus:ring-1 transition-colors ${
                    errors.nombre ? 'border-red-500/60 focus:ring-red-500/40' : 'border-white/10 focus:border-blue-500/60 focus:ring-blue-500/30'
                  }`}
                />
                {errors.nombre && <p className="text-xs text-red-400">{errors.nombre}</p>}
              </div>

              {/* Ubicación */}
              <div className="space-y-1.5">
                <label className="text-xs font-medium text-white/60 flex items-center gap-1.5">
                  <MapPin className="w-3.5 h-3.5" />
                  Ubicación / Nodo <span className="text-red-400">*</span>
                </label>
                <input
                  type="text"
                  value={form.ubicacion}
                  onChange={e => { setForm(f => ({ ...f, ubicacion: e.target.value })); setErrors(e => ({ ...e, ubicacion: '' })); }}
                  placeholder="Ej: Piura - Sector Norte, Av. Sánchez Cerro"
                  maxLength={200}
                  className={`w-full px-3 py-2.5 bg-white/5 border rounded-lg text-sm text-white placeholder-white/25 focus:outline-none focus:ring-1 transition-colors ${
                    errors.ubicacion ? 'border-red-500/60 focus:ring-red-500/40' : 'border-white/10 focus:border-blue-500/60 focus:ring-blue-500/30'
                  }`}
                />
                {errors.ubicacion && <p className="text-xs text-red-400">{errors.ubicacion}</p>}
              </div>

              {/* Descripción */}
              <div className="space-y-1.5">
                <label className="text-xs font-medium text-white/60 flex items-center gap-1.5">
                  <FileText className="w-3.5 h-3.5" />
                  Descripción <span className="text-white/25 font-normal">(opcional)</span>
                </label>
                <textarea
                  value={form.descripcion}
                  onChange={e => setForm(f => ({ ...f, descripcion: e.target.value }))}
                  placeholder="Router de distribución principal del sector norte"
                  rows={3}
                  className="w-full px-3 py-2.5 bg-white/5 border border-white/10 rounded-lg text-sm text-white placeholder-white/25 focus:outline-none focus:border-blue-500/60 focus:ring-1 focus:ring-blue-500/30 transition-colors resize-none"
                />
              </div>

              {/* Info box */}
              <div className="flex gap-3 p-3.5 bg-blue-500/8 border border-blue-500/20 rounded-xl">
                <Info className="w-4 h-4 text-blue-400 mt-0.5 shrink-0" />
                <div className="text-xs text-blue-300/80 space-y-1">
                  <p className="font-medium text-blue-300">¿Qué ocurrirá?</p>
                  <p>Se generará un certificado PKI único para este router y un script RouterOS listo para copiar y pegar en la terminal del MikroTik.</p>
                </div>
              </div>
            </div>
          )}

          {/* PASO 2: Script */}
          {step === 'script' && (
            <div className="p-6 space-y-4">
              {/* Info banner */}
              <div className="flex gap-3 p-3.5 bg-amber-500/8 border border-amber-500/20 rounded-xl">
                <Terminal className="w-4 h-4 text-amber-400 mt-0.5 shrink-0" />
                <div className="text-xs text-amber-300/90 space-y-1">
                  <p className="font-medium text-amber-300">Instrucciones de configuración</p>
                  <p>Copia el siguiente código y pégalo directamente en la <strong>Terminal del router MikroTik</strong> para crear automáticamente el túnel VPN con el servidor DATAFAST.</p>
                </div>
              </div>

              {/* Advertencias */}
              <div className="grid grid-cols-1 gap-2">
                {[
                  'Compatible con RouterOS v6.x y v7.x',
                  'El router debe tener salida a internet activa',
                  'El router debe tener fecha y hora correctas configuradas',
                  'El puerto 1195 TCP debe estar permitido hacia el servidor',
                  'No modificar el script manualmente — usar tal cual',
                ].map((w, i) => (
                  <div key={i} className="flex items-start gap-2 text-xs text-white/50">
                    <span className="w-1.5 h-1.5 rounded-full bg-white/30 mt-1.5 shrink-0" />
                    {w}
                  </div>
                ))}
              </div>

              {/* Script box */}
              <div className="relative">
                <div className="flex items-center justify-between px-3 py-2 bg-[#1a1d27] border border-white/10 rounded-t-lg border-b-0">
                  <span className="text-xs text-white/40 font-mono">RouterOS Script</span>
                  <button
                    onClick={handleCopy}
                    className={`flex items-center gap-1.5 px-2.5 py-1 rounded-md text-xs font-medium transition-all ${
                      copied
                        ? 'bg-green-500/20 text-green-400 border border-green-500/30'
                        : 'bg-white/6 text-white/60 border border-white/10 hover:bg-white/10 hover:text-white'
                    }`}
                  >
                    {copied ? <Check className="w-3 h-3" /> : <Copy className="w-3 h-3" />}
                    {copied ? 'Copiado' : 'Copiar'}
                  </button>
                </div>
                <pre className="w-full h-56 overflow-auto px-4 py-3 bg-[#0d0f16] border border-white/10 rounded-b-lg text-xs text-green-300/90 font-mono leading-relaxed whitespace-pre select-all">
                  {script}
                </pre>
              </div>

              {/* Datos del cliente */}
              {cliente && (
                <div className="grid grid-cols-2 gap-3">
                  <div className="px-3 py-2.5 bg-white/4 rounded-lg border border-white/8">
                    <p className="text-[10px] text-white/40 uppercase tracking-wide mb-1">Certificado</p>
                    <p className="text-xs text-white/80 font-mono break-all">{cliente.nombreCert}</p>
                  </div>
                  <div className="px-3 py-2.5 bg-white/4 rounded-lg border border-white/8">
                    <p className="text-[10px] text-white/40 uppercase tracking-wide mb-1">Token expira</p>
                    <p className="text-xs text-white/80">{new Date(cliente.tokenExpiresAt).toLocaleString('es-PE')}</p>
                  </div>
                </div>
              )}
            </div>
          )}

          {/* PASO 3: Validando */}
          {step === 'connecting' && (
            <div className="p-6 space-y-5">
              {validating && !validResult && (
                <div className="flex flex-col items-center gap-4 py-8">
                  <div className="relative">
                    <div className="w-16 h-16 rounded-full bg-blue-500/10 border border-blue-500/20 flex items-center justify-center">
                      <Wifi className="w-7 h-7 text-blue-400" />
                    </div>
                    <div className="absolute inset-0 rounded-full border border-blue-500/30 animate-ping" />
                  </div>
                  <div className="text-center space-y-1.5">
                    <p className="text-sm font-medium text-white">Esperando conexión del router...</p>
                    <p className="text-xs text-white/40">Verifica que el script se ejecutó correctamente en el MikroTik</p>
                  </div>
                  <div className="flex items-center gap-2 text-xs text-white/30">
                    <Loader2 className="w-3.5 h-3.5 animate-spin" />
                    Revisando estado del túnel VPN cada 5 segundos
                  </div>
                </div>
              )}

              {validResult?.conectado && (
                <div className="space-y-4">
                  <div className="flex flex-col items-center gap-3 py-6">
                    <div className="w-16 h-16 rounded-full bg-green-500/10 border border-green-500/20 flex items-center justify-center">
                      <CheckCircle2 className="w-8 h-8 text-green-400" />
                    </div>
                    <div className="text-center">
                      <p className="text-sm font-semibold text-white">¡Túnel VPN establecido!</p>
                      <p className="text-xs text-white/50 mt-1">{validResult.mensaje}</p>
                    </div>
                  </div>

                  <div className="grid grid-cols-2 gap-3">
                    <div className="px-3 py-3 bg-green-500/8 rounded-lg border border-green-500/20">
                      <p className="text-[10px] text-green-400/70 uppercase tracking-wide mb-1">IP VPN asignada</p>
                      <p className="text-sm font-mono font-semibold text-green-300">{validResult.vpnIp || '—'}</p>
                    </div>
                    <div className="px-3 py-3 bg-white/4 rounded-lg border border-white/8">
                      <p className="text-[10px] text-white/40 uppercase tracking-wide mb-1">IP Real del Router</p>
                      <p className="text-sm font-mono text-white/70">{validResult.ipReal || '—'}</p>
                    </div>
                  </div>

                  {validResult.routerRegistrado && (
                    <div className="flex items-center gap-2.5 px-3.5 py-3 bg-blue-500/8 border border-blue-500/20 rounded-lg">
                      <Shield className="w-4 h-4 text-blue-400 shrink-0" />
                      <p className="text-xs text-blue-300/80">
                        Router registrado automáticamente en <strong>Gestión de Red → Routers</strong>. Configura las credenciales API para gestión completa.
                      </p>
                    </div>
                  )}
                </div>
              )}

              {validResult && !validResult.conectado && (
                <div className="space-y-4">
                  <div className="flex flex-col items-center gap-3 py-4">
                    <div className="w-14 h-14 rounded-full bg-amber-500/10 border border-amber-500/20 flex items-center justify-center">
                      <AlertTriangle className="w-6 h-6 text-amber-400" />
                    </div>
                    <div className="text-center">
                      <p className="text-sm font-medium text-white/90">Túnel no detectado</p>
                      <p className="text-xs text-white/45 mt-1">{validResult.mensaje}</p>
                    </div>
                  </div>

                  <div className="p-4 bg-white/3 border border-white/8 rounded-xl space-y-2.5">
                    <p className="text-xs font-medium text-white/70">Pasos para diagnosticar:</p>
                    {[
                      'Verifica que copiaste y ejecutaste el script completo en el terminal del MikroTik',
                      'Confirma que el router tiene internet activo (/ping 8.8.8.8)',
                      'Revisa logs en el MikroTik: /log print where message~"DATAFAST"',
                      'Verifica que el puerto 1195 TCP no está bloqueado por el firewall del ISP',
                    ].map((s, i) => (
                      <div key={i} className="flex items-start gap-2 text-xs text-white/45">
                        <span className="text-white/30 font-mono mt-px">{i + 1}.</span>
                        {s}
                      </div>
                    ))}
                  </div>

                  <button
                    onClick={handleConectar}
                    className="w-full flex items-center justify-center gap-2 px-4 py-2.5 bg-blue-600/80 hover:bg-blue-600 border border-blue-500/40 text-white text-sm font-medium rounded-lg transition-colors"
                  >
                    <RefreshCw className="w-4 h-4" />
                    Reintentar validación
                  </button>
                </div>
              )}
            </div>
          )}
        </div>

        {/* Footer */}
        <div className="flex items-center justify-between px-6 py-4 border-t border-white/8 bg-black/20">
          <button
            onClick={handleClose}
            className="px-4 py-2 text-sm text-white/50 hover:text-white transition-colors"
          >
            {validResult?.conectado ? 'Cerrar' : 'Cancelar'}
          </button>

          <div className="flex items-center gap-2.5">
            {step === 'script' && (
              <button
                onClick={() => setStep('form')}
                className="px-4 py-2 text-sm text-white/50 hover:text-white border border-white/10 hover:border-white/20 rounded-lg transition-colors"
              >
                ← Anterior
              </button>
            )}

            {step === 'form' && (
              <button
                onClick={handleGenerar}
                disabled={loading}
                className="flex items-center gap-2 px-5 py-2 bg-blue-600 hover:bg-blue-500 disabled:opacity-50 disabled:cursor-not-allowed text-white text-sm font-medium rounded-lg transition-colors"
              >
                {loading ? <Loader2 className="w-4 h-4 animate-spin" /> : <ArrowRight className="w-4 h-4" />}
                {loading ? 'Generando...' : 'Generar Script'}
              </button>
            )}

            {step === 'script' && (
              <button
                onClick={handleConectar}
                className="flex items-center gap-2 px-5 py-2 bg-green-600 hover:bg-green-500 text-white text-sm font-semibold rounded-lg transition-colors"
              >
                <Wifi className="w-4 h-4" />
                CONECTAR
              </button>
            )}

            {step === 'connecting' && validating && (
              <div className="flex items-center gap-2 px-4 py-2 bg-white/6 border border-white/10 rounded-lg text-sm text-white/50">
                <Loader2 className="w-4 h-4 animate-spin" />
                Validando...
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
