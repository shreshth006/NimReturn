import { defineConfig } from 'drizzle-kit'

export default defineConfig({
  dialect: 'postgresql',
  out: './drizzle',
  schema: './server/db/schema.ts',
  strict: true,
  verbose: true,
})
