# NimReturn Verification Protocol

## Status

Protocol family: `NR1`.

This specification defines the MVP wire evidence. Transaction tags and canonical payload shapes are fixed for implementation once Phase 0's actual-device signing fixture confirms that Nimiq Pay signs the exact UTF-8 message described here. Until that fixture exists, the signature transport is **P0 candidate**, and no production policy signatures may be accepted. Any post-implementation change requires a new entry in `DECISIONS.md`, new fixtures, and either a backwards-compatible reader or a new protocol version.

## Goals and exclusions

NR1 binds signed commercial assertions to direct NIM transactions and prevents silent policy mutation, signer substitution, and evidence replay. It does not escrow, reverse transactions, arbitrate, attest physical delivery/condition, or create legal rights.

## Common terms

- **Canonical address:** uppercase Nimiq user-friendly address with all ASCII whitespace removed, validated and round-tripped by `@nimiq/core`. Example shape `NQ...`.
- **Public token:** unpadded base64url encoding of 16 cryptographically random bytes: exactly 22 characters matching `^[A-Za-z0-9_-]{22}$` and 128 bits of entropy.
- **Timestamp:** Unix epoch milliseconds as a non-negative safe integer UTC value.
- **Duration:** non-negative safe integer seconds.
- **Luna:** non-negative safe integer; 100,000 Luna = 1 NIM. Prices/refunds must be positive where required.
- **Hex:** lower-case hexadecimal in stored canonical evidence. Public key is 32 bytes/64 hex characters; signature is 64 bytes/128 hex characters.

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
  "merchantAddress": "NQ...",
  "nonce": "q83Jqsl5-8Y4LtxjYOLmVA",
  "policyId": "YF4gIYhmXuGXNNDv2wO8nQ",
  "priceLuna": 500000,
  "productId": "uWzZJsbCx96gQkB6Mb0Xlg",
  "productName": "Wireless Mouse",
  "protocol": "NR1",
  "returnWindowSeconds": 604800,
  "type": "POLICY",
  "version": 1,
  "warrantyTransferAllowed": false,
  "warrantyWindowSeconds": 7776000
}
```

Constraints: product name 1–100 Unicode code points and 1–256 UTF-8 bytes; `priceLuna` is positive and within configured commerce maximum; version starts at 1 and is server-assigned monotonically per product; windows are 0 through five years; merchant and IDs are pre-bound by the server; nonce is one-time and expires. `createdAt` is server-issued and not purchase time.

Policy proof envelope:

```json
{
  "address": "NQ...",
  "canonicalMessage": "NIMRETURN/1/POLICY\n{...}",
  "payloadHash": "<64 lower-case hex>",
  "publicKey": "<64 lower-case hex>",
  "signature": "<128 lower-case hex>"
}
```

## Claim payload

```json
{
  "buyerAddress": "NQ...",
  "claimId": "bC2v2Ws4EkuJNV0ydOduaw",
  "claimType": "RETURN",
  "createdAt": 1789336000000,
  "nonce": "L2tiVv4suxPEkzpW3QW8xw",
  "note": "Scroll wheel is intermittent",
  "orderId": "Nv2eFQ1dKby8j1h4PV4-4g",
  "protocol": "NR1",
  "reasonCode": "DEFECTIVE",
  "type": "CLAIM"
}
```

`claimType` is `RETURN` or `WARRANTY`. `reasonCode` is an allow-listed ASCII enum versioned in application code; it describes user selection and is not itself proof. `note` is 0–280 code points and at most 1,024 UTF-8 bytes. The original order buyer, not a client argument, determines `buyerAddress`. One-time nonce and server time bind the request.

Claim eligibility is not signed into this payload. The server stores a separate deterministic evaluation record with evaluator version, evaluation time, inputs, per-rule outputs, and final eligible/ineligible result. Re-evaluation may identify software error but cannot silently overwrite the original result; it appends a superseding protocol event.

## Resolution payload

```json
{
  "approvedRefundLuna": 500000,
  "claimId": "bC2v2Ws4EkuJNV0ydOduaw",
  "createdAt": 1789337000000,
  "decision": "APPROVED",
  "merchantAddress": "NQ...",
  "nonce": "08EM9S-s91GdvhSUTkRr6w",
  "note": "Approved under return policy",
  "protocol": "NR1",
  "reasonCode": "POLICY_ACCEPTED",
  "type": "RESOLUTION"
}
```

`decision` is `APPROVED` or `REJECTED`. `approvedRefundLuna` must equal the full original order price for APPROVED in MVP and `0` for REJECTED. Partial/multiple refunds are out of scope. The signer must derive to the policy's merchant address. A claim has at most one final resolution; exact retry is idempotent and a conflicting resolution is rejected.

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

1. Load the unconsumed server challenge and verify expiry, expected type/resource/address, and exact canonical message.
2. Normalize and length-check hex; reject parsing errors.
3. `publicKey = PublicKey.fromHex(publicKeyHex)`.
4. `signature = Signature.fromHex(signatureHex)`.
5. UTF-8 encode `canonicalMessage` as `messageBytes`.
6. Construct exactly `utf8("\x16Nimiq Signed Message:\n" + decimal(messageBytes.length)) || messageBytes`.
7. SHA-256 that framed preimage, then require `publicKey.verify(signature, digest)` to be true.
8. Parse claimed address with `Address.fromString`; `publicKey.toAddress().equals(claimedAddress)` must be true.
9. Recompute BLAKE2b-256 over the unframed `messageBytes` and compare to stored `payload_hash`.
10. Consume nonce and create/transition the target resource atomically.

No fallback tries framed and unframed messages. The SHA-256 signing digest and the NR1 BLAKE2b-256 payload hash have separate purposes and must never be substituted for one another.

## Purchase transaction verification

Expected evidence is loaded from the server order. An accepted purchase requires:

- hash syntax valid and unused by any other purchase/refund;
- node network equals order network;
- transaction found with `executionResult: true`;
- transaction inclusion block is followed by its Albatross finalizing macro block, and the independently observed chain head is at or beyond that macro block;
- sender is a valid ordinary Nimiq account and becomes the authoritative order buyer from verified chain evidence; a client-side expected account is not a sender claim;
- recipient equals policy merchant;
- value equals policy snapshot `priceLuna` exactly;
- recipient data bytes decode to exact `NR1:P:<order-token>`;
- transaction is an ordinary direct value transfer compatible with expected account types;
- block time/height and transaction hash are retained.

A wallet-returned hash alone only moves the state to verifying. Mempool and pre-macro inclusion are pending, regardless of ordinary confirmation count. Failed execution, an invalid observed sender, or another definitive field mismatch is invalid. RPC/finality evidence failure is inconclusive. None creates a passport.

## Refund transaction verification

An accepted refund requires all purchase checks adapted as follows:

- claim has one valid APPROVED merchant resolution;
- sender equals the policy merchant;
- recipient equals the original verified purchase sender, even if another wallet is currently viewing;
- value equals `approvedRefundLuna` and, for NR1 MVP, the full original price;
- data equals `NR1:R:<claim-token>`;
- hash is globally unused and state meets confirmation policy.

Approval and transaction submission are not refund completion.

## Replay and mutation protection

- 128-bit tokens and nonces are server-generated and globally unique.
- Challenges are resource-, action-, signer-, and expiry-bound.
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
