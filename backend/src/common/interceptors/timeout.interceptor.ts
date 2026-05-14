import {
  Injectable,
  NestInterceptor,
  ExecutionContext,
  CallHandler,
  RequestTimeoutException,
} from '@nestjs/common';
import { Observable, throwError, TimeoutError } from 'rxjs';
import { catchError, timeout } from 'rxjs/operators';

@Injectable()
export class TimeoutInterceptor implements NestInterceptor {
  constructor(private readonly timeoutMs: number = 30000) {}

  intercept(context: ExecutionContext, next: CallHandler): Observable<any> {
    // Más tiempo para endpoints de aprovisionamiento y reportes
    const req = context.switchToHttp().getRequest();
    const longRunningPaths = ['/provisioning', '/reportes', '/export'];
    const isLongRunning = longRunningPaths.some((p) =>
      req?.url?.includes(p),
    );

    const timeoutDuration = isLongRunning ? 120000 : this.timeoutMs; // 2min vs 30s

    return next.handle().pipe(
      timeout(timeoutDuration),
      catchError((error) => {
        if (error instanceof TimeoutError) {
          return throwError(
            () =>
              new RequestTimeoutException(
                `La solicitud tardó más de ${timeoutDuration / 1000}s en procesarse`,
              ),
          );
        }
        return throwError(() => error);
      }),
    );
  }
}
