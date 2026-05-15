import {
  Injectable, CanActivate, ExecutionContext,
  HttpException, HttpStatus,
} from '@nestjs/common';
import { LicenciaService } from './licencia.service';
import { BYPASS_LICENSE_PATHS } from './licencia.constants';

@Injectable()
export class LicenciaGuard implements CanActivate {
  constructor(private readonly licenciaSvc: LicenciaService) {}

  canActivate(context: ExecutionContext): boolean {
    const req  = context.switchToHttp().getRequest();
    const path = (req.path as string) || '';

    // Rutas que no requieren licencia válida
    if (BYPASS_LICENSE_PATHS.some((p) => path.startsWith(p))) {
      return true;
    }

    const { valid, razon, plan, expiresAt } = this.licenciaSvc.getEstadoActual();

    if (valid) return true;

    throw new HttpException(
      {
        statusCode: HttpStatus.PAYMENT_REQUIRED,
        error:      'LICENSE_REQUIRED',
        razon,
        message:    this.mensajeParaRazon(razon),
        plan,
        expiresAt,
      },
      HttpStatus.PAYMENT_REQUIRED,
    );
  }

  private mensajeParaRazon(razon: string): string {
    const mensajes: Record<string, string> = {
      NO_LICENSE_KEY:      'El sistema no tiene una licencia configurada. Configure LICENSE_KEY en .env.',
      INVALID_SIGNATURE:   'Licencia inválida o manipulada. Contacte al proveedor.',
      INVALID_ISSUER:      'Licencia emitida por una fuente no autorizada.',
      EXPIRED:             'La licencia ha expirado. Renueve su suscripción.',
      MACHINE_MISMATCH:    'Esta licencia no pertenece a este servidor.',
      INVALID_PLAN:        'Plan de licencia no reconocido.',
      REVOKED:             'Licencia revocada. Contacte al proveedor.',
      GRACE_EXPIRED:       'El período de gracia ha terminado. Verifique su conexión y renueve la licencia.',
      NOT_INITIALIZED:     'Sistema inicializando. Intente en unos segundos.',
    };
    return mensajes[razon] ?? 'Sistema sin licencia válida. Contacte al proveedor.';
  }
}
