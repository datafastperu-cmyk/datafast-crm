import { MigrationInterface, QueryRunner } from 'typeorm';
export declare class CreateFacturasAndPagos1700000008000 implements MigrationInterface {
    name: string;
    up(queryRunner: QueryRunner): Promise<void>;
    down(queryRunner: QueryRunner): Promise<void>;
}
