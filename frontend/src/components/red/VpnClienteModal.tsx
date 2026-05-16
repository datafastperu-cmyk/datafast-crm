'use client';

import React, { useState, useCallback, useRef } from 'react';
import {
  X, Wifi, MapPin, FileText, Copy, Check, RefreshCw,
  AlertTriangle, CheckCircle2, Loader2, Terminal,
  Shield, Router, Info, ArrowRight, RotateCcw,
  Key, Eye, EyeOff, ChevronDown, ChevronUp, Download, Settings2,
} from 'lucide-react';
import { vpnApi, VpnCliente, ValidarTunelResult, VersionRos } from '@/lib/api/vpn';

// ── Tipos ─────────────────────────────────────────────────────
type Step = 'form' | 'script' | 'connecting';

interface FormData {
  nombre:           string;
  ubicacion:        string;
  descripcion:      string;
  versionRos:       VersionRos;
  usarCertificados: boolean;
  vpnUsuario:       string;
  vpnPassword:      string;
  cipher:           string;
  authAlg:          string;
  verifyServerCert: boolean;
}

interface FormErrors {
  nombre?:      string;
  ubicacion?:   string;
  vpnUsuario?:  string;
  vpnPassword?: string;
}

interface VpnClienteModalProps {
  onClose:   () => void;
  onSuccess: (cliente: VpnCliente) => void;
}

const CIPHERS = [
  { value: 'aes128',     label: 'AES-128-CBC',    v6: true  },
  { value: 'aes192',     label: 'AES-192-CBC',    v6: true  },
  { value: 'aes256',     label: 'AES-256-CBC',    v6: true  },
  { value: 'blowfish128',label: 'Blowfish-128',   v6: true  },
  { value: 'aes128-gcm', label: 'AES-128-GCM',    v6: false },
  { value: 'aes256-gcm', label: 'AES-256-GCM',    v6: false },
];

const AUTH_ALGS = [
  { value: 'md5',    label: 'MD5'    },
  { value: 'sha1',   label: 'SHA-1'  },
  { value: 'sha256', label: 'SHA-256' },
  { value: 'sha512', label: 'SHA-512' },
];

