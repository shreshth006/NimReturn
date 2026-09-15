CREATE TYPE "public"."resolution_decision" AS ENUM('APPROVED', 'REJECTED');--> statement-breakpoint
CREATE TYPE "public"."resolution_reason_code" AS ENUM('INSUFFICIENT_INFORMATION', 'POLICY_ACCEPTED', 'POLICY_NOT_APPLICABLE', 'OTHER');--> statement-breakpoint
CREATE TYPE "public"."resolution_verification_status" AS ENUM('pending', 'verified', 'expired');--> statement-breakpoint
CREATE TABLE "claim_resolutions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"public_id" char(22) NOT NULL,
	"claim_id" uuid NOT NULL,
	"merchant_id" uuid NOT NULL,
	"policy_signer_address" varchar(36) NOT NULL,
	"decision" "resolution_decision" NOT NULL,
	"reason_code" "resolution_reason_code" NOT NULL,
	"note" varchar(1024) DEFAULT '' NOT NULL,
	"approved_refund_luna" bigint NOT NULL,
	"resolution_time" timestamp with time zone NOT NULL,
	"challenge_nonce" char(22) NOT NULL,
	"payload" jsonb NOT NULL,
	"canonical_message" text NOT NULL,
	"payload_hash" char(64) NOT NULL,
	"public_key" char(64),
	"signature" char(128),
	"signer_address" varchar(36),
	"verifier_version" varchar(40),
	"verification_status" "resolution_verification_status" DEFAULT 'pending' NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	"verified_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "claim_resolutions_public_id_unique" UNIQUE("public_id"),
	CONSTRAINT "claim_resolutions_challenge_nonce_unique" UNIQUE("challenge_nonce"),
	CONSTRAINT "claim_resolutions_public_id_format" CHECK ("claim_resolutions"."public_id" ~ '^[A-Za-z0-9_-]{22}$'),
	CONSTRAINT "claim_resolutions_nonce_format" CHECK ("claim_resolutions"."challenge_nonce" ~ '^[A-Za-z0-9_-]{22}$'),
	CONSTRAINT "claim_resolutions_payload_object" CHECK (jsonb_typeof("claim_resolutions"."payload") = 'object'),
	CONSTRAINT "claim_resolutions_canonical_message_domain" CHECK ("claim_resolutions"."canonical_message" like 'NIMRETURN/1/RESOLUTION' || chr(10) || '%'),
	CONSTRAINT "claim_resolutions_payload_hash_format" CHECK ("claim_resolutions"."payload_hash" ~ '^[0-9a-f]{64}$'),
	CONSTRAINT "claim_resolutions_policy_signer_format" CHECK ("claim_resolutions"."policy_signer_address" ~ '^NQ[0-9A-HJ-NP-VXY]{34}$'),
	CONSTRAINT "claim_resolutions_signer_format" CHECK ("claim_resolutions"."signer_address" is null or "claim_resolutions"."signer_address" ~ '^NQ[0-9A-HJ-NP-VXY]{34}$'),
	CONSTRAINT "claim_resolutions_note_format" CHECK (btrim("claim_resolutions"."note") = "claim_resolutions"."note" and "claim_resolutions"."note" !~ '[[:cntrl:]]'),
	CONSTRAINT "claim_resolutions_amount_shape" CHECK (("claim_resolutions"."decision" = 'APPROVED' and "claim_resolutions"."approved_refund_luna" > 0 and "claim_resolutions"."approved_refund_luna" <= 9007199254740991) or ("claim_resolutions"."decision" = 'REJECTED' and "claim_resolutions"."approved_refund_luna" = 0)),
	CONSTRAINT "claim_resolutions_valid_expiry" CHECK ("claim_resolutions"."expires_at" > "claim_resolutions"."created_at"),
	CONSTRAINT "claim_resolutions_verified_proof_complete" CHECK ("claim_resolutions"."verification_status" <> 'verified' or ("claim_resolutions"."public_key" is not null and "claim_resolutions"."signature" is not null and "claim_resolutions"."signer_address" = "claim_resolutions"."policy_signer_address" and "claim_resolutions"."verifier_version" is not null and "claim_resolutions"."verified_at" is not null)),
	CONSTRAINT "claim_resolutions_pending_proof_empty" CHECK ("claim_resolutions"."verification_status" <> 'pending' or ("claim_resolutions"."public_key" is null and "claim_resolutions"."signature" is null and "claim_resolutions"."signer_address" is null and "claim_resolutions"."verifier_version" is null and "claim_resolutions"."verified_at" is null))
);
--> statement-breakpoint
ALTER TABLE "claims" ADD CONSTRAINT "claims_id_merchant_unique" UNIQUE("id","merchant_id");--> statement-breakpoint
ALTER TABLE "claim_resolutions" ADD CONSTRAINT "claim_resolutions_claim_merchant_fk" FOREIGN KEY ("claim_id","merchant_id") REFERENCES "public"."claims"("id","merchant_id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "claim_resolutions_one_pending_per_claim" ON "claim_resolutions" USING btree ("claim_id") WHERE "claim_resolutions"."verification_status" = 'pending';--> statement-breakpoint
CREATE UNIQUE INDEX "claim_resolutions_one_verified_per_claim" ON "claim_resolutions" USING btree ("claim_id") WHERE "claim_resolutions"."verification_status" = 'verified';--> statement-breakpoint
CREATE INDEX "claim_resolutions_merchant_created_index" ON "claim_resolutions" USING btree ("merchant_id","created_at");--> statement-breakpoint
CREATE FUNCTION protect_claim_resolution() RETURNS trigger AS $$
DECLARE
	bound_claim claims%ROWTYPE;
	merchant_signer varchar(36);
	order_price bigint;
BEGIN
	IF TG_OP = 'DELETE' THEN
		RAISE EXCEPTION 'claim resolution evidence is retained';
	END IF;

	SELECT * INTO bound_claim FROM claims WHERE id = NEW.claim_id;
	SELECT policy_signer_address INTO merchant_signer FROM merchants WHERE id = NEW.merchant_id;
	SELECT expected_value_luna INTO order_price FROM orders WHERE id = bound_claim.order_id;
	IF bound_claim.id IS NULL
		OR bound_claim.merchant_id <> NEW.merchant_id
		OR bound_claim.workflow_state NOT IN ('eligible', 'ineligible', 'decision_pending')
		OR merchant_signer IS NULL
		OR NEW.policy_signer_address <> merchant_signer
		OR (NEW.decision = 'APPROVED' AND NEW.approved_refund_luna <> order_price)
		OR (NEW.decision = 'REJECTED' AND NEW.approved_refund_luna <> 0) THEN
		RAISE EXCEPTION 'resolution does not match claim and merchant authority';
	END IF;

	IF TG_OP = 'INSERT' THEN
		IF NEW.verification_status <> 'pending'
			OR NEW.public_key IS NOT NULL OR NEW.signature IS NOT NULL
			OR NEW.signer_address IS NOT NULL OR NEW.verifier_version IS NOT NULL
			OR NEW.verified_at IS NOT NULL THEN
			RAISE EXCEPTION 'new resolution must begin as an unsigned challenge';
		END IF;
		RETURN NEW;
	END IF;

	IF ROW(
		NEW.public_id, NEW.claim_id, NEW.merchant_id, NEW.policy_signer_address,
		NEW.decision, NEW.reason_code, NEW.note, NEW.approved_refund_luna,
		NEW.resolution_time, NEW.challenge_nonce, NEW.payload,
		NEW.canonical_message, NEW.payload_hash, NEW.expires_at, NEW.created_at
	) IS DISTINCT FROM ROW(
		OLD.public_id, OLD.claim_id, OLD.merchant_id, OLD.policy_signer_address,
		OLD.decision, OLD.reason_code, OLD.note, OLD.approved_refund_luna,
		OLD.resolution_time, OLD.challenge_nonce, OLD.payload,
		OLD.canonical_message, OLD.payload_hash, OLD.expires_at, OLD.created_at
	) THEN
		RAISE EXCEPTION 'resolution challenge binding is immutable';
	END IF;
	IF OLD.verification_status <> 'pending'
		OR NEW.verification_status NOT IN ('verified', 'expired') THEN
		RAISE EXCEPTION 'resolution verification transition is one-way';
	END IF;
	RETURN NEW;
END;
$$ LANGUAGE plpgsql;--> statement-breakpoint
CREATE TRIGGER claim_resolutions_guard
	BEFORE INSERT OR UPDATE OR DELETE ON claim_resolutions
	FOR EACH ROW EXECUTE FUNCTION protect_claim_resolution();--> statement-breakpoint
CREATE FUNCTION require_verified_claim_resolution() RETURNS trigger AS $$
BEGIN
	IF OLD.workflow_state = 'decision_pending' AND NEW.workflow_state IN ('approved', 'rejected') THEN
		IF NOT EXISTS (
			SELECT 1 FROM claim_resolutions
			WHERE claim_id = NEW.id
				AND verification_status = 'verified'
				AND decision = CASE WHEN NEW.workflow_state = 'approved'
					THEN 'APPROVED'::resolution_decision ELSE 'REJECTED'::resolution_decision END
		) THEN
			RAISE EXCEPTION 'final claim decision requires verified resolution evidence';
		END IF;
	END IF;
	RETURN NEW;
END;
$$ LANGUAGE plpgsql;--> statement-breakpoint
CREATE TRIGGER claims_resolution_evidence_guard
	BEFORE UPDATE ON claims
	FOR EACH ROW EXECUTE FUNCTION require_verified_claim_resolution();--> statement-breakpoint
GRANT SELECT, INSERT ON TABLE claim_resolutions TO nimreturn_runtime;--> statement-breakpoint
GRANT UPDATE (
	public_key, signature, signer_address, verifier_version,
	verification_status, verified_at
) ON TABLE claim_resolutions TO nimreturn_runtime;
