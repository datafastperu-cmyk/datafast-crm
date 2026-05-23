import axios, { AxiosError, InternalAxiosRequestConfig } from 'axios';
import Cookies from 'js-cookie';

// Empty string = relative path — works on any server/domain via nginx proxy.
// Local dev only: set NEXT_PUBLIC_API_URL=http://localhost:4000 in .env.local
const BASE_URL = process.env.NEXT_PUBLIC_API_URL ?? '';

// ─── Instancia principal ──────────────────────────────────────
export const api = axios.create({
  baseURL:        `${BASE_URL}/api/v1`,
  timeout:        30_000,
  headers: {
    'Content-Type': 'application/json',
    'Accept':       'application/json',
  },
  withCredentials: false,
});

// ─── Cola de peticiones durante el refresh ────────────────────
let isRefreshing = false;
let failedQueue: Array<{
  resolve: (token: string) => void;
  reject:  (err: any) => void;
}> = [];

function processQueue(error: any, token: string | null) {
  failedQueue.forEach(({ resolve, reject }) => {
    error ? reject(error) : resolve(token!);
  });
  failedQueue = [];
}

// ─── Interceptor REQUEST: adjuntar access token ───────────────
api.interceptors.request.use(
  (config: InternalAxiosRequestConfig) => {
    const token = Cookies.get('access_token');
    if (token && config.headers) {
      config.headers.Authorization = `Bearer ${token}`;
    }
    return config;
  },
  (error) => Promise.reject(error),
);

// ─── Interceptor RESPONSE: manejar 401 y refresh ─────────────
api.interceptors.response.use(
  (response) => response,
  async (error: AxiosError) => {
    const originalRequest = error.config as InternalAxiosRequestConfig & { _retry?: boolean };

    // ── 402: licencia inválida o límite de clientes ───────────
    if (error.response?.status === 402) {
      const data = error.response.data as any;
      const razon = data?.error || data?.razon || 'NO_LICENSE_KEY';
      if (typeof window !== 'undefined') {
        window.dispatchEvent(new CustomEvent('licencia:bloqueada', { detail: { razon } }));
      }
      return Promise.reject(error);
    }

    if (error.response?.status === 401 && !originalRequest._retry && !originalRequest.url?.includes('/auth/login')) {
      // Si ya se está haciendo refresh, encolar esta petición
      if (isRefreshing) {
        return new Promise((resolve, reject) => {
          failedQueue.push({ resolve, reject });
        }).then((token) => {
          originalRequest.headers.Authorization = `Bearer ${token}`;
          return api(originalRequest);
        });
      }

      originalRequest._retry = true;
      isRefreshing = true;

      const refreshToken = Cookies.get('refresh_token');

      if (!refreshToken) {
        // No hay refresh token → redirigir al login
        clearAuthCookies();
        redirectToLogin();
        return Promise.reject(error);
      }

      try {
        const res = await axios.post(`${BASE_URL}/api/v1/auth/refresh`, {
          refreshToken,
        });

        const { accessToken, refreshToken: newRefresh } = res.data.data;
        setAuthCookies(accessToken, newRefresh);

        processQueue(null, accessToken);
        originalRequest.headers.Authorization = `Bearer ${accessToken}`;
        return api(originalRequest);

      } catch (refreshError) {
        processQueue(refreshError, null);
        clearAuthCookies();
        redirectToLogin();
        return Promise.reject(refreshError);
      } finally {
        isRefreshing = false;
      }
    }

    return Promise.reject(error);
  },
);

// ─── Helpers de cookies de autenticación ─────────────────────
export function setAuthCookies(accessToken: string, refreshToken: string): void {
  const isHttps = typeof window !== 'undefined' && window.location.protocol === 'https:';

  Cookies.set('access_token', accessToken, {
    expires:  1 / 96,  // 15 minutos
    secure:   isHttps,
    sameSite: 'strict',
    path:     '/',
  });

  Cookies.set('refresh_token', refreshToken, {
    expires:  7,
    secure:   isHttps,
    sameSite: 'strict',
    path:     '/',
  });
}

export function clearAuthCookies(): void {
  Cookies.remove('access_token');
  Cookies.remove('refresh_token');
}

export function getAccessToken(): string | undefined {
  return Cookies.get('access_token');
}

// Revoca VPN pendiente por tokenDescarga (sin JWT) antes de redirigir al login.
// Usa keepalive=true para sobrevivir al cierre de página.
function _revokeVpnIfPending(): void {
  if (typeof window === 'undefined') return;
  const token = sessionStorage.getItem('vpn_pending_token');
  if (!token) return;
  sessionStorage.removeItem('vpn_pending_token');
  fetch(`${BASE_URL}/api/v1/openvpn/mikrotik-clients/revoke-by-token`, {
    method:    'POST',
    headers:   { 'Content-Type': 'application/json' },
    body:      JSON.stringify({ tokenDescarga: token }),
    keepalive: true,
  }).catch(() => {});
}

export function redirectToLogin(): void {
  if (typeof window === 'undefined') return;
  _revokeVpnIfPending();
  (window as any).__authRedirecting = true;
  window.location.href = '/login';
}

// ─── Helper para parsear errores de la API ────────────────────
export function parseApiError(error: unknown): string {
  if (axios.isAxiosError(error)) {
    const data = error.response?.data;
    if (data?.message) return data.message;
    if (data?.error)   return data.error;
    if (error.message) return error.message;
  }
  if (error instanceof Error) return error.message;
  return 'Error desconocido';
}

export default api;
