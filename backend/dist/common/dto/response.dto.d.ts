export declare class ApiResponse<T = any> {
    success: boolean;
    message: string;
    data?: T;
    meta?: Record<string, any>;
    timestamp?: string;
    constructor(partial: Partial<ApiResponse<T>>);
    static ok<T>(data: T, message?: string, meta?: Record<string, any>): ApiResponse<T>;
    static error(message: string, data?: any): ApiResponse;
    static paginated<T>(data: T[], total: number, page: number, limit: number, message?: string): ApiResponse<T[]>;
}
export declare class PaginationDto {
    page?: number;
    limit?: number;
    sortBy?: string;
    sortOrder?: 'ASC' | 'DESC';
    search?: string;
    get skip(): number;
}
export interface PaginatedResult<T> {
    data: T[];
    total: number;
    page: number;
    limit: number;
}
