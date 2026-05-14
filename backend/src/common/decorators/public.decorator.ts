import { SetMetadata } from '@nestjs/common';

export const IS_PUBLIC_KEY = 'isPublic';

// ─── Marcar un endpoint como público (sin JWT) ────────────────
// Uso: @Public() en el controller o método
// El JwtAuthGuard respeta este decorador y omite la verificación
export const Public = () => SetMetadata(IS_PUBLIC_KEY, true);
