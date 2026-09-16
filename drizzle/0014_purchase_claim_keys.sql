ALTER TYPE "public"."claim_authorization_mode" ADD VALUE 'purchase_key';--> statement-breakpoint
CREATE TABLE "purchase_claim_keys" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"order_id" uuid NOT NULL,
	"nonce" char(22) NOT NULL,
	"payload" jsonb NOT NULL,
	"canonical_message" text NOT NULL,
	"payload_hash" char(64) NOT NULL,
	"signer_address" varchar(36),
	"public_key" char(64),
	"signature" char(128),
	"verifier_version" varchar(40),
	"expires_at" timestamp with time zone NOT NULL,
	"verified_at" timestamp with time zone,
	"created_at" timestamp with time zone NOT NULL,
	CONSTRAINT "purchase_claim_keys_nonce_unique" UNIQUE("nonce"),
	CONSTRAINT "purchase_claim_keys_nonce_format" CHECK ("purchase_claim_keys"."nonce" ~ '^[A-Za-z0-9_-]{22}$'),
	CONSTRAINT "purchase_claim_keys_payload_hash_format" CHECK ("purchase_claim_keys"."payload_hash" ~ '^[0-9a-f]{64}$'),
	CONSTRAINT "purchase_claim_keys_payload_binding" CHECK (jsonb_typeof("purchase_claim_keys"."payload") = 'object' and "purchase_claim_keys"."payload"->>'nonce' = "purchase_claim_keys"."nonce" and "purchase_claim_keys"."payload"->>'type' = 'PURCHASE_CLAIM_KEY' and "purchase_claim_keys"."payload"->>'protocol' = 'NR1'),
	CONSTRAINT "purchase_claim_keys_canonical_message_domain" CHECK ("purchase_claim_keys"."canonical_message" like 'NIMRETURN/1/PURCHASE_CLAIM_KEY' || chr(10) || '%'),
	CONSTRAINT "purchase_claim_keys_signer_format" CHECK ("purchase_claim_keys"."signer_address" is null or "purchase_claim_keys"."signer_address" ~ '^NQ[0-9A-HJ-NP-VXY]{34}$'),
	CONSTRAINT "purchase_claim_keys_valid_times" CHECK ("purchase_claim_keys"."expires_at" > "purchase_claim_keys"."created_at"),
	CONSTRAINT "purchase_claim_keys_proof_shape" CHECK (("purchase_claim_keys"."verified_at" is null and "purchase_claim_keys"."signer_address" is null and "purchase_claim_keys"."public_key" is null and "purchase_claim_keys"."signature" is null and "purchase_claim_keys"."verifier_version" is null) or ("purchase_claim_keys"."verified_at" is not null and "purchase_claim_keys"."signer_address" is not null and "purchase_claim_keys"."public_key" ~ '^[0-9a-f]{64}$' and "purchase_claim_keys"."signature" ~ '^[0-9a-f]{128}$' and "purchase_claim_keys"."verifier_version" is not null and "purchase_claim_keys"."verified_at" >= "purchase_claim_keys"."created_at" and "purchase_claim_keys"."verified_at" < "purchase_claim_keys"."expires_at"))
);
--> statement-breakpoint
ALTER TABLE "claim_authorizations" DROP CONSTRAINT "claim_authorizations_mode_shape";--> statement-breakpoint
ALTER TABLE "claim_authorizations" ADD COLUMN "claim_key_id" uuid;--> statement-breakpoint
ALTER TABLE "purchase_claim_keys" ADD CONSTRAINT "purchase_claim_keys_order_id_orders_id_fk" FOREIGN KEY ("order_id") REFERENCES "public"."orders"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "purchase_claim_keys_one_verified_per_order" ON "purchase_claim_keys" USING btree ("order_id") WHERE "purchase_claim_keys"."verified_at" is not null;--> statement-breakpoint
CREATE INDEX "purchase_claim_keys_order_created_index" ON "purchase_claim_keys" USING btree ("order_id","created_at");--> statement-breakpoint
ALTER TABLE "claim_authorizations" ADD CONSTRAINT "claim_authorizations_claim_key_id_purchase_claim_keys_id_fk" FOREIGN KEY ("claim_key_id") REFERENCES "public"."purchase_claim_keys"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "claim_authorizations" ADD CONSTRAINT "claim_authorizations_claim_key_mode" CHECK (("claim_authorizations"."authorization_mode"::text = 'purchase_key') = ("claim_authorizations"."claim_key_id" is not null));--> statement-breakpoint
ALTER TABLE "claim_authorizations" ADD CONSTRAINT "claim_authorizations_mode_shape" CHECK (("claim_authorizations"."authorization_mode" = 'self' and "claim_authorizations"."purchase_sender_address" = "claim_authorizations"."claim_signer_address" and "claim_authorizations"."challenge_nonce" is null and "claim_authorizations"."payload" is null and "claim_authorizations"."canonical_message" is null and "claim_authorizations"."payload_hash" is null and "claim_authorizations"."public_key" is null and "claim_authorizations"."signature" is null and "claim_authorizations"."authorization_signer_address" is null and "claim_authorizations"."expires_at" is null and "claim_authorizations"."consumed_at" is not null and "claim_authorizations"."verified_at" is not null) or ("claim_authorizations"."authorization_mode" = 'delegated' and "claim_authorizations"."purchase_sender_address" <> "claim_authorizations"."claim_signer_address" and "claim_authorizations"."challenge_nonce" is not null and "claim_authorizations"."payload" is not null and "claim_authorizations"."canonical_message" like 'NIMRETURN/1/CLAIM_AUTHORIZATION' || chr(10) || '%' and "claim_authorizations"."payload_hash" is not null and "claim_authorizations"."expires_at" is not null and "claim_authorizations"."expires_at" > "claim_authorizations"."created_at") or ("claim_authorizations"."authorization_mode"::text = 'purchase_key' and "claim_authorizations"."purchase_sender_address" <> "claim_authorizations"."claim_signer_address" and "claim_authorizations"."challenge_nonce" is null and "claim_authorizations"."payload" is null and "claim_authorizations"."canonical_message" is null and "claim_authorizations"."payload_hash" is null and "claim_authorizations"."public_key" is null and "claim_authorizations"."signature" is null and "claim_authorizations"."authorization_signer_address" is null and "claim_authorizations"."expires_at" is null and "claim_authorizations"."consumed_at" is not null and "claim_authorizations"."verified_at" is not null));--> statement-breakpoint
CREATE FUNCTION protect_purchase_claim_key() RETURNS trigger AS $$
DECLARE
	bound_order orders%ROWTYPE;
