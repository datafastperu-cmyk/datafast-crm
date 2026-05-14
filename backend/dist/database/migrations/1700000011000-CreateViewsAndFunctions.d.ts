import { MigrationInterface, QueryRunner } from 'typeorm';
export declare class CreateViewsAndFunctions1700000011000 implements MigrationInterface {
    name: string;
    up(queryRunner: QueryRunner): Promise<void>;
    down(queryRunner: QueryRunner): Promise<void>;
}
