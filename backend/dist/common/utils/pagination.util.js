"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.paginate = paginate;
exports.formatPaginatedResponse = formatPaginatedResponse;
async function paginate(qb, dto, allowedSortFields) {
    const page = dto.page ?? 1;
    const limit = dto.limit ?? 20;
    const skip = (page - 1) * limit;
    if (dto.sortBy && allowedSortFields) {
        if (!allowedSortFields.includes(dto.sortBy)) {
            dto.sortBy = allowedSortFields[0] || 'createdAt';
        }
    }
    const alias = qb.alias;
    const sortField = dto.sortBy || 'createdAt';
    const sortOrder = dto.sortOrder || 'DESC';
    const orderField = sortField.includes('.')
        ? sortField
        : `${alias}.${sortField}`;
    qb.orderBy(orderField, sortOrder);
    const total = await qb.getCount();
    qb.skip(skip).take(limit);
    const data = await qb.getMany();
    return { data, total, page, limit };
}
function formatPaginatedResponse(result) {
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
//# sourceMappingURL=pagination.util.js.map