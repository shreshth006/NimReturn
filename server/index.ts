import { existsSync } from 'node:fs'
import { loadEnvFile } from 'node:process'
import postgres from 'postgres'

import { buildApp } from './app.js'
import { parseServerConfig } from './config.js'
import { NimiqRpcClient } from './rpc/nimiq-rpc.js'

if (existsSync('.env')) loadEnvFile('.env')

const config = parseServerConfig(process.env)
const database = config.DATABASE_URL ? postgres(config.DATABASE_URL) : null
const rpc = config.NIMIQ_RPC_URL ? new NimiqRpcClient(config.NIMIQ_RPC_URL) : null
const app = await buildApp(config, { database, rpc })

if (database) {
  app.addHook('onClose', async () => {
    await database.end()
  })
}

await app.listen({ host: config.HOST, port: config.PORT })
