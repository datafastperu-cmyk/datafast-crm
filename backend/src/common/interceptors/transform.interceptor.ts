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
        if (data instanceof ApiResponse) {
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
