import {
  Injectable,
  NestInterceptor,
  ExecutionContext,
  CallHandler,
  Logger,
} from '@nestjs/common';
import { Observable } from 'rxjs';
import { tap, catchError } from 'rxjs/operators';
import { Request, Response } from 'express';

@Injectable()
export class LoggingInterceptor implements NestInterceptor {
  private readonly logger = new Logger('HTTP');

  intercept(context: ExecutionContext, next: CallHandler): Observable<any> {
    if (context.getType() !== 'http') return next.handle();

    const req: Request = context.switchToHttp().getRequest();
    const res: Response = context.switchToHttp().getResponse();
    const { method, url, ip } = req;
    const userAgent = req.get('user-agent') || '';
    const userId = (req as any).user?.id || 'anonymous';
    const startTime = Date.now();

    // No loggear rutas de health/metrics
    const skipPaths = ['/health', '/metrics', '/_next'];
    if (skipPaths.some((p) => url.startsWith(p))) {
      return next.handle();
    }

    return next.handle().pipe(
      tap(() => {
        const duration = Date.now() - startTime;
        const statusCode = res.statusCode;

        // Log de request completado
        this.logger.log(
          `${method} ${url} ${statusCode} ${duration}ms | user:${userId} | ip:${ip}`,
          {
            method,
            url,
            statusCode,
            duration,
            userId,
            ip,
            userAgent: userAgent.substring(0, 100),
          },
        );

        // Alerta si tarda más de 2 segundos
        if (duration > 2000) {
          this.logger.warn(
            `Respuesta lenta: ${method} ${url} tardó ${duration}ms`,
          );
        }
      }),
      catchError((error) => {
        const duration = Date.now() - startTime;
        this.logger.error(
          `${method} ${url} ERROR ${duration}ms | user:${userId} | ${error.message}`,
          {
            method,
            url,
            duration,
            userId,
            ip,
            error: error.message,
            stack: error.stack,
          },
        );
        throw error;
      }),
    );
  }
}
