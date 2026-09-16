import { randomUUID } from 'node:crypto'
import type postgres from 'postgres'
import { z } from 'zod'

import { getPurchaseOrder } from './get-purchase-order.js'
import {
  PurchaseOrderError,
  type PurchaseOrderState,
  type PurchaseOrderView,
} from './purchase-order.js'

const inputSchema = z.object({
  event: z.enum(['wallet-request-started', 'wallet-cancelled', 'submission-outcome-unknown']),
  orderPublicId: z.string().regex(/^[A-Za-z0-9_-]{22}$/u),
}).strict()

interface LockedOrderRow {
  expires_at: Date
  id: string
  payment_state: PurchaseOrderState
}

const targetState = {
  'submission-outcome-unknown': 'submission_outcome_unknown',
  'wallet-cancelled': 'payment_cancelled',
  'wallet-request-started': 'wallet_request_started',
} as const satisfies Record<z.infer<typeof inputSchema>['event'], PurchaseOrderState>

const allowedSourceStates: Record<z.infer<typeof inputSchema>['event'], PurchaseOrderState[]> = {
  'submission-outcome-unknown': ['payment_requested', 'wallet_request_started'],
  'wallet-cancelled': ['payment_requested', 'wallet_request_started'],
  'wallet-request-started': ['payment_requested', 'payment_cancelled'],
}

export async function recordPurchaseWalletState(
  client: postgres.Sql,
  rawInput: unknown,
): Promise<PurchaseOrderView> {
  const inputResult = inputSchema.safeParse(rawInput)
  if (!inputResult.success) {
    throw new PurchaseOrderError('INVALID_REQUEST', 'The wallet-state request is invalid.')
  }
  const input = inputResult.data

  return client.begin(async (transaction) => {
    const rows = await transaction<LockedOrderRow[]>`
      select id, payment_state, expires_at
      from orders where public_id = ${input.orderPublicId}
      for update
    `
    const order = rows[0]
    if (!order) throw new PurchaseOrderError('ORDER_NOT_FOUND', 'The purchase was not found.')
    const nowRows = await transaction<{ now: Date }[]>`select clock_timestamp() as now`
    const now = nowRows[0]?.now
    if (!now) throw new PurchaseOrderError('PERSISTENCE_CONFLICT', 'The database clock was unavailable.')

    if (
      now.getTime() >= order.expires_at.getTime()
      && ['payment_requested', 'wallet_request_started', 'payment_cancelled'].includes(order.payment_state)
    ) {
      await transaction`update orders set payment_state = 'expired' where id = ${order.id}`
      const expired = await getPurchaseOrder(transaction, input.orderPublicId)
      if (!expired) throw new PurchaseOrderError('PERSISTENCE_CONFLICT', 'The expired purchase disappeared.')
      return expired
    }

    const target = targetState[input.event]
    if (order.payment_state !== target) {
      if (!allowedSourceStates[input.event].includes(order.payment_state)) {
        throw new PurchaseOrderError('STATE_CONFLICT', 'The purchase cannot accept this wallet state.')
      }
      if (target === 'wallet_request_started') {
        const keys = await transaction<{ id: string }[]>`
          select id from purchase_claim_keys
          where order_id = ${order.id} and verified_at is not null
        `
        if (keys.length !== 1) {
          throw new PurchaseOrderError(
            'CLAIM_KEY_REQUIRED',
            'Sign the purchase claim key in Nimiq Pay before paying.',
          )
        }
      }
      await transaction`update orders set payment_state = ${target} where id = ${order.id}`
      await transaction`
        insert into protocol_events (
          aggregate_type, aggregate_id, event_type, protocol_version, occurred_at,
          correlation_id, evidence_type, payload
        ) values (
          'order', ${order.id}, ${`purchase.${input.event}`}, 'NR1', ${now},
          ${randomUUID()}, 'backend', ${transaction.json({ state: target })}
        )
      `
    }

    const view = await getPurchaseOrder(transaction, input.orderPublicId)
    if (!view) throw new PurchaseOrderError('PERSISTENCE_CONFLICT', 'The purchase disappeared.')
    return view
  })
}
