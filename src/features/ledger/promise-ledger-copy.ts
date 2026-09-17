export const PROOF_STEPS = [
  ['Policy locked', 'Wallet signature', 'The policy signer attests to exact versioned terms and a separate settlement address.'],
  ['Purchase verified', 'Nimiq transaction', 'The chain proves who paid the signed settlement address, how much, and under which order tag.'],
  ['Passport issued', 'Derived record', 'NimReturn binds the verified payment to the policy version active at purchase.'],
  ['Claim filed', 'Wallet signature', 'The claim signer attests to the request; purchaser authority is verified separately.'],
  ['Decision recorded', 'Wallet signature', 'The original policy signer attests to approval or rejection.'],
  ['Refund verified', 'Nimiq transaction', 'For current purchases, the pre-payment claim key determines the refund destination; legacy purchases retain the settlement-sender rule. Exact recipient, value, tag, execution, and finality are verified, and the observed sender is recorded.'],
  ['Ledger derived', 'Read-only aggregate', 'These figures are recomputed from the verified records above and cannot be edited here.'],
] as const

export const CLAIM_AUTHORITY_DESCRIPTION =
  'Authorized by the purchase-bound claim key, or by the applicable legacy purchaser-authorization path.'
