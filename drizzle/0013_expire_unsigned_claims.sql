DROP INDEX "claims_one_active_type_per_passport";--> statement-breakpoint
CREATE UNIQUE INDEX "claims_one_active_type_per_passport" ON "claims" USING btree ("passport_id","claim_type") WHERE "claims"."workflow_state" <> 'rejected' and "claims"."signature_status" <> 'expired';--> statement-breakpoint
ALTER TABLE "claims" ADD CONSTRAINT "claims_expired_proof_empty" CHECK ("claims"."signature_status" <> 'expired' or ("claims"."claim_signer_address" is null and "claims"."public_key" is null and "claims"."signature" is null and "claims"."verifier_version" is null and "claims"."verified_at" is null and "claims"."workflow_state" = 'signature_requested'));--> statement-breakpoint
CREATE OR REPLACE FUNCTION protect_claim_lifecycle() RETURNS trigger AS $$
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

	IF OLD.signature_status = 'expired' THEN
		RAISE EXCEPTION 'expired claim challenge is immutable';
	END IF;

	IF NEW.signature_status = 'expired' THEN
		IF OLD.signature_status <> 'pending'
			OR OLD.workflow_state <> 'signature_requested'
			OR NEW.workflow_state <> 'signature_requested'
			OR OLD.expires_at > clock_timestamp() THEN
			RAISE EXCEPTION 'only an unsigned claim challenge past its expiry may expire';
		END IF;
		NEW.updated_at := clock_timestamp();
		RETURN NEW;
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
$$ LANGUAGE plpgsql;
