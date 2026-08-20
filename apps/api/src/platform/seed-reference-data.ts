import 'dotenv/config';
import { createDatabase } from '../database.js';
import { seedReferenceData } from './reference-seed-service.js';

const databaseUrl = process.env.DATABASE_URL;
if (!databaseUrl) throw new Error('DATABASE_URL is required');

const prisma = createDatabase(databaseUrl);
try {
  const result = await seedReferenceData(prisma);
  process.stdout.write(`${JSON.stringify({ status: 'ok', ...result })}\n`);
} finally {
  await prisma.$disconnect();
}