// ── Componente principal ──────────────────────────────────────
export function VpnClienteModal({ onClose, onSuccess }: VpnClienteModalProps) {
  const [step, setStep]         = useState<Step>('form');
  const [form, setForm]         = useState<FormData>({
    nombre: '', ubicacion: '', descripcion: '',
    versionRos: 'v7', usarCertificados: true,
    vpnUsuario: '', vpnPassword: '',
    cipher: 'aes256', authAlg: 'sha256', verifyServerCert: false,
  });
  const [errors, setErrors]           = useState<FormErrors>({});
  const [loading, setLoading]         = useState(false);
  const [cliente, setCliente]         = useState<VpnCliente | null>(null);
  const [script, setScript]           = useState('');
  const [copied, setCopied]           = useState(false);
  const [regenerating, setRegenerating] = useState(false);
  const [validating, setValidating]   = useState(false);
  const [validResult, setValidResult] = useState<ValidarTunelResult | null>(null);
  const [retryError, setRetryError]   = useState(false);
  const [showPass, setShowPass]       = useState(false);
  const [showAdvanced, setShowAdvanced] = useState(false);
  const pollRef   = useRef<NodeJS.Timeout | null>(null);
  const scriptRef = useRef<HTMLPreElement>(null);

  // ── Helpers ───────────────────────────────────────────────────
  const setField = <K extends keyof FormData>(key: K, value: FormData[K]) => {
    setForm(f => ({ ...f, [key]: value }));
    if (key in errors) setErrors(e => ({ ...e, [key]: undefined }));
  };

  const isGcmIncompatible = !form.usarCertificados
    ? false
    : form.versionRos === 'v6' && (form.cipher === 'aes128-gcm' || form.cipher === 'aes256-gcm');

  // ── Validación ────────────────────────────────────────────────
  const validate = (): boolean => {
    const e: FormErrors = {};
    if (!form.nombre.trim())    e.nombre    = 'El nombre es obligatorio';
    if (!form.ubicacion.trim()) e.ubicacion = 'La ubicación es obligatoria';
    if (!form.usarCertificados) {
      if (!form.vpnUsuario.trim())  e.vpnUsuario  = 'El usuario VPN es obligatorio';
      if (!form.vpnPassword.trim()) e.vpnPassword = 'La contraseña es obligatoria';
    }
    setErrors(e);
    return Object.keys(e).length === 0;
  };

  // ── Construir DTO ─────────────────────────────────────────────
  const buildDto = () => ({
    nombre:            form.nombre.trim(),
    ubicacion:         form.ubicacion.trim(),
    descripcion:       form.descripcion.trim() || undefined,
    versionRos:        form.versionRos,
    usarCertificados:  form.usarCertificados,
    vpnUsuario:        !form.usarCertificados ? form.vpnUsuario.trim() : undefined,
    vpnPassword:       !form.usarCertificados ? form.vpnPassword : undefined,
    cipher:            form.cipher,
    authAlg:           form.authAlg,
    verifyServerCert:  form.verifyServerCert,
  });

  // ── Paso 1 → Generar script ───────────────────────────────────
  const handleGenerar = async () => {
    if (!validate()) return;
    setLoading(true);
    setRetryError(false);
    try {
      const res = await vpnApi.crear(buildDto());
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
    let success = false;

    if (typeof navigator !== 'undefined' && navigator.clipboard?.writeText) {
      try { await navigator.clipboard.writeText(script); success = true; } catch { /* fallthrough */ }
    }

    if (!success && scriptRef.current) {
      try {
        const sel   = window.getSelection();
        const range = document.createRange();
        range.selectNodeContents(scriptRef.current);
        sel?.removeAllRanges();
        sel?.addRange(range);
        success = document.execCommand('copy');
        sel?.removeAllRanges();
      } catch { /* fallthrough */ }
    }

    if (!success) {
      try {
        const ta = document.createElement('textarea');
        ta.value = script;
        ta.setAttribute('readonly', '');
        ta.style.cssText = 'position:absolute;left:-99999px;top:-99999px;opacity:0';
        document.body.appendChild(ta);
        ta.focus();
        ta.select();
        ta.setSelectionRange(0, ta.value.length);
        success = document.execCommand('copy');
        document.body.removeChild(ta);
      } catch { /* fallthrough */ }
    }

    if (success) {
      setCopied(true);
      setTimeout(() => setCopied(false), 2500);
    }
  };

  // ── Descargar script ──────────────────────────────────────────
  const handleDownload = () => {
    const blob = new Blob([script], { type: 'text/plain' });
    const url  = URL.createObjectURL(blob);
    const a    = document.createElement('a');
    a.href     = url;
    a.download = `datafast-vpn-${form.nombre.toLowerCase().replace(/[^a-z0-9]+/g, '-')}.rsc`;
    a.click();
    URL.revokeObjectURL(url);
  };

  // ── Regenerar script ──────────────────────────────────────────
  const handleRegenerarScript = async () => {
    setRegenerating(true);
    try {
      const res = await vpnApi.crear(buildDto());
      setCliente(res.cliente);
      setScript(res.script);
      setCopied(false);
    } catch (err: any) {
      console.error('Error regenerando script:', err?.response?.data?.message || err.message);
    } finally {
      setRegenerating(false);
    }
  };

  // ── Paso 2 → Validar túnel ────────────────────────────────────
  const handleConectar = useCallback(() => {
    if (!cliente) return;
    setStep('connecting');
    setValidating(true);
    setValidResult(null);

    let attempts = 0;
    const MAX_ATTEMPTS = 3;

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
          if (pollRef.current) clearInterval(pollRef.current);
          setValidating(false);
          setCliente(null);
          setScript('');
          setRetryError(true);
          setStep('form');
        }
      } catch { /* silenciar errores de red durante polling */ }
    };

    poll();
    pollRef.current = setInterval(poll, 5000);
  }, [cliente, onSuccess]);

  // ── Cleanup ───────────────────────────────────────────────────
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
              {retryError && (
                <div className="flex items-start gap-3 p-3.5 bg-red-500/8 border border-red-500/25 rounded-xl">
                  <AlertTriangle className="w-4 h-4 text-red-400 mt-0.5 shrink-0" />
                  <div className="text-xs text-red-300/85 space-y-0.5">
                    <p className="font-medium text-red-300">Túnel no detectado tras 3 intentos</p>
                    <p>Verifica que el script se ejecutó correctamente en el MikroTik y vuelve a generarlo.</p>
                  </div>
                </div>
              )}

              {/* Nombre */}
              <div className="space-y-1.5">
                <label className="text-xs font-medium text-white/60 flex items-center gap-1.5">
                  <Router className="w-3.5 h-3.5" />
                  Nombre del Router <span className="text-red-400">*</span>
                </label>
                <input
                  type="text"
                  value={form.nombre}
                  onChange={e => setField('nombre', e.target.value)}
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
                  onChange={e => setField('ubicacion', e.target.value)}
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
                  onChange={e => setField('descripcion', e.target.value)}
                  placeholder="Router de distribución principal del sector norte"
                  rows={2}
                  className="w-full px-3 py-2.5 bg-white/5 border border-white/10 rounded-lg text-sm text-white placeholder-white/25 focus:outline-none focus:border-blue-500/60 focus:ring-1 focus:ring-blue-500/30 transition-colors resize-none"
                />
              </div>

              {/* Versión RouterOS */}
              <div className="space-y-2">
                <label className="text-xs font-medium text-white/60 flex items-center gap-1.5">
                  <Router className="w-3.5 h-3.5" />
                  Versión RouterOS <span className="text-red-400">*</span>
                </label>
                <div className="grid grid-cols-2 gap-2">
                  {(['v6', 'v7'] as VersionRos[]).map(v => (
                    <button
                      key={v}
                      type="button"
                      onClick={() => {
                        setField('versionRos', v);
                        // Auto-downgrade cipher si v6 + GCM seleccionado
                        if (v === 'v6' && form.cipher.endsWith('-gcm')) {
                          setField('cipher', form.cipher === 'aes128-gcm' ? 'aes128' : 'aes256');
                        }
                      }}
                      className={`py-2.5 px-4 rounded-lg text-sm font-medium border transition-all text-left ${
                        form.versionRos === v
                          ? 'bg-blue-500/15 border-blue-500/50 text-blue-300'
                          : 'bg-white/5 border-white/10 text-white/45 hover:bg-white/8 hover:text-white/70'
                      }`}
                    >
                      <span className="font-mono font-semibold">RouterOS {v.toUpperCase()}</span>
                      <span className="block text-[10px] mt-0.5 opacity-70">
                        {v === 'v6' ? 'v6.x — fetch address/src-path' : 'v7.x — fetch url= nativo'}
                      </span>
                    </button>
                  ))}
                </div>
              </div>

              {/* Switch: Usar Certificados */}
              <div className="p-4 bg-white/3 border border-white/8 rounded-xl space-y-3">
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-2.5">
                    <div className={`p-1.5 rounded-lg transition-colors ${form.usarCertificados ? 'bg-blue-500/15' : 'bg-amber-500/15'}`}>
                      {form.usarCertificados
                        ? <Shield className="w-4 h-4 text-blue-400" />
                        : <Key className="w-4 h-4 text-amber-400" />}
                    </div>
                    <div>
                      <p className="text-sm font-medium text-white">
                        {form.usarCertificados ? 'Autenticación con Certificados PKI' : 'Autenticación con Usuario/Contraseña'}
                      </p>
                      <p className="text-[10px] text-white/40 mt-0.5">
                        {form.usarCertificados
                          ? 'El servidor genera certificados TLS únicos para este router'
                          : 'El router se autentica con credenciales de usuario'}
                      </p>
                    </div>
                  </div>
                  {/* Toggle switch */}
                  <button
                    type="button"
                    onClick={() => setField('usarCertificados', !form.usarCertificados)}
                    className={`relative w-11 h-6 rounded-full transition-colors duration-200 focus:outline-none ${
                      form.usarCertificados ? 'bg-blue-500' : 'bg-white/15'
                    }`}
                    aria-checked={form.usarCertificados}
                    role="switch"
                  >
                    <span className={`absolute top-0.5 w-5 h-5 bg-white rounded-full shadow transition-transform duration-200 ${
                      form.usarCertificados ? 'translate-x-5' : 'translate-x-0.5'
                    }`} />
                  </button>
                </div>

                {/* Campos usuario/contraseña cuando switch es OFF */}
                {!form.usarCertificados && (
                  <div className="pt-2 space-y-3 border-t border-white/8">
                    <div className="space-y-1.5">
                      <label className="text-xs font-medium text-white/50">
                        Usuario VPN <span className="text-red-400">*</span>
                      </label>
                      <input
                        type="text"
                        value={form.vpnUsuario}
                        onChange={e => setField('vpnUsuario', e.target.value)}
                        placeholder="Ej: router-norte"
                        maxLength={100}
                        autoComplete="off"
                        className={`w-full px-3 py-2 bg-white/5 border rounded-lg text-sm text-white placeholder-white/25 focus:outline-none focus:ring-1 transition-colors ${
                          errors.vpnUsuario ? 'border-red-500/60 focus:ring-red-500/40' : 'border-white/10 focus:border-amber-500/50 focus:ring-amber-500/25'
                        }`}
                      />
                      {errors.vpnUsuario && <p className="text-xs text-red-400">{errors.vpnUsuario}</p>}
                    </div>
                    <div className="space-y-1.5">
                      <label className="text-xs font-medium text-white/50">
                        Contraseña VPN <span className="text-red-400">*</span>
                      </label>
                      <div className="relative">
                        <input
                          type={showPass ? 'text' : 'password'}
                          value={form.vpnPassword}
                          onChange={e => setField('vpnPassword', e.target.value)}
                          placeholder="Contraseña segura"
                          maxLength={200}
                          autoComplete="new-password"
                          className={`w-full px-3 py-2 pr-9 bg-white/5 border rounded-lg text-sm text-white placeholder-white/25 focus:outline-none focus:ring-1 transition-colors ${
                            errors.vpnPassword ? 'border-red-500/60 focus:ring-red-500/40' : 'border-white/10 focus:border-amber-500/50 focus:ring-amber-500/25'
                          }`}
                        />
                        <button
                          type="button"
                          onClick={() => setShowPass(s => !s)}
                          className="absolute right-2.5 top-1/2 -translate-y-1/2 text-white/30 hover:text-white/60 transition-colors"
                        >
                          {showPass ? <EyeOff className="w-3.5 h-3.5" /> : <Eye className="w-3.5 h-3.5" />}
                        </button>
                      </div>
                      {errors.vpnPassword && <p className="text-xs text-red-400">{errors.vpnPassword}</p>}
                    </div>
                    <div className="flex items-start gap-2 text-[10px] text-amber-300/70 bg-amber-500/8 border border-amber-500/20 rounded-lg px-3 py-2">
                      <AlertTriangle className="w-3 h-3 mt-0.5 shrink-0" />
                      <span>Requiere que el servidor OpenVPN tenga <code className="font-mono">verify-client-cert none</code> habilitado</span>
                    </div>
                  </div>
                )}
              </div>

              {/* Sección avanzada */}
              <div className="border border-white/8 rounded-xl overflow-hidden">
                <button
                  type="button"
                  onClick={() => setShowAdvanced(s => !s)}
                  className="w-full flex items-center justify-between px-4 py-3 text-xs font-medium text-white/50 hover:text-white/70 hover:bg-white/3 transition-colors"
                >
                  <span className="flex items-center gap-2">
                    <Settings2 className="w-3.5 h-3.5" />
                    Parámetros avanzados
                    {isGcmIncompatible && (
                      <span className="px-1.5 py-0.5 rounded text-[10px] bg-amber-500/15 text-amber-400 border border-amber-500/20">
                        ⚠ Incompatible
                      </span>
                    )}
                  </span>
                  {showAdvanced ? <ChevronUp className="w-3.5 h-3.5" /> : <ChevronDown className="w-3.5 h-3.5" />}
                </button>

                {showAdvanced && (
                  <div className="px-4 pb-4 space-y-4 border-t border-white/6">
                    {/* Advertencia GCM en v6 */}
                    {isGcmIncompatible && (
                      <div className="flex items-start gap-2.5 p-3 bg-amber-500/8 border border-amber-500/20 rounded-lg mt-3">
                        <AlertTriangle className="w-3.5 h-3.5 text-amber-400 mt-0.5 shrink-0" />
                        <p className="text-[11px] text-amber-300/85">
                          RouterOS v6 no soporta ciphers GCM. Se usará la versión CBC equivalente al generar el script.
                        </p>
                      </div>
                    )}

                    {/* Cipher + Auth en grid */}
                    <div className="grid grid-cols-2 gap-3 mt-3">
                      <div className="space-y-1.5">
                        <label className="text-[11px] font-medium text-white/50">Cipher</label>
                        <select
                          value={form.cipher}
                          onChange={e => setField('cipher', e.target.value)}
                          className="w-full px-3 py-2 bg-white/5 border border-white/10 rounded-lg text-xs text-white focus:outline-none focus:border-blue-500/50 transition-colors"
                        >
                          {CIPHERS.map(c => (
                            <option key={c.value} value={c.value} className="bg-[#1a1d27]">
                              {c.label}{!c.v6 ? ' (v7+)' : ''}
                            </option>
                          ))}
                        </select>
                      </div>
                      <div className="space-y-1.5">
                        <label className="text-[11px] font-medium text-white/50">Autenticación</label>
                        <select
                          value={form.authAlg}
                          onChange={e => setField('authAlg', e.target.value)}
                          className="w-full px-3 py-2 bg-white/5 border border-white/10 rounded-lg text-xs text-white focus:outline-none focus:border-blue-500/50 transition-colors"
                        >
                          {AUTH_ALGS.map(a => (
                            <option key={a.value} value={a.value} className="bg-[#1a1d27]">
                              {a.label}
                            </option>
                          ))}
                        </select>
                      </div>
                    </div>

                    {/* Verify Server Cert (v7 only) */}
                    {form.versionRos === 'v7' && (
                      <div className="flex items-center justify-between py-1">
                        <div>
                          <p className="text-xs font-medium text-white/60">Verificar certificado del servidor</p>
                          <p className="text-[10px] text-white/35 mt-0.5">
                            Activa <code className="font-mono">verify-server-certificate=yes</code> en el script
                          </p>
                        </div>
                        <button
                          type="button"
                          onClick={() => setField('verifyServerCert', !form.verifyServerCert)}
                          className={`relative w-10 h-5 rounded-full transition-colors duration-200 ${
                            form.verifyServerCert ? 'bg-blue-500' : 'bg-white/15'
                          }`}
                          role="switch"
                          aria-checked={form.verifyServerCert}
                        >
                          <span className={`absolute top-0.5 w-4 h-4 bg-white rounded-full shadow transition-transform duration-200 ${
                            form.verifyServerCert ? 'translate-x-5' : 'translate-x-0.5'
                          }`} />
                        </button>
                      </div>
                    )}
                  </div>
                )}
              </div>

              {/* Info box */}
              <div className="flex gap-3 p-3.5 bg-blue-500/8 border border-blue-500/20 rounded-xl">
                <Info className="w-4 h-4 text-blue-400 mt-0.5 shrink-0" />
                <div className="text-xs text-blue-300/80 space-y-1">
                  <p className="font-medium text-blue-300">¿Qué ocurrirá?</p>
                  <p>
                    {form.usarCertificados
                      ? 'Se generará un certificado PKI único para este router y un script RouterOS listo para ejecutar en el terminal del MikroTik.'
                      : 'Se generará un script RouterOS que configurará el túnel usando las credenciales de usuario definidas.'}
                  </p>
                </div>
              </div>
            </div>
          )}

          {/* PASO 2: Script */}
          {step === 'script' && (
            <div className="p-6 space-y-4">
              <div className="flex gap-3 p-3.5 bg-amber-500/8 border border-amber-500/20 rounded-xl">
                <Terminal className="w-4 h-4 text-amber-400 mt-0.5 shrink-0" />
                <div className="text-xs text-amber-300/90 space-y-1">
                  <p className="font-medium text-amber-300">Instrucciones de configuración</p>
                  <p>Copia el script y pégalo directamente en la <strong>Terminal del router MikroTik</strong> para crear el túnel VPN.</p>
                </div>
              </div>

              <div className="grid grid-cols-1 gap-2">
                {[
                  `RouterOS ${form.versionRos.toUpperCase()} | ${form.usarCertificados ? 'Certificados PKI' : 'Usuario/Contraseña'} | ${form.cipher}/${form.authAlg}`,
                  'El router debe tener salida a internet activa',
                  'El puerto 1195 TCP debe estar permitido hacia el servidor',
                  'No modificar el script manualmente — usar tal cual',
                ].map((w, i) => (
                  <div key={i} className="flex items-start gap-2 text-xs text-white/50">
                    <span className={`w-1.5 h-1.5 rounded-full mt-1.5 shrink-0 ${i === 0 ? 'bg-blue-400' : 'bg-white/30'}`} />
                    {w}
                  </div>
                ))}
              </div>

              {/* Script box */}
              <div className="relative">
                <div className="flex items-center justify-between px-3 py-2 bg-[#1a1d27] border border-white/10 rounded-t-lg border-b-0">
                  <span className="text-xs text-white/40 font-mono">RouterOS Script (.rsc)</span>
                  <div className="flex items-center gap-2">
                    <button
                      onClick={handleRegenerarScript}
                      disabled={regenerating}
                      title="Genera un nuevo certificado PKI con los mismos datos"
                      className="flex items-center gap-1.5 px-2.5 py-1 rounded-md text-xs font-medium transition-all bg-white/6 text-white/50 border border-white/10 hover:bg-white/10 hover:text-white disabled:opacity-40 disabled:cursor-not-allowed"
                    >
                      {regenerating ? <Loader2 className="w-3 h-3 animate-spin" /> : <RotateCcw className="w-3 h-3" />}
                      {regenerating ? 'Generando...' : 'Nuevo código'}
                    </button>
                    <button
                      onClick={handleDownload}
                      title="Descargar como archivo .rsc"
                      className="flex items-center gap-1.5 px-2.5 py-1 rounded-md text-xs font-medium transition-all bg-white/6 text-white/50 border border-white/10 hover:bg-white/10 hover:text-white"
                    >
                      <Download className="w-3 h-3" />
                      Descargar
                    </button>
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
                </div>
                <pre
                  ref={scriptRef}
                  className="w-full h-52 overflow-auto px-4 py-3 bg-[#0d0f16] border border-white/10 rounded-b-lg text-xs text-green-300/90 font-mono leading-relaxed whitespace-pre select-all"
                >
                  {script}
                </pre>
              </div>

              {/* Datos del cliente */}
              {cliente && (
                <div className="grid grid-cols-3 gap-2">
                  <div className="px-3 py-2.5 bg-white/4 rounded-lg border border-white/8 col-span-2">
                    <p className="text-[10px] text-white/40 uppercase tracking-wide mb-1">
                      {cliente.usarCertificados ? 'Certificado' : 'Identificador'}
                    </p>
                    <p className="text-xs text-white/80 font-mono break-all">{cliente.nombreCert}</p>
                  </div>
                  <div className="px-3 py-2.5 bg-white/4 rounded-lg border border-white/8">
                    <p className="text-[10px] text-white/40 uppercase tracking-wide mb-1">Modo</p>
                    <p className="text-xs font-semibold text-blue-300">
                      {form.versionRos.toUpperCase()} / {form.usarCertificados ? 'PKI' : 'U/P'}
                    </p>
                  </div>
                  <div className="px-3 py-2.5 bg-white/4 rounded-lg border border-white/8 col-span-3">
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
