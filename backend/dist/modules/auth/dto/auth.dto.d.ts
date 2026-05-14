export declare class LoginDto {
    email: string;
    password: string;
    deviceInfo?: string;
}
export declare class RefreshTokenDto {
    refreshToken: string;
}
export declare class ChangePasswordDto {
    passwordActual: string;
    passwordNuevo: string;
    confirmarPassword: string;
}
export declare class ForgotPasswordDto {
    email: string;
}
export declare class ResetPasswordDto {
    token: string;
    passwordNuevo: string;
}
export declare class AuthResponseDto {
    accessToken: string;
    refreshToken: string;
    expiresIn: number;
    tokenType: string;
    usuario: {
        id: string;
        nombreCompleto: string;
        email: string;
        fotoUrl: string | null;
        empresaId: string;
        roles: string[];
        permisos: string[];
        tema: string;
    };
}
