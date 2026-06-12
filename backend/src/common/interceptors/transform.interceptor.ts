import {
  Injectable,
  NestInterceptor,
  ExecutionContext,
  CallHandler,
} from '@nestjs/common';
import { Observable } from 'rxjs';
import { map } from 'rxjs/operators';
import { ApiResponse } from '../dto/response.dto';

// ─── Interceptor: envuelve TODAS las respuestas en ApiResponse ─
// Antes: { id: '1', nombre: 'Juan' }
// Después: { success: true, message: '...', data: { id: '1', nombre: 'Juan' }, timestamp: '...' }
@Injectable()
export class TransformInterceptor<T>
  implements NestInterceptor<T, ApiResponse<T>>
{
  intercept(
    context: ExecutionContext,
    next: CallHandler,
  ): Observable<ApiResponse<T>> {
    // Omitir transformación en SSE y WebSocket
    if (context.getType() !== 'http') {
      return next.handle();
    }

    return next.handle().pipe(
      map((data) => {
        // Si el controller ya retorna un ApiResponse, no envolver
        // Nota: instanceof falla con SWC Stage-3 decorators (prototype mismatch),
        // por eso usamos duck-typing sobre los campos que ApiResponse siempre tiene.
        if (
          data !== null &&
          data !== undefined &&
          typeof data === 'object' &&
          typeof (data as any).success === 'boolean' &&
          'message' in data &&
          'timestamp' in data
        ) {
          return data;
        }

        // Si es null/undefined, respuesta vacía
        if (data === null || data === undefined) {
          return ApiResponse.ok(null, 'Sin datos');
        }

        return ApiResponse.ok(data);
      }),
    );
  }
}
