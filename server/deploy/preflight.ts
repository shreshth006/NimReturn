import postgres from 'postgres'
import { z } from 'zod'

function requiredEnvironment(name: string): string {
  const value = process.env[name]
  if (!value) throw new Error(`${name} is required for staging preflight`)
  return value
}

const environment = {
  databaseUrl: requiredEnvironment('DATABASE_URL'),
  network: requiredEnvironment('NIMIQ_NETWORK'),
  publicOrigin: new URL(requiredEnvironment('CORS_ORIGIN')),
  rpcUrl: new URL(requiredEnvironment('NIMIQ_RPC_URL')),
}

if (environment.publicOrigin.protocol !== 'https:') throw new Error('CORS_ORIGIN must use HTTPS')
if (environment.rpcUrl.protocol !== 'https:') throw new Error('NIMIQ_RPC_URL must use HTTPS')

const healthSchema = z.object({ phase: z.literal(5), status: z.literal('ok') })
const rpcSchema = z.object({
  result: z.object({
    data: z.object({
      network: z.string(),
      number: z.number().int().safe(),
    }),
  }),
})

const database = postgres(environment.databaseUrl, { max: 1 })
try {
  const databaseRows = await database<{
    can_create_in_public: boolean
    has_admin_attribute: boolean
    has_owned_relation: boolean
    is_runtime_member: boolean
    ledger_write_privilege: boolean
  }[]>`
    select
      has_schema_privilege(current_user, 'public', 'create') as can_create_in_public,
      (rolsuper or rolcreatedb or rolcreaterole or rolreplication or rolbypassrls) as has_admin_attribute,
      exists (
        select 1
        from pg_class
        join pg_namespace on pg_namespace.oid = pg_class.relnamespace
        where pg_namespace.nspname = 'public' and pg_class.relowner = pg_roles.oid
      ) as has_owned_relation,
      pg_has_role(current_user, 'nimreturn_runtime', 'member') as is_runtime_member,
      (
        has_table_privilege(current_user, 'promise_ledger_v1', 'insert,update,delete') or
        has_table_privilege(current_user, 'promise_ledger_reconciliation_v1', 'insert,update,delete')
      ) as ledger_write_privilege
    from pg_roles
    where rolname = current_user
  `
  const runtimeRole = databaseRows[0]
  if (
    runtimeRole?.is_runtime_member !== true ||
    runtimeRole.can_create_in_public ||
    runtimeRole.has_admin_attribute ||
    runtimeRole.has_owned_relation ||
    runtimeRole.ledger_write_privilege
  ) {
    throw new Error('DATABASE_URL login is not a least-privilege nimreturn_runtime member')
  }

  const [healthResponse, previewResponse, rpcResponse] = await Promise.all([
    fetch(new URL('/health', environment.publicOrigin), { signal: AbortSignal.timeout(8_000) }),
    fetch(new URL('/og.png', environment.publicOrigin), {
      method: 'HEAD',
      signal: AbortSignal.timeout(8_000),
    }),
    fetch(environment.rpcUrl, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ jsonrpc: '2.0', id: 'staging-preflight', method: 'getLatestBlock', params: [false] }),
      signal: AbortSignal.timeout(8_000),
    }),
  ])

  if (!healthResponse.ok) throw new Error(`Public health check returned HTTP ${healthResponse.status}`)
  const health = healthSchema.parse(await healthResponse.json())
  if (!previewResponse.ok || previewResponse.headers.get('content-type') !== 'image/png') {
    throw new Error('Public judge preview image is unavailable')
  }
  if (!rpcResponse.ok) throw new Error(`Nimiq RPC returned HTTP ${rpcResponse.status}`)
  const latestBlock = rpcSchema.parse(await rpcResponse.json()).result.data
  if (latestBlock.network !== environment.network) {
    throw new Error('Nimiq RPC did not report the configured network')
  }

  console.log(JSON.stringify({
    databaseRuntimeRole: true,
    phase: health.phase,
    publicHost: environment.publicOrigin.hostname,
    rpcHead: latestBlock.number,
    rpcNetwork: latestBlock.network,
    socialPreview: true,
    status: 'ready-for-device-test',
  }, null, 2))
} finally {
  await database.end()
}
