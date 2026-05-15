import { create }         from 'zustand';
import { persist }        from 'zustand/middleware';
import { jwtDecode }      from 'jwt-decode';
import { setAuthCookies, clearAuthCookies } from '@/lib/api';
import type { Usuario, AuthTokens } from '@/types';

interface AuthState {
  usuario:      Usuario | null;
  accessToken:  string | null;
  isAuth:       boolean;
  isLoading:    boolean;

  // Actions
  login:        (tokens: AuthTokens) => void;
  logout:       () => void;
  setLoading:   (v: boolean) => void;
  tienePermiso: (permiso: string) => boolean;
  tieneRol:     (rol: string) => boolean;
}

export const useAuthStore = create<AuthState>()(
  persist(
    (set, get) => ({
      usuario:     null,
      accessToken: null,
      isAuth:      false,
      isLoading:   false,

      login: (tokens: AuthTokens) => {
        setAuthCookies(tokens.accessToken, tokens.refreshToken);
        set({
          usuario:     tokens.usuario,
          accessToken: tokens.accessToken,
          isAuth:      true,
        });
      },

      logout: () => {
        clearAuthCookies();
        set({ usuario: null, accessToken: null, isAuth: false });
      },

      setLoading: (v) => set({ isLoading: v }),

      tienePermiso: (permiso: string) => {
        const { usuario } = get();
        if (!usuario) return false;
        // Administrador tiene todos los permisos
        if (usuario.roles.includes('Administrador')) return true;
        return usuario.permisos.includes(permiso);
      },

      tieneRol: (rol: string) => {
        const { usuario } = get();
        if (!usuario) return false;
        return usuario.roles.includes(rol);
      },
    }),
    {
      name:    'datafast-auth',
      // Solo persistir datos del usuario, no el token (viene de cookies)
      partialize: (state) => ({
        usuario:  state.usuario,
        isAuth:   state.isAuth,
      }),
    },
  ),
);
