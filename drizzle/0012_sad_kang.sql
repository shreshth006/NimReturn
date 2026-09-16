CREATE TABLE "merchant_session_challenges" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"nonce" char(22) NOT NULL,
	"merchant_id" uuid NOT NULL,
	"expected_signer_address" varchar(36) NOT NULL,
	"audience" varchar(2048) NOT NULL,
	"payload" jsonb NOT NULL,
	"canonical_message" text NOT NULL,
	"payload_hash" char(64) NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	"consumed_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "merchant_session_challenges_nonce_unique" UNIQUE("nonce"),
	CONSTRAINT "merchant_session_challenges_nonce_format" CHECK ("merchant_session_challenges"."nonce" ~ '^[A-Za-z0-9_-]{22}$'),
	CONSTRAINT "merchant_session_challenges_expected_signer_format" CHECK ("merchant_session_challenges"."expected_signer_address" ~ '^NQ[0-9A-HJ-NP-VXY]{34}$'),
	CONSTRAINT "merchant_session_challenges_audience_format" CHECK (btrim("merchant_session_challenges"."audience") = "merchant_session_challenges"."audience" and "merchant_session_challenges"."audience" ~ '^https?://' and "merchant_session_challenges"."audience" !~ '[[:cntrl:]]'),
	CONSTRAINT "merchant_session_challenges_payload_object" CHECK (jsonb_typeof("merchant_session_challenges"."payload") = 'object'),
	CONSTRAINT "merchant_session_challenges_payload_binding" CHECK ("merchant_session_challenges"."payload"->>'nonce' = "merchant_session_challenges"."nonce" and "merchant_session_challenges"."payload"->>'audience' = "merchant_session_challenges"."audience" and "merchant_session_challenges"."payload"->>'policySignerAddress' = "merchant_session_challenges"."expected_signer_address" and "merchant_session_challenges"."payload"->>'type' = 'MERCHANT_SESSION' and "merchant_session_challenges"."payload"->>'version' = '1'),
	CONSTRAINT "merchant_session_challenges_canonical_message_domain" CHECK ("merchant_session_challenges"."canonical_message" like 'NIMRETURN/AUTH/1/MERCHANT_SESSION' || chr(10) || '%'),
	CONSTRAINT "merchant_session_challenges_payload_hash_format" CHECK ("merchant_session_challenges"."payload_hash" ~ '^[0-9a-f]{64}$'),
	CONSTRAINT "merchant_session_challenges_valid_times" CHECK ("merchant_session_challenges"."expires_at" > "merchant_session_challenges"."created_at" and "merchant_session_challenges"."expires_at" <= "merchant_session_challenges"."created_at" + interval '5 minutes' and ("merchant_session_challenges"."consumed_at" is null or ("merchant_session_challenges"."consumed_at" >= "merchant_session_challenges"."created_at" and "merchant_session_challenges"."consumed_at" < "merchant_session_challenges"."expires_at")))
);
--> statement-breakpoint
ALTER TABLE "merchant_session_challenges" ADD CONSTRAINT "merchant_session_challenges_merchant_id_merchants_id_fk" FOREIGN KEY ("merchant_id") REFERENCES "public"."merchants"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "merchant_session_challenges_merchant_expiry_index" ON "merchant_session_challenges" USING btree ("merchant_id","expires_at");--> statement-breakpoint
CREATE INDEX "merchant_session_challenges_expiry_index" ON "merchant_session_challenges" USING btree ("expires_at");--> statement-breakpoint
CREATE OR REPLACE FUNCTION protect_merchant_session_challenge() RETURNS trigger AS $$
DECLARE
	merchant_public_id char(22);
	merchant_policy_signer varchar(36);
BEGIN
	IF TG_OP = 'DELETE' THEN
		RAISE EXCEPTION 'merchant session challenge evidence is immutable';
	END IF;

	IF TG_OP = 'INSERT' THEN
		IF NEW.consumed_at IS NOT NULL THEN
			RAISE EXCEPTION 'new merchant session challenge must begin unconsumed';
		END IF;

		SELECT public_id, policy_signer_address
		INTO merchant_public_id, merchant_policy_signer
		FROM merchants
		WHERE id = NEW.merchant_id AND status = 'active'
		FOR KEY SHARE;

		IF merchant_policy_signer IS NULL
			OR NEW.expected_signer_address IS DISTINCT FROM merchant_policy_signer
			OR NEW.payload->>'merchantId' IS DISTINCT FROM merchant_public_id
			OR NEW.payload->>'createdAt' IS DISTINCT FROM floor(extract(epoch FROM NEW.created_at) * 1000)::bigint::text
			OR NEW.payload->>'expiresAt' IS DISTINCT FROM floor(extract(epoch FROM NEW.expires_at) * 1000)::bigint::text THEN
			RAISE EXCEPTION 'merchant session challenge authority binding is invalid';
		END IF;

		RETURN NEW;
	END IF;

	IF OLD.consumed_at IS NOT NULL THEN
		RAISE EXCEPTION 'consumed merchant session challenge is immutable';
	END IF;

	IF ROW(
		NEW.id, NEW.nonce, NEW.merchant_id, NEW.expected_signer_address,
		NEW.audience, NEW.payload, NEW.canonical_message, NEW.payload_hash,
		NEW.expires_at, NEW.created_at
	) IS DISTINCT FROM ROW(
		OLD.id, OLD.nonce, OLD.merchant_id, OLD.expected_signer_address,
		OLD.audience, OLD.payload, OLD.canonical_message, OLD.payload_hash,
		OLD.expires_at, OLD.created_at
	) OR NEW.consumed_at IS NULL THEN
		RAISE EXCEPTION 'merchant session challenge fields are immutable';
	END IF;

	RETURN NEW;
END;
$$ LANGUAGE plpgsql;--> statement-breakpoint
CREATE TRIGGER merchant_session_challenges_immutable
	BEFORE INSERT OR UPDATE OR DELETE ON merchant_session_challenges
	FOR EACH ROW EXECUTE FUNCTION protect_merchant_session_challenge();--> statement-breakpoint
GRANT SELECT, INSERT ON TABLE merchant_session_challenges TO nimreturn_runtime;--> statement-breakpoint
GRANT UPDATE (consumed_at) ON TABLE merchant_session_challenges TO nimreturn_runtime;
