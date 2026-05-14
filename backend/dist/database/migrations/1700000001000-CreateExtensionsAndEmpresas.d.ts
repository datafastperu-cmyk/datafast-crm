import { MigrationInterface, QueryRunner } from 'typeorm';
export declare class CreateExtensionsAndEmpresas1700000001000 implements MigrationInterface {
    name: string;
    up(queryRunner: QueryRunner): Promise<void>;
    down(queryRunner: QueryRunner): Promise<void>;
}
