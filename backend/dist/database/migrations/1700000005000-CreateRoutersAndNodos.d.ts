import { MigrationInterface, QueryRunner } from 'typeorm';
export declare class CreateRoutersAndNodos1700000005000 implements MigrationInterface {
    name: string;
    up(queryRunner: QueryRunner): Promise<void>;
    down(queryRunner: QueryRunner): Promise<void>;
}
