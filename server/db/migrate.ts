import { drizzle } from 'drizzle-orm/postgres-js'
import { migrate } from 'drizzle-orm/postgres-js/migrator'
import postgres from 'postgres'

export async function migrateDatabase(databaseUrl: string, migrationsFolder = 'drizzle'): Promise<void> {
  const client = postgres(databaseUrl, { max: 1 })
  try {
    await migrate(drizzle(client), { migrationsFolder })
  } finally {
    await client.end()
  }
}
