import dotenv from 'dotenv';
dotenv.config();
import prisma from '../src/config/db';
import crypto from 'crypto';
import fs from 'fs';
import path from 'path';

async function main() {
  const migrationDir = '20261101120000_init_baseline';
  const filePath = path.join(__dirname, '../prisma/migrations', migrationDir, 'migration.sql');
  const sqlContent = fs.readFileSync(filePath);
  const checksum = crypto.createHash('sha256').update(sqlContent).digest('hex');

  await prisma.$executeRawUnsafe(`
    CREATE TABLE IF NOT EXISTS "_prisma_migrations" (
      "id"                    VARCHAR(36) PRIMARY KEY NOT NULL,
      "checksum"              VARCHAR(64) NOT NULL,
      "finished_at"           TIMESTAMPTZ,
      "migration_name"        VARCHAR(255) NOT NULL,
      "logs"                  TEXT,
      "rolled_back_at"        TIMESTAMPTZ,
      "started_at"            TIMESTAMPTZ NOT NULL DEFAULT now(),
      "applied_steps_count"   INTEGER NOT NULL DEFAULT 0
    );
  `);

  const existing = await prisma.$queryRawUnsafe<any[]>(
    `SELECT * FROM "_prisma_migrations" WHERE "migration_name" = $1`,
    migrationDir
  );

  if (existing.length === 0) {
    const id = crypto.randomUUID();
    await prisma.$executeRawUnsafe(
      `INSERT INTO "_prisma_migrations" ("id", "checksum", "finished_at", "migration_name", "logs", "rolled_back_at", "started_at", "applied_steps_count")
       VALUES ($1, $2, now(), $3, NULL, NULL, now(), 1)`,
      id,
      checksum,
      migrationDir
    );
    console.log(`Baseline migration ${migrationDir} recorded successfully.`);
  } else {
    await prisma.$executeRawUnsafe(
      `UPDATE "_prisma_migrations" SET "checksum" = $1 WHERE "migration_name" = $2`,
      checksum,
      migrationDir
    );
    console.log(`Baseline migration ${migrationDir} updated with new checksum.`);
  }

  await prisma.$disconnect();
}

main().catch(async (e) => {
  console.error(e);
  await prisma.$disconnect();
  process.exit(1);
});
