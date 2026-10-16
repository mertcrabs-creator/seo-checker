import 'dotenv/config';
import { defineConfig } from 'prisma/config';

// Migrate işlemleri PgBouncer (Neon pooler) üzerinden güvenilir çalışmaz;
// varsa doğrudan bağlantı kullanılır, uygulama ise DATABASE_URL (pooled) ile bağlanır.
const url = process.env.DIRECT_DATABASE_URL || process.env.DATABASE_URL;
if (!url) throw new Error('DATABASE_URL tanımlı değil (.env)');

export default defineConfig({
  schema: 'prisma/schema.prisma',
  migrations: { path: 'prisma/migrations' },
  datasource: {
    url,
    ...(process.env.SHADOW_DATABASE_URL && { shadowDatabaseUrl: process.env.SHADOW_DATABASE_URL }),
  },
});