BEGIN
	IF TG_OP = 'DELETE' THEN
		RAISE EXCEPTION 'purchase claim key evidence is retained';
	END IF;

	IF TG_OP = 'UPDATE' THEN
		IF OLD.verified_at IS NOT NULL THEN
			RAISE EXCEPTION 'verified purchase claim key is immutable';
		END IF;
		IF ROW(
			NEW.id, NEW.order_id, NEW.nonce, NEW.payload, NEW.canonical_message,
			NEW.payload_hash, NEW.expires_at, NEW.created_at
		) IS DISTINCT FROM ROW(
			OLD.id, OLD.order_id, OLD.nonce, OLD.payload, OLD.canonical_message,
			OLD.payload_hash, OLD.expires_at, OLD.created_at
		) OR NEW.verified_at IS NULL OR NEW.verified_at >= OLD.expires_at THEN
			RAISE EXCEPTION 'purchase claim key may only be verified once before expiry';
		END IF;
	ELSIF NEW.verified_at IS NOT NULL THEN
		RAISE EXCEPTION 'new purchase claim key must begin unverified';
	END IF;

	SELECT * INTO bound_order FROM orders WHERE id = NEW.order_id FOR SHARE;
	-- Binding is only possible before a payment was requested, so an observer who later
	-- sees the order tag on chain cannot attach their own claim key.
	IF bound_order.id IS NULL
		OR bound_order.payment_state <> 'payment_requested'
		OR EXISTS (
			SELECT 1 FROM chain_transactions
			WHERE purpose = 'purchase' AND resource_id = bound_order.id
		)
		OR NEW.expires_at > bound_order.expires_at
		OR NEW.payload->>'orderId' IS DISTINCT FROM bound_order.public_id
		OR NEW.payload->>'paymentData' IS DISTINCT FROM bound_order.expected_data
		OR NEW.payload->>'recipient' IS DISTINCT FROM bound_order.expected_recipient
		OR NEW.payload->>'valueLuna' IS DISTINCT FROM bound_order.expected_value_luna::text
		OR NEW.payload->>'network' IS DISTINCT FROM bound_order.network
		OR NEW.payload->>'policyPayloadHash' IS DISTINCT FROM bound_order.policy_payload_hash
		OR NEW.payload->>'createdAt' IS DISTINCT FROM floor(extract(epoch FROM NEW.created_at) * 1000)::bigint::text
		OR NEW.payload->>'expiresAt' IS DISTINCT FROM floor(extract(epoch FROM NEW.expires_at) * 1000)::bigint::text THEN
		RAISE EXCEPTION 'purchase claim key does not match an unpaid order';
	END IF;

	RETURN NEW;
