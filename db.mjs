import { openLocalDatabase } from './db-local.mjs';
import { openPostgres } from './db-postgres.mjs';
export const openDatabase=async path=>process.env.DATABASE_URL||process.env.PGHOST?openPostgres(process.env.DATABASE_URL):openLocalDatabase(path);
