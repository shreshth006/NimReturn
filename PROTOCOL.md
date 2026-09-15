# NimReturn Verification Protocol

## Status

Protocol family: `NR1`.

This specification defines the MVP wire evidence. Phase 0 confirmed the exact Nimiq Pay signed-message transport, D-017 froze the policy identity shape, and D-020 enables the NR1 policy writer while its actual-device exit remains open. D-022 restores all unconfirmed device-gated items to open/pending; D-023 now enables only the NR1 purchase/Passport implementation while batching those tests for a later physical session. The claim payload and claimant authorization remain **P3 candidate** under D-018; no production claim writes may be enabled before that gate closes. Any writer change requires a new entry in `DECISIONS.md`, new fixtures, and either a backwards-compatible reader or a new protocol version.

## Goals and exclusions

NR1 binds signed commercial assertions to direct NIM transactions and prevents silent policy mutation, signer substitution, and evidence replay. It does not escrow, reverse transactions, arbitrate, attest physical delivery/condition, or create legal rights.

## Common terms

- **Canonical address:** uppercase Nimiq user-friendly address with all ASCII whitespace removed, validated and round-tripped by `@nimiq/core`. Example shape `NQ...`.
- **Public token:** unpadded base64url encoding of 16 cryptographically random bytes: exactly 22 characters matching `^[A-Za-z0-9_-]{22}$` and 128 bits of entropy.
- **Timestamp:** Unix epoch milliseconds as a non-negative safe integer UTC value.
- **Duration:** non-negative safe integer seconds.
- **Luna:** non-negative safe integer; 100,000 Luna = 1 NIM. Prices/refunds must be positive where required.
- **Hex:** lower-case hexadecimal in stored canonical evidence. Public key is 32 bytes/64 hex characters; signature is 64 bytes/128 hex characters.

## Merchant identity roles

- **Policy signer:** the address cryptographically derived from the proof public key. A new merchant's first valid policy proof atomically establishes this immutable MVP identity; later policy and resolution proofs must derive to it.
- **Settlement address:** the canonical recipient embedded in every policy payload. Purchases for that policy pay this address, and NR1 refunds for those purchases are verified as originating from it.

These roles may use the same address or different addresses. `listAccounts()` and client-selected expectations establish neither role. A changed settlement address requires a new signed policy version; changing the policy signer requires a future explicit wallet-migration protocol. Public merchant/product IDs cannot initiate first-signer establishment by themselves: policy bootstrap also requires an unpredictable, expiring, server-bound session capability, consumed atomically with the challenge and signer compare-and-set.

After the first proof establishes the signer, an authenticated server session may authorize challenge allocation for that merchant. It is transport authorization, not NR1 evidence: publication still requires the exact current challenge to verify to the immutable established signer. The session contains no private key, proof, or settlement authority and cannot change an old policy. A changed policy always receives a new server-assigned version, nonce, timestamp, payload hash, and signature; verified earlier versions remain readable indefinitely.

## Versioning and domain separation

Every payload includes `protocol: "NR1"` and a fixed `type`. The bytes presented to `sign()` are:

```text
NIMRETURN/1/<TYPE>\n<CANONICAL_JSON>
```

`<TYPE>` is exactly `POLICY`, `CLAIM`, or `RESOLUTION`. ASCII LF (`0x0a`) is the sole separator and no trailing newline is added. The exact same string is passed to Nimiq Pay `sign()`, displayed for approval, and stored as `canonical_message`. Nimiq Pay's cryptographic signed-message convention UTF-8 encodes that string, prefixes it with `\x16Nimiq Signed Message:\n` plus the base-10 UTF-8 byte length, hashes the resulting bytes with SHA-256, and signs that 32-byte digest with Ed25519. The length is the message byte length, not its JavaScript character count.

NR2 or a later version uses a new prefix and tag namespace. Readers retain NR1 verification indefinitely for historical passports. Writers produce only the current explicitly enabled version.

## Canonical serialization

Canonical JSON follows RFC 8785 JSON Canonicalization Scheme (JCS): UTF-8, object keys sorted lexicographically by UTF-16 code units, minimal JSON number representation, standard JSON escaping, no insignificant whitespace. NimReturn payload schemas further restrict values:

- no `null`, floating-point, exponent input, unsafe integers, duplicate keys, or extra properties;
- all identifiers/reason codes are ASCII with schema-specific bounds;
- user text is trimmed, normalized to Unicode NFC before challenge creation, rejects control characters other than no characters (newlines are not allowed in MVP notes), and is length-bounded by Unicode code points and UTF-8 bytes;
- addresses are canonicalized before inclusion;
- every defined property is present. Optional note is represented as `""`.

The API creates the canonical challenge. On response it retrieves that exact stored challenge and compares it byte-for-byte; it does not trust a client-reconstructed object. Implementations must test property-order independence before canonicalization and exact-byte sensitivity afterward.

