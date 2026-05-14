"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
require("dotenv/config");
const typeorm_1 = require("typeorm");
const path = require("path");
exports.default = new typeorm_1.DataSource({
    type: 'postgres',
    host: process.env.DB_HOST || 'localhost',
    port: parseInt(process.env.DB_PORT, 10) || 5432,
    database: process.env.DB_NAME || 'fibranet',
    username: process.env.DB_USER || 'fibranet',
    password: process.env.DB_PASSWORD,
    ssl: process.env.DB_SSL === 'true' ? { rejectUnauthorized: false } : false,
    entities: [path.join(__dirname, '../**/*.entity{.ts,.js}')],
    migrations: [path.join(__dirname, '../database/migrations/*{.ts,.js}')],
    migrationsTableName: 'typeorm_migrations',
    synchronize: false,
    logging: true,
});
//# sourceMappingURL=datasource.js.map