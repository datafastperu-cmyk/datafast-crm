export interface JwtPayload {
    sub: string;
    email: string;
    empresaId: string;
    nombreCompleto: string;
    roles: string[];
    permisos: string[];
    tema: string;
    iat?: number;
    exp?: number;
}
export declare const CurrentUser: (...dataOrPipes: (keyof JwtPayload | import("@nestjs/common").PipeTransform<any, any> | import("@nestjs/common").Type<import("@nestjs/common").PipeTransform<any, any>>)[]) => ParameterDecorator;
export declare const CurrentUserId: (...dataOrPipes: unknown[]) => ParameterDecorator;
export declare const CurrentEmpresaId: (...dataOrPipes: unknown[]) => ParameterDecorator;