## Evidence hashes

`payload_hash` is lower-case hex BLAKE2b-256 over the full domain-prefixed canonical message bytes, computed with `@nimiq/core` `Hash.computeBlake2b`. It is an index/integrity handle, not a substitute for signature verification. The database stores canonical JSON, canonical message, payload hash, public key, signature, signer address, and verifier version.

## Policy payload

```json
{
  "createdAt": 1789335000000,
  "merchantId": "mL7n2psWQfTx9Vj3aBcDeA",
  "nonce": "q83Jqsl5-8Y4LtxjYOLmVA",
  "policyId": "YF4gIYhmXuGXNNDv2wO8nQ",
  "priceLuna": 500000,
  "productId": "uWzZJsbCx96gQkB6Mb0Xlg",
  "productName": "Wireless Mouse",
  "protocol": "NR1",
  "returnWindowSeconds": 604800,
  "settlementAddress": "NQ...",
  "type": "POLICY",
  "version": 1,
  "warrantyTransferAllowed": false,
  "warrantyWindowSeconds": 7776000
}
```

Constraints: product name 1–100 Unicode code points and 1–256 UTF-8 bytes; `priceLuna` is positive and within configured commerce maximum; version starts at 1 and is server-assigned monotonically per product; windows are 0 through five years; merchant, settlement address, and IDs are pre-bound by the server; nonce is one-time and expires. `createdAt` is server-issued and not purchase time. The settlement address is signed commercial content, not a claim about which key will sign.

Policy proof envelope:

```json
{
  "canonicalMessage": "NIMRETURN/1/POLICY\n{...}",
  "payloadHash": "<64 lower-case hex>",
  "publicKey": "<64 lower-case hex>",
  "signature": "<128 lower-case hex>"
}
```

## Candidate claim payload

```json
{
  "claimId": "bC2v2Ws4EkuJNV0ydOduaw",
  "claimType": "RETURN",
  "createdAt": 1789336000000,
  "nonce": "L2tiVv4suxPEkzpW3QW8xw",
  "note": "Scroll wheel is intermittent",
  "orderId": "Nv2eFQ1dKby8j1h4PV4-4g",
  "protocol": "NR1",
  "purchaseSenderAddress": "NQ...",
  "reasonCode": "DEFECTIVE",
  "type": "CLAIM"
}
```

`claimType` is `RETURN` or `WARRANTY`. `reasonCode` is an allow-listed ASCII enum versioned in application code; it describes user selection and is not itself proof. `note` is 0–280 code points and at most 1,024 UTF-8 bytes. The server copies `purchaseSenderAddress` from independently verified purchase evidence; it is not a signer claim or client argument. The claim signer is separately derived from the proof public key.

D-018 is a mandatory Phase 3 gate: a reviewed signed authorization/binding protocol must connect the derived claim signer to the purchase sender before claims can be accepted. Direct equality is not assumed, and accepting any signer is forbidden. The exact claimant-authorization fields, recovery behavior, replay rules, and resulting claim payload fixture are intentionally not frozen in Phase 1.

Claim eligibility is not signed into this payload. The server stores a separate deterministic evaluation record with evaluator version, evaluation time, inputs, per-rule outputs, and final eligible/ineligible result. Re-evaluation may identify software error but cannot silently overwrite the original result; it appends a superseding protocol event.

## Resolution payload

```json
{
  "approvedRefundLuna": 500000,
  "claimId": "bC2v2Ws4EkuJNV0ydOduaw",
  "createdAt": 1789337000000,
  "decision": "APPROVED",
  "nonce": "08EM9S-s91GdvhSUTkRr6w",
  "note": "Approved under return policy",
  "policySignerAddress": "NQ...",
  "protocol": "NR1",
  "reasonCode": "POLICY_ACCEPTED",
  "type": "RESOLUTION"
}
```

`decision` is `APPROVED` or `REJECTED`. `approvedRefundLuna` must equal the full original order price for APPROVED in MVP and `0` for REJECTED. Partial/multiple refunds are out of scope. The signer must derive to the merchant's established policy signer address. A claim has at most one final resolution; exact retry is idempotent and a conflicting resolution is rejected.

## Transaction data tags

Tags are ASCII/UTF-8 and well below Nimiq's 64-byte transaction data limit.

Purchase:

```text
NR1:P:<order-token>
```

Refund:

```text
NR1:R:<claim-token>
```

With a 22-character token each tag is 28 bytes. The grammar is `^NR1:[PR]:[A-Za-z0-9_-]{22}$`. Parsers require the entire decoded data to match—no leading/trailing whitespace, NUL, suffix, alternate case, or Unicode lookalike. Purchase token resolves to exactly one pending order. Refund token resolves to one approved claim and thereby its original order/buyer.

