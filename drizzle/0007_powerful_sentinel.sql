CREATE TYPE "public"."claim_authorization_mode" AS ENUM('self', 'delegated');--> statement-breakpoint
CREATE TYPE "public"."claim_reason_code" AS ENUM('CHANGED_MIND', 'DEFECTIVE', 'NOT_AS_DESCRIBED', 'OTHER');--> statement-breakpoint
CREATE TYPE "public"."claim_signature_status" AS ENUM('pending', 'verified', 'expired');--> statement-breakpoint
CREATE TYPE "public"."claim_type" AS ENUM('RETURN', 'WARRANTY');--> statement-breakpoint
CREATE TYPE "public"."claim_workflow_state" AS ENUM('signature_requested', 'authorization_pending', 'eligible', 'ineligible', 'decision_pending', 'approved', 'rejected');--> statement-breakpoint
CREATE TABLE "claim_authorizations" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"public_id" char(22) NOT NULL,
	"claim_id" uuid NOT NULL,
	"authorization_mode" "claim_authorization_mode" NOT NULL,
	"purchase_sender_address" varchar(36) NOT NULL,
	"claim_signer_address" varchar(36) NOT NULL,
	"claim_payload_hash" char(64) NOT NULL,
	"challenge_nonce" char(22),
	"payload" jsonb,
	"canonical_message" text,
	"payload_hash" char(64),
	"public_key" char(64),
	"signature" char(128),
	"authorization_signer_address" varchar(36),
	"verifier_version" varchar(40),
	"expires_at" timestamp with time zone,
	"consumed_at" timestamp with time zone,
	"verified_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "claim_authorizations_public_id_unique" UNIQUE("public_id"),
	CONSTRAINT "claim_authorizations_nonce_unique" UNIQUE("challenge_nonce"),
	CONSTRAINT "claim_authorizations_public_id_format" CHECK ("claim_authorizations"."public_id" ~ '^[A-Za-z0-9_-]{22}$'),
	CONSTRAINT "claim_authorizations_nonce_format" CHECK ("claim_authorizations"."challenge_nonce" is null or "claim_authorizations"."challenge_nonce" ~ '^[A-Za-z0-9_-]{22}$'),
	CONSTRAINT "claim_authorizations_address_format" CHECK ("claim_authorizations"."purchase_sender_address" ~ '^NQ[0-9A-HJ-NP-VXY]{34}$' and "claim_authorizations"."claim_signer_address" ~ '^NQ[0-9A-HJ-NP-VXY]{34}$' and ("claim_authorizations"."authorization_signer_address" is null or "claim_authorizations"."authorization_signer_address" ~ '^NQ[0-9A-HJ-NP-VXY]{34}$')),
	CONSTRAINT "claim_authorizations_claim_hash_format" CHECK ("claim_authorizations"."claim_payload_hash" ~ '^[0-9a-f]{64}$'),
	CONSTRAINT "claim_authorizations_payload_hash_format" CHECK ("claim_authorizations"."payload_hash" is null or "claim_authorizations"."payload_hash" ~ '^[0-9a-f]{64}$'),
	CONSTRAINT "claim_authorizations_payload_object" CHECK ("claim_authorizations"."payload" is null or jsonb_typeof("claim_authorizations"."payload") = 'object'),
	CONSTRAINT "claim_authorizations_mode_shape" CHECK (("claim_authorizations"."authorization_mode" = 'self' and "claim_authorizations"."purchase_sender_address" = "claim_authorizations"."claim_signer_address" and "claim_authorizations"."challenge_nonce" is null and "claim_authorizations"."payload" is null and "claim_authorizations"."canonical_message" is null and "claim_authorizations"."payload_hash" is null and "claim_authorizations"."public_key" is null and "claim_authorizations"."signature" is null and "claim_authorizations"."authorization_signer_address" is null and "claim_authorizations"."expires_at" is null and "claim_authorizations"."consumed_at" is not null and "claim_authorizations"."verified_at" is not null) or ("claim_authorizations"."authorization_mode" = 'delegated' and "claim_authorizations"."purchase_sender_address" <> "claim_authorizations"."claim_signer_address" and "claim_authorizations"."challenge_nonce" is not null and "claim_authorizations"."payload" is not null and "claim_authorizations"."canonical_message" like 'NIMRETURN/1/CLAIM_AUTHORIZATION' || chr(10) || '%' and "claim_authorizations"."payload_hash" is not null and "claim_authorizations"."expires_at" is not null and "claim_authorizations"."expires_at" > "claim_authorizations"."created_at")),
	CONSTRAINT "claim_authorizations_delegated_proof_complete" CHECK ("claim_authorizations"."authorization_mode" <> 'delegated' or "claim_authorizations"."consumed_at" is null or ("claim_authorizations"."public_key" is not null and "claim_authorizations"."signature" is not null and "claim_authorizations"."authorization_signer_address" = "claim_authorizations"."purchase_sender_address" and "claim_authorizations"."verifier_version" is not null and "claim_authorizations"."verified_at" is not null))
);
--> statement-breakpoint
CREATE TABLE "claim_eligibility_evaluations" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"claim_id" uuid NOT NULL,
	"evaluator_version" varchar(40) NOT NULL,
	"evaluated_at" timestamp with time zone NOT NULL,
	"inputs" jsonb NOT NULL,
	"rule_results" jsonb NOT NULL,
	"eligible" boolean NOT NULL,
	"supersedes_id" uuid,
	"reason" varchar(100),
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "claim_eligibility_inputs_object" CHECK (jsonb_typeof("claim_eligibility_evaluations"."inputs") = 'object'),
	CONSTRAINT "claim_eligibility_rules_object" CHECK (jsonb_typeof("claim_eligibility_evaluations"."rule_results") = 'object'),
	CONSTRAINT "claim_eligibility_evaluator_not_blank" CHECK (btrim("claim_eligibility_evaluations"."evaluator_version") <> '')
);
--> statement-breakpoint
CREATE TABLE "claims" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"public_id" char(22) NOT NULL,
	"passport_id" uuid NOT NULL,
	"order_id" uuid NOT NULL,
	"policy_version_id" uuid NOT NULL,
	"merchant_id" uuid NOT NULL,
	"purchase_sender_address" varchar(36) NOT NULL,
	"claim_signer_address" varchar(36),
	"claim_type" "claim_type" NOT NULL,
	"reason_code" "claim_reason_code" NOT NULL,
	"note" varchar(1024) DEFAULT '' NOT NULL,
	"claim_time" timestamp with time zone NOT NULL,
	"challenge_nonce" char(22) NOT NULL,
	"payload" jsonb NOT NULL,
	"canonical_message" text NOT NULL,
	"payload_hash" char(64) NOT NULL,
	"public_key" char(64),
	"signature" char(128),
	"verifier_version" varchar(40),
	"signature_status" "claim_signature_status" DEFAULT 'pending' NOT NULL,
	"workflow_state" "claim_workflow_state" DEFAULT 'signature_requested' NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	"verified_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "claims_public_id_unique" UNIQUE("public_id"),
	CONSTRAINT "claims_challenge_nonce_unique" UNIQUE("challenge_nonce"),
	CONSTRAINT "claims_id_passport_unique" UNIQUE("id","passport_id"),
	CONSTRAINT "claims_public_id_format" CHECK ("claims"."public_id" ~ '^[A-Za-z0-9_-]{22}$'),
	CONSTRAINT "claims_nonce_format" CHECK ("claims"."challenge_nonce" ~ '^[A-Za-z0-9_-]{22}$'),
	CONSTRAINT "claims_payload_hash_format" CHECK ("claims"."payload_hash" ~ '^[0-9a-f]{64}$'),
	CONSTRAINT "claims_payload_object" CHECK (jsonb_typeof("claims"."payload") = 'object'),
	CONSTRAINT "claims_canonical_message_domain" CHECK ("claims"."canonical_message" like 'NIMRETURN/1/CLAIM' || chr(10) || '%'),
	CONSTRAINT "claims_purchase_sender_format" CHECK ("claims"."purchase_sender_address" ~ '^NQ[0-9A-HJ-NP-VXY]{34}$'),
	CONSTRAINT "claims_signer_format" CHECK ("claims"."claim_signer_address" is null or "claims"."claim_signer_address" ~ '^NQ[0-9A-HJ-NP-VXY]{34}$'),
	CONSTRAINT "claims_note_format" CHECK (btrim("claims"."note") = "claims"."note" and "claims"."note" !~ '[[:cntrl:]]'),
	CONSTRAINT "claims_valid_expiry" CHECK ("claims"."expires_at" > "claims"."created_at"),
	CONSTRAINT "claims_verified_proof_complete" CHECK ("claims"."signature_status" <> 'verified' or ("claims"."claim_signer_address" is not null and "claims"."public_key" is not null and "claims"."signature" is not null and "claims"."verifier_version" is not null and "claims"."verified_at" is not null)),
	CONSTRAINT "claims_pending_proof_empty" CHECK ("claims"."signature_status" <> 'pending' or ("claims"."claim_signer_address" is null and "claims"."public_key" is null and "claims"."signature" is null and "claims"."verifier_version" is null and "claims"."verified_at" is null and "claims"."workflow_state" = 'signature_requested')),
	CONSTRAINT "claims_authorization_state_requires_proof" CHECK ("claims"."workflow_state" = 'signature_requested' or "claims"."signature_status" = 'verified')
);
--> statement-breakpoint
ALTER TABLE "claim_authorizations" ADD CONSTRAINT "claim_authorizations_claim_id_claims_id_fk" FOREIGN KEY ("claim_id") REFERENCES "public"."claims"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "claim_eligibility_evaluations" ADD CONSTRAINT "claim_eligibility_evaluations_claim_id_claims_id_fk" FOREIGN KEY ("claim_id") REFERENCES "public"."claims"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "claim_eligibility_evaluations" ADD CONSTRAINT "claim_eligibility_supersedes_fk" FOREIGN KEY ("supersedes_id") REFERENCES "public"."claim_eligibility_evaluations"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "purchase_passports" ADD CONSTRAINT "purchase_passports_id_order_unique" UNIQUE("id","order_id");--> statement-breakpoint
ALTER TABLE "purchase_passports" ADD CONSTRAINT "purchase_passports_id_policy_unique" UNIQUE("id","policy_version_id");--> statement-breakpoint
ALTER TABLE "purchase_passports" ADD CONSTRAINT "purchase_passports_id_merchant_unique" UNIQUE("id","merchant_id");--> statement-breakpoint
ALTER TABLE "claims" ADD CONSTRAINT "claims_passport_order_fk" FOREIGN KEY ("passport_id","order_id") REFERENCES "public"."purchase_passports"("id","order_id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "claims" ADD CONSTRAINT "claims_passport_policy_fk" FOREIGN KEY ("passport_id","policy_version_id") REFERENCES "public"."purchase_passports"("id","policy_version_id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "claims" ADD CONSTRAINT "claims_passport_merchant_fk" FOREIGN KEY ("passport_id","merchant_id") REFERENCES "public"."purchase_passports"("id","merchant_id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "claim_authorizations_one_consumed_per_claim" ON "claim_authorizations" USING btree ("claim_id") WHERE "claim_authorizations"."consumed_at" is not null;--> statement-breakpoint
CREATE INDEX "claim_authorizations_claim_created_index" ON "claim_authorizations" USING btree ("claim_id","created_at");--> statement-breakpoint
CREATE UNIQUE INDEX "claim_eligibility_one_current_per_claim" ON "claim_eligibility_evaluations" USING btree ("claim_id") WHERE "claim_eligibility_evaluations"."supersedes_id" is null;--> statement-breakpoint
CREATE INDEX "claim_eligibility_claim_evaluated_index" ON "claim_eligibility_evaluations" USING btree ("claim_id","evaluated_at");--> statement-breakpoint
CREATE UNIQUE INDEX "claims_one_active_type_per_passport" ON "claims" USING btree ("passport_id","claim_type") WHERE "claims"."workflow_state" <> 'rejected';--> statement-breakpoint
CREATE INDEX "claims_merchant_queue_index" ON "claims" USING btree ("merchant_id","workflow_state","created_at");--> statement-breakpoint
CREATE INDEX "claims_sender_created_index" ON "claims" USING btree ("purchase_sender_address","created_at");--> statement-breakpoint
CREATE FUNCTION protect_claim_lifecycle() RETURNS trigger AS $$
DECLARE
	authorization_exists boolean;
	eligibility_result boolean;
BEGIN
	IF TG_OP = 'INSERT' THEN
		IF NEW.signature_status <> 'pending'
			OR NEW.workflow_state <> 'signature_requested'
			OR NEW.claim_signer_address IS NOT NULL
			OR NEW.public_key IS NOT NULL
			OR NEW.signature IS NOT NULL
			OR NEW.verifier_version IS NOT NULL
			OR NEW.verified_at IS NOT NULL THEN
			RAISE EXCEPTION 'new claim must begin as an unsigned server challenge';
		END IF;
		RETURN NEW;
	END IF;

	IF TG_OP = 'DELETE' THEN
		RAISE EXCEPTION 'claim evidence is retained';
	END IF;

	IF ROW(
		NEW.public_id, NEW.passport_id, NEW.order_id, NEW.policy_version_id,
		NEW.merchant_id, NEW.purchase_sender_address, NEW.claim_type,
		NEW.reason_code, NEW.note, NEW.claim_time, NEW.challenge_nonce,
		NEW.payload, NEW.canonical_message, NEW.payload_hash, NEW.expires_at,
		NEW.created_at
	) IS DISTINCT FROM ROW(
		OLD.public_id, OLD.passport_id, OLD.order_id, OLD.policy_version_id,
		OLD.merchant_id, OLD.purchase_sender_address, OLD.claim_type,
		OLD.reason_code, OLD.note, OLD.claim_time, OLD.challenge_nonce,
		OLD.payload, OLD.canonical_message, OLD.payload_hash, OLD.expires_at,
		OLD.created_at
	) THEN
		RAISE EXCEPTION 'claim challenge and purchase binding are immutable';
	END IF;

	IF OLD.signature_status = 'verified' AND ROW(
		NEW.claim_signer_address, NEW.public_key, NEW.signature,
		NEW.verifier_version, NEW.verified_at
	) IS DISTINCT FROM ROW(
		OLD.claim_signer_address, OLD.public_key, OLD.signature,
		OLD.verifier_version, OLD.verified_at
	) THEN
		RAISE EXCEPTION 'verified claim proof is immutable';
	END IF;

	IF NOT (
		(OLD.workflow_state = 'signature_requested' AND NEW.workflow_state IN ('authorization_pending', 'eligible', 'ineligible'))
		OR (OLD.workflow_state = 'authorization_pending' AND NEW.workflow_state IN ('eligible', 'ineligible'))
		OR (OLD.workflow_state IN ('eligible', 'ineligible') AND NEW.workflow_state = 'decision_pending')
		OR (OLD.workflow_state = 'decision_pending' AND NEW.workflow_state IN ('approved', 'rejected'))
	) THEN
		RAISE EXCEPTION 'illegal claim workflow transition from % to %', OLD.workflow_state, NEW.workflow_state;
	END IF;

	IF NEW.workflow_state IN ('eligible', 'ineligible') THEN
		SELECT EXISTS(
			SELECT 1 FROM claim_authorizations
			WHERE claim_id = NEW.id AND consumed_at IS NOT NULL
		) INTO authorization_exists;
		SELECT eligible INTO eligibility_result
		FROM claim_eligibility_evaluations
		WHERE claim_id = NEW.id AND supersedes_id IS NULL;
		IF NOT authorization_exists
			OR eligibility_result IS NULL
			OR eligibility_result IS DISTINCT FROM (NEW.workflow_state = 'eligible') THEN
			RAISE EXCEPTION 'accepted claim requires matching authorization and eligibility evidence';
		END IF;
	END IF;

	NEW.updated_at := clock_timestamp();
	RETURN NEW;
END;
$$ LANGUAGE plpgsql;--> statement-breakpoint
CREATE TRIGGER claims_lifecycle_guard
	BEFORE INSERT OR UPDATE OR DELETE ON claims
	FOR EACH ROW EXECUTE FUNCTION protect_claim_lifecycle();--> statement-breakpoint
CREATE FUNCTION protect_claim_authorization() RETURNS trigger AS $$
DECLARE
	bound_claim claims%ROWTYPE;
BEGIN
	IF TG_OP = 'DELETE' THEN
		RAISE EXCEPTION 'claim authorization evidence is retained';
	END IF;

	IF TG_OP = 'UPDATE' THEN
		IF OLD.consumed_at IS NOT NULL THEN
			RAISE EXCEPTION 'completed claim authorization is immutable';
		END IF;
		IF OLD.authorization_mode <> 'delegated'
			OR ROW(
				NEW.public_id, NEW.claim_id, NEW.authorization_mode,
				NEW.purchase_sender_address, NEW.claim_signer_address,
				NEW.claim_payload_hash, NEW.challenge_nonce, NEW.payload,
				NEW.canonical_message, NEW.payload_hash, NEW.expires_at, NEW.created_at
			) IS DISTINCT FROM ROW(
				OLD.public_id, OLD.claim_id, OLD.authorization_mode,
				OLD.purchase_sender_address, OLD.claim_signer_address,
				OLD.claim_payload_hash, OLD.challenge_nonce, OLD.payload,
				OLD.canonical_message, OLD.payload_hash, OLD.expires_at, OLD.created_at
			) THEN
			RAISE EXCEPTION 'claim authorization binding is immutable';
		END IF;
	END IF;

	SELECT * INTO bound_claim FROM claims WHERE id = NEW.claim_id;
	IF bound_claim.id IS NULL
		OR bound_claim.signature_status <> 'verified'
		OR bound_claim.workflow_state <> 'authorization_pending'
		OR NEW.purchase_sender_address <> bound_claim.purchase_sender_address
		OR NEW.claim_signer_address <> bound_claim.claim_signer_address
		OR NEW.claim_payload_hash <> bound_claim.payload_hash THEN
		RAISE EXCEPTION 'claim authorization does not match verified pending claim';
	END IF;

	RETURN NEW;
END;
$$ LANGUAGE plpgsql;--> statement-breakpoint
CREATE TRIGGER claim_authorizations_immutable_guard
	BEFORE UPDATE OR DELETE ON claim_authorizations
	FOR EACH ROW EXECUTE FUNCTION protect_claim_authorization();--> statement-breakpoint
CREATE FUNCTION protect_claim_evaluation() RETURNS trigger AS $$
BEGIN
	IF TG_OP <> 'INSERT' THEN
		RAISE EXCEPTION 'claim eligibility evidence is append-only';
	END IF;
	IF NOT EXISTS (
		SELECT 1 FROM claims
		WHERE id = NEW.claim_id
			AND signature_status = 'verified'
			AND workflow_state = 'authorization_pending'
	) OR NOT EXISTS (
		SELECT 1 FROM claim_authorizations
		WHERE claim_id = NEW.claim_id AND consumed_at IS NOT NULL
	) THEN
		RAISE EXCEPTION 'claim eligibility requires completed claimant authorization';
	END IF;
	RETURN NEW;
END;
$$ LANGUAGE plpgsql;--> statement-breakpoint
CREATE TRIGGER claim_eligibility_append_only
	BEFORE INSERT OR UPDATE OR DELETE ON claim_eligibility_evaluations
	FOR EACH ROW EXECUTE FUNCTION protect_claim_evaluation();--> statement-breakpoint
GRANT SELECT, INSERT ON TABLE claims TO nimreturn_runtime;--> statement-breakpoint
GRANT UPDATE (
	claim_signer_address, public_key, signature, verifier_version,
	signature_status, workflow_state, verified_at
) ON TABLE claims TO nimreturn_runtime;--> statement-breakpoint
GRANT SELECT, INSERT ON TABLE claim_authorizations TO nimreturn_runtime;--> statement-breakpoint
GRANT UPDATE (
	public_key, signature, authorization_signer_address, verifier_version,
	consumed_at, verified_at
) ON TABLE claim_authorizations TO nimreturn_runtime;--> statement-breakpoint
GRANT SELECT, INSERT ON TABLE claim_eligibility_evaluations TO nimreturn_runtime;
