import { BaseEntity } from 'typeorm';
export declare abstract class BaseModel extends BaseEntity {
    id: string;
    createdAt: Date;
    updatedAt: Date;
    deletedAt?: Date;
}
