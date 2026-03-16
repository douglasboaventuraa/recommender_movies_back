import dotenv from 'dotenv';
import pg from 'pg';

dotenv.config();

const { Pool } = pg;

const connectionString = process.env.DATABASE_URL?.trim();
const sslEnabled = process.env.PGSSL === 'true'
  || process.env.PGSSLMODE === 'require'
  || Boolean(connectionString && !connectionString.includes('localhost'));

const config = connectionString
  ? { connectionString }
  : {
      host: process.env.POSTGRES_HOST || 'localhost',
      port: Number(process.env.POSTGRES_PORT || 5432),
      database: process.env.POSTGRES_DB || 'smartshop_recommender',
      user: process.env.POSTGRES_USER || 'postgres',
      password: process.env.POSTGRES_PASSWORD || 'postgres'
    };

if (sslEnabled) {
  config.ssl = { rejectUnauthorized: false };
}

export const pool = new Pool(config);