Tokens are generated server-side using a cryptographically secure random source. The database enforces uniqueness; collisions are retried before exposure. They are identifiers, not authentication secrets.

## Signature and address verification

For every proof:

1. Load the unconsumed server challenge and verify expiry, expected type/resource, any already-established role signer, and exact canonical message.
2. Normalize and length-check hex; reject parsing errors.
3. `publicKey = PublicKey.fromHex(publicKeyHex)`.
4. `signature = Signature.fromHex(signatureHex)`.
5. UTF-8 encode `canonicalMessage` as `messageBytes`.
6. Construct exactly `utf8("\x16Nimiq Signed Message:\n" + decimal(messageBytes.length)) || messageBytes`.
7. SHA-256 that framed preimage, then require `publicKey.verify(signature, digest)` to be true.
8. Derive the actual signer with `publicKey.toAddress()`. Compare its parsed address bytes to the server-bound signer when one is established. For a first-policy bootstrap only, atomically establish that derived address as the merchant policy signer; never use a client-selected account as the expected signer.
9. Recompute BLAKE2b-256 over the unframed `messageBytes` and compare to stored `payload_hash`.
10. Enforce the action-specific authority rule, then consume the nonce and create/transition the target resource atomically. Claim authority cannot pass until the D-018 Phase 3 binding protocol exists.

No fallback tries framed and unframed messages. The SHA-256 signing digest and the NR1 BLAKE2b-256 payload hash have separate purposes and must never be substituted for one another.

## Purchase transaction verification

Expected evidence is loaded from the server order. An accepted purchase requires:

- hash syntax valid and unused by any other purchase/refund;
- node network equals order network;
- transaction found with `executionResult: true`;
- transaction inclusion block is followed by its Albatross finalizing macro block, and the independently observed chain head is at or beyond that macro block;
- sender is a valid ordinary Nimiq account and becomes the authoritative order buyer from verified chain evidence; a client-side expected account is not a sender claim;
- recipient equals the purchase-bound signed policy `settlementAddress`;
- value equals policy snapshot `priceLuna` exactly;
- recipient data bytes decode to exact `NR1:P:<order-token>`;
- transaction is an ordinary direct value transfer compatible with expected account types;
- block time/height and transaction hash are retained.

A wallet-returned hash alone only moves the state to verifying. An absent/mempool transaction is `pending-inclusion`; a successfully executed pre-macro inclusion is `pending-finality`, regardless of ordinary confirmation count. Both remain retryable after each RPC request completes. Failed execution, an invalid observed sender, or another definitive field mismatch is `invalid`. RPC transport or malformed evidence is `inconclusive`. None creates a passport.

## Refund transaction verification

An accepted refund requires all purchase checks adapted as follows:

- claim has one valid APPROVED merchant resolution;
- sender equals the purchase-bound signed policy `settlementAddress`;
- recipient equals the original verified purchase sender, even if another wallet is currently viewing;
- value equals `approvedRefundLuna` and, for NR1 MVP, the full original price;
- data equals `NR1:R:<claim-token>`;
- hash is globally unused and state meets confirmation policy.

Approval and transaction submission are not refund completion.

## Replay and mutation protection

- 128-bit tokens and nonces are server-generated and globally unique.
- Challenges are resource-, action-, and expiry-bound, plus signer-bound whenever that role is already established. First-policy bootstrap is the sole null-expected-signer case and establishes the derived signer atomically.
- Nonces have a unique constraint and single atomic consumption.
- Transaction hashes are normalized and globally unique across purchase and refund evidence, preferably through a shared `chain_transactions` registry.
- Signed policy fields cannot be updated. New terms require a new version and new signature.
- One order → at most one verified purchase → one passport.
- One claim → one final resolution. Duplicate exact requests return existing result; conflicts fail.
- API idempotency keys are body-hash bound and supplement, not replace, protocol uniqueness.

## Eligibility time

`purchaseTime` is the included block timestamp from verified chain evidence. `claimTime` is the server-issued `createdAt` in the accepted one-time claim challenge. Deadline is `purchaseTime + windowSeconds * 1000`, checked with safe integer arithmetic. The deadline is inclusive (`claimTime <= deadline`). A zero window makes that claim type unavailable. All displays may localize, but evidence uses UTC epoch milliseconds.

## Upgrade strategy

- Readers dispatch by domain prefix, embedded protocol, and tag version.
- Unknown versions fail closed and remain displayable as unverified raw evidence.
- Backward-compatible validation tightening requires regression fixtures and a decision record; signed byte shapes never change in place.
- Breaking payload/tag/signing changes increment `NR2` and coexist with NR1.
- Store verifier software/protocol version and raw canonical evidence so historical verification remains reproducible.
- Before enabling a new writer version, complete known-good/tampered vectors, actual Nimiq Pay fixture, address binding test, transaction data round-trip, and migration/replay tests.
