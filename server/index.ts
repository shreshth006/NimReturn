import { existsSync } from 'node:fs'
import { resolve } from 'node:path'
import { loadEnvFile } from 'node:process'
import fastifyStatic from '@fastify/static'
import postgres from 'postgres'

import { buildApp } from './app.js'
import { parseServerConfig } from './config.js'
import { NimiqRpcClient } from './rpc/nimiq-rpc.js'

if (existsSync('.env')) loadEnvFile('.env')

const config = parseServerConfig(process.env)
const database = config.DATABASE_URL ? postgres(config.DATABASE_URL) : null
const rpc = config.NIMIQ_RPC_URL ? new NimiqRpcClient(config.NIMIQ_RPC_URL) : null
const app = await buildApp(config, { database, rpc })

if (config.STATIC_ROOT) {
  await app.register(fastifyStatic, {
    root: resolve(config.STATIC_ROOT),
    setHeaders(reply, filePath) {
      if (filePath.includes('/assets/')) {
        reply.header('cache-control', 'public, max-age=31536000, immutable')
      } else if (filePath.endsWith('/og.png')) {
        reply.header('cache-control', 'public, max-age=3600')
      } else {
        reply.header('cache-control', 'no-cache')
      }
    },
  })
}

if (database) {
  app.addHook('onClose', async () => {
    await database.end()
  })
}

await app.listen({ host: config.HOST, port: config.PORT })
