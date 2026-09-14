import { z } from 'zod'

const optionalUrl = z.preprocess(
  (value) => value === '' ? undefined : value,
  z.string().url().optional(),
)

const configSchema = z.object({
  CORS_ORIGIN: optionalUrl,
  DATABASE_URL: optionalUrl,
  HOST: z.string().min(1).default('127.0.0.1'),
  NIMIQ_NETWORK: z.string().min(1).default('TestAlbatross'),
  NIMIQ_RPC_URL: optionalUrl,
  NODE_ENV: z.enum(['development', 'production', 'test']).default('development'),
  PORT: z.coerce.number().int().min(1).max(65_535).default(3001),
})

export type ServerConfig = z.infer<typeof configSchema>

export function parseServerConfig(environment: NodeJS.ProcessEnv): ServerConfig {
  const parsed = configSchema.safeParse(environment)
  if (!parsed.success) {
    throw new Error(`Invalid server environment: ${z.prettifyError(parsed.error)}`)
  }
  return parsed.data
}
