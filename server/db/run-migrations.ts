import { existsSync } from 'node:fs'
import { loadEnvFile } from 'node:process'
import { z } from 'zod'

import { migrateDatabase } from './migrate.js'

if (existsSync('.env')) loadEnvFile('.env')

const databaseUrl = z.string().url().parse(process.env.DATABASE_URL)
await migrateDatabase(databaseUrl)
