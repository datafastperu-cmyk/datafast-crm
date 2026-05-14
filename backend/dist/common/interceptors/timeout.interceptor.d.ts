import { NestInterceptor, ExecutionContext, CallHandler } from '@nestjs/common';
import { Observable } from 'rxjs';
export declare class TimeoutInterceptor implements NestInterceptor {
    private readonly timeoutMs;
    constructor(timeoutMs?: number);
    intercept(context: ExecutionContext, next: CallHandler): Observable<any>;
}
