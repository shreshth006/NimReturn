import { z } from 'zod'

const optionalUrl = z.preprocess(
  (value) => value === '' ? undefined : value,
  z.string().url().optional(),
)

const configSchema = z.object({
  CORS_ORIGIN: optionalUrl,
  DATABASE_URL: optionalUrl,
  // Public ID of a real, verified Passport shown as the completed example. Kept out of Git.
  FEATURED_PASSPORT_ID: z.preprocess(
    (value) => value === '' ? undefined : value,
    z.string().regex(/^[A-Za-z0-9_-]{22}$/u).optional(),
  ),
  HOST: z.string().min(1).default('127.0.0.1'),
  // The network a wallet is assumed to be on when nothing else identifies it.
  NIMIQ_NETWORK: z.string().min(1).max(24).default('TestAlbatross'),
  // Node for NIMIQ_NETWORK. The per-network URLs below take precedence when both are set.
  NIMIQ_RPC_URL: optionalUrl,
  NIMIQ_RPC_URL_MAINALBATROSS: optionalUrl,
  NIMIQ_RPC_URL_TESTALBATROSS: optionalUrl,
  NODE_ENV: z.enum(['development', 'production', 'test']).default('development'),
  PORT: z.coerce.number().int().min(1).max(65_535).default(3001),
  SESSION_SECRET: z.preprocess(
    (value) => value === '' ? undefined : value,
    z.string().min(32).optional(),
  ),
  STATIC_ROOT: z.preprocess(
    (value) => value === '' ? undefined : value,
    z.string().min(1).optional(),
  ),
}).superRefine((config, context) => {
  if (config.NODE_ENV !== 'production') return
  for (const [field, value] of [
    ['CORS_ORIGIN', config.CORS_ORIGIN],
    ['DATABASE_URL', config.DATABASE_URL],
    ['NIMIQ_RPC_URL', config.NIMIQ_RPC_URL],
    ['SESSION_SECRET', config.SESSION_SECRET],
  ] as const) {
    if (!value) {
      context.addIssue({
        code: 'custom',
        message: `${field} is required in production.`,
        path: [field],
      })
    }
  }
})

export type ServerConfig = z.infer<typeof configSchema>

export function parseServerConfig(environment: NodeJS.ProcessEnv): ServerConfig {
  const renderOrigin = environment.RENDER_EXTERNAL_HOSTNAME
    ? `https://${environment.RENDER_EXTERNAL_HOSTNAME}`
    : undefined
  const parsed = configSchema.safeParse({
    ...environment,
    CORS_ORIGIN: environment.CORS_ORIGIN || renderOrigin,
  })
  if (!parsed.success) {
    throw new Error(`Invalid server environment: ${z.prettifyError(parsed.error)}`)
  }
  return parsed.data
}

export const MAIN_NETWORK = 'MainAlbatross'
export const TEST_NETWORK = 'TestAlbatross'

/**
 * Which node answers for which chain. A single legacy NIMIQ_RPC_URL keeps serving
 * NIMIQ_NETWORK, so an existing deployment behaves exactly as before until a
 * second node is configured.
 */
export function rpcUrlsByNetwork(config: ServerConfig): Record<string, string | undefined> {
  const urls: Record<string, string | undefined> = {
    [MAIN_NETWORK]: config.NIMIQ_RPC_URL_MAINALBATROSS,
    [TEST_NETWORK]: config.NIMIQ_RPC_URL_TESTALBATROSS,
  }
  if (config.NIMIQ_RPC_URL && !urls[config.NIMIQ_NETWORK]) {
    urls[config.NIMIQ_NETWORK] = config.NIMIQ_RPC_URL
  }
  return urls
}