END;
$$ LANGUAGE plpgsql;--> statement-breakpoint
CREATE TRIGGER purchase_claim_keys_guard
	BEFORE INSERT OR UPDATE OR DELETE ON purchase_claim_keys
	FOR EACH ROW EXECUTE FUNCTION protect_purchase_claim_key();--> statement-breakpoint
CREATE FUNCTION require_purchase_claim_key_authority() RETURNS trigger AS $$
BEGIN
	IF NEW.authorization_mode::text <> 'purchase_key' THEN
		RETURN NEW;
	END IF;
	IF NOT EXISTS (
		SELECT 1
		FROM purchase_claim_keys keys
		JOIN claims ON claims.order_id = keys.order_id
		WHERE keys.id = NEW.claim_key_id
			AND keys.verified_at IS NOT NULL
			AND keys.signer_address = NEW.claim_signer_address
			AND claims.id = NEW.claim_id
			AND claims.signature_status = 'verified'
			AND claims.workflow_state = 'authorization_pending'
			AND claims.claim_signer_address = NEW.claim_signer_address
			AND claims.purchase_sender_address = NEW.purchase_sender_address
			AND claims.payload_hash = NEW.claim_payload_hash
	) THEN
		RAISE EXCEPTION 'purchase-key authorization requires the verified key bound to this order';
	END IF;
	RETURN NEW;
END;
$$ LANGUAGE plpgsql;--> statement-breakpoint
CREATE TRIGGER claim_authorizations_purchase_key_guard
	BEFORE INSERT ON claim_authorizations
	FOR EACH ROW EXECUTE FUNCTION require_purchase_claim_key_authority();--> statement-breakpoint
CREATE FUNCTION require_purchase_claim_key_before_wallet() RETURNS trigger AS $$
BEGIN
	IF OLD.payment_state = 'payment_requested'
		AND NEW.payment_state = 'wallet_request_started'
		AND NOT EXISTS (
			SELECT 1 FROM purchase_claim_keys
			WHERE order_id = NEW.id AND verified_at IS NOT NULL
		) THEN
		RAISE EXCEPTION 'a verified purchase claim key is required before payment';
	END IF;
	RETURN NEW;
END;
$$ LANGUAGE plpgsql;--> statement-breakpoint
CREATE TRIGGER orders_purchase_claim_key_guard
	BEFORE UPDATE ON orders
	FOR EACH ROW EXECUTE FUNCTION require_purchase_claim_key_before_wallet();--> statement-breakpoint
GRANT SELECT, INSERT ON TABLE purchase_claim_keys TO nimreturn_runtime;--> statement-breakpoint
GRANT UPDATE (signer_address, public_key, signature, verifier_version, verified_at)
	ON TABLE purchase_claim_keys TO nimreturn_runtime;
