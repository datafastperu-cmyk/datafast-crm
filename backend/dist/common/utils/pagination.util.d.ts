import { SelectQueryBuilder } from 'typeorm';
import { PaginationDto, PaginatedResult } from '../dto/response.dto';
export declare function paginate<T>(qb: SelectQueryBuilder<T>, dto: PaginationDto, allowedSortFields?: string[]): Promise<PaginatedResult<T>>;
export declare function formatPaginatedResponse<T>(result: PaginatedResult<T>): {
    data: T[];
    meta: {
        total: number;
        page: number;
        limit: number;
        totalPages: number;
        hasNextPage: boolean;
        hasPrevPage: boolean;
        from: number;
        to: number;
    };
};
export type { PaginatedResult } from '../dto/response.dto';
