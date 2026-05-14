import { SelectQueryBuilder } from 'typeorm';
import { PaginationDto, PaginatedResult } from '../dto/response.dto';

// ─── Aplicar paginación a un QueryBuilder ─────────────────────
export async function paginate<T>(
  qb: SelectQueryBuilder<T>,
  dto: PaginationDto,
  allowedSortFields?: string[],
): Promise<PaginatedResult<T>> {
  const page = dto.page ?? 1;
  const limit = dto.limit ?? 20;
  const skip = (page - 1) * limit;

  // Validar campo de ordenamiento para prevenir SQL injection
  if (dto.sortBy && allowedSortFields) {
    if (!allowedSortFields.includes(dto.sortBy)) {
      dto.sortBy = allowedSortFields[0] || 'createdAt';
    }
  }

  // Aplicar ordenamiento
  const alias = qb.alias;
  const sortField = dto.sortBy || 'createdAt';
  const sortOrder = dto.sortOrder || 'DESC';

  // El campo puede ser 'entity.field' o solo 'field'
  const orderField = sortField.includes('.')
    ? sortField
    : `${alias}.${sortField}`;

  qb.orderBy(orderField, sortOrder);

  // Contar total antes de aplicar paginación
  const total = await qb.getCount();

  // Aplicar paginación
  qb.skip(skip).take(limit);
  const data = await qb.getMany();

  return { data, total, page, limit };
}

// ─── Formatear resultado paginado para la respuesta ───────────
export function formatPaginatedResponse<T>(result: PaginatedResult<T>) {
  const { data, total, page, limit } = result;
  return {
    data,
    meta: {
      total,
      page,
      limit,
      totalPages: Math.ceil(total / limit),
      hasNextPage: page * limit < total,
      hasPrevPage: page > 1,
      from: total === 0 ? 0 : (page - 1) * limit + 1,
      to: Math.min(page * limit, total),
    },
  };
}

