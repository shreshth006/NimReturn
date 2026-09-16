ALTER TABLE "refund_attempts" ADD COLUMN "recipient_rule" varchar(24) DEFAULT 'purchase-sender-v1' NOT NULL;--> statement-breakpoint
ALTER TABLE "refund_attempts" ADD COLUMN "claim_key_id" uuid;--> statement-breakpoint
ALTER TABLE "refund_attempts" ADD COLUMN "outcome_reference_height" bigint;--> statement-breakpoint
ALTER TABLE "refund_attempts" ADD COLUMN "outcome_ruled_out_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "refund_attempts" ADD COLUMN "outcome_ruled_out_height" bigint;--> statement-breakpoint
ALTER TABLE "refund_attempts" ADD CONSTRAINT "refund_attempts_claim_key_id_purchase_claim_keys_id_fk" FOREIGN KEY ("claim_key_id") REFERENCES "public"."purchase_claim_keys"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "refund_attempts" ADD CONSTRAINT "refund_attempts_recipient_rule" CHECK (("refund_attempts"."recipient_rule" = 'purchase-sender-v1' and "refund_attempts"."claim_key_id" is null) or ("refund_attempts"."recipient_rule" = 'claim-key-v2' and "refund_attempts"."claim_key_id" is not null));--> statement-breakpoint
ALTER TABLE "refund_attempts" ADD CONSTRAINT "refund_attempts_outcome_ruled_out" CHECK (("refund_attempts"."outcome_ruled_out_at" is null and "refund_attempts"."outcome_ruled_out_height" is null) or ("refund_attempts"."outcome_ruled_out_at" is not null and "refund_attempts"."outcome_reference_height" is not null and "refund_attempts"."outcome_ruled_out_height" >= "refund_attempts"."outcome_reference_height" + 7800 and "refund_attempts"."wallet_state" = 'payment_cancelled' and "refund_attempts"."transaction_hash" is null));
--> statement-breakpoint
CREATE OR REPLACE FUNCTION protect_refund_attempt() RETURNS trigger AS $$
DECLARE
	bound_claim claims%ROWTYPE;
	bound_resolution claim_resolutions%ROWTYPE;
	bound_passport purchase_passports%ROWTYPE;
	bound_order orders%ROWTYPE;
	bound_key purchase_claim_keys%ROWTYPE;
BEGIN
	IF TG_OP = 'DELETE' THEN
		RAISE EXCEPTION 'refund attempt evidence is retained';
	END IF;

	SELECT * INTO bound_claim FROM claims WHERE id = NEW.claim_id;
	SELECT * INTO bound_resolution FROM claim_resolutions WHERE id = NEW.resolution_id;
	SELECT * INTO bound_passport FROM purchase_passports WHERE id = NEW.passport_id;
	SELECT * INTO bound_order FROM orders WHERE id = bound_passport.order_id;
	IF bound_claim.id IS NULL OR bound_resolution.id IS NULL OR bound_passport.id IS NULL
		OR bound_resolution.claim_id <> bound_claim.id
		OR bound_resolution.merchant_id <> NEW.merchant_id
		OR bound_resolution.verification_status <> 'verified'
		OR bound_resolution.decision <> 'APPROVED'
		OR bound_claim.workflow_state <> 'approved'
		OR bound_claim.passport_id <> bound_passport.id
		OR NEW.claim_public_id <> bound_claim.public_id
		OR NEW.network <> bound_order.network
		OR NEW.expected_sender <> bound_passport.settlement_recipient
		OR NEW.expected_value_luna <> bound_resolution.approved_refund_luna
		OR NEW.expected_value_luna <> bound_passport.price_luna
		OR NEW.expected_data <> 'NR1:R:' || bound_claim.public_id THEN
		RAISE EXCEPTION 'refund attempt does not match verified approval and purchase evidence';
	END IF;

	IF NEW.recipient_rule = 'claim-key-v2' THEN
		SELECT * INTO bound_key FROM purchase_claim_keys WHERE id = NEW.claim_key_id;
		IF bound_key.id IS NULL
			OR bound_key.verified_at IS NULL
			OR bound_key.order_id <> bound_order.id
			OR NEW.expected_recipient <> bound_key.signer_address THEN
			RAISE EXCEPTION 'claim-key refund must pay the verified pre-payment claim key';
		END IF;
	ELSIF NEW.expected_recipient <> bound_passport.original_buyer_address THEN
		RAISE EXCEPTION 'refund attempt does not match verified approval and purchase evidence';
	END IF;

	IF TG_OP = 'INSERT' THEN
		IF NEW.wallet_state <> 'payment_requested' OR NEW.transaction_hash IS NOT NULL
			OR NEW.failure_code IS NOT NULL OR NEW.row_version <> 1
			OR NEW.outcome_reference_height IS NOT NULL
			OR NEW.outcome_ruled_out_at IS NOT NULL THEN
			RAISE EXCEPTION 'new refund attempt must begin unsubmitted';
		END IF;
		RETURN NEW;
	END IF;

	IF ROW(
		NEW.public_id, NEW.claim_id, NEW.claim_public_id, NEW.resolution_id,
		NEW.passport_id, NEW.merchant_id, NEW.network, NEW.expected_sender,
		NEW.expected_recipient, NEW.expected_value_luna, NEW.expected_data, NEW.created_at,
		NEW.recipient_rule, NEW.claim_key_id
	) IS DISTINCT FROM ROW(
		OLD.public_id, OLD.claim_id, OLD.claim_public_id, OLD.resolution_id,
		OLD.passport_id, OLD.merchant_id, OLD.network, OLD.expected_sender,
		OLD.expected_recipient, OLD.expected_value_luna, OLD.expected_data, OLD.created_at,
		OLD.recipient_rule, OLD.claim_key_id
	) THEN
		RAISE EXCEPTION 'refund attempt expectation is immutable';
	END IF;
	IF OLD.transaction_hash IS NOT NULL AND NEW.transaction_hash IS DISTINCT FROM OLD.transaction_hash THEN
		RAISE EXCEPTION 'refund attempt hash is immutable once attached';
	END IF;
	-- The outcome reference height is recorded once, while the wallet outcome is open.
	IF NEW.outcome_reference_height IS DISTINCT FROM OLD.outcome_reference_height AND (
		OLD.outcome_reference_height IS NOT NULL
		OR NEW.outcome_reference_height IS NULL
		OR (
			OLD.wallet_state NOT IN ('wallet_request_started', 'submission_outcome_unknown')
			AND NOT (OLD.wallet_state = 'payment_requested' AND NEW.wallet_state = 'wallet_request_started')
		)
	) THEN
		RAISE EXCEPTION 'refund outcome reference height is immutable';
	END IF;
	IF ROW(OLD.outcome_ruled_out_at, OLD.outcome_ruled_out_height) IS NOT NULL
		AND ROW(NEW.outcome_ruled_out_at, NEW.outcome_ruled_out_height)
			IS DISTINCT FROM ROW(OLD.outcome_ruled_out_at, OLD.outcome_ruled_out_height) THEN
		RAISE EXCEPTION 'ruled-out refund outcome is immutable';
	END IF;
	IF NEW.wallet_state = OLD.wallet_state AND ROW(
		NEW.transaction_hash, NEW.failure_code, NEW.outcome_ruled_out_at, NEW.outcome_ruled_out_height
	) IS DISTINCT FROM ROW(
		OLD.transaction_hash, OLD.failure_code, OLD.outcome_ruled_out_at, OLD.outcome_ruled_out_height
	) THEN
		RAISE EXCEPTION 'refund attempt evidence can only change with its lifecycle state';
	END IF;
	IF NEW.wallet_state IS DISTINCT FROM OLD.wallet_state AND NOT (
		(OLD.wallet_state = 'payment_requested' AND NEW.wallet_state IN ('wallet_request_started', 'payment_cancelled'))
		OR (OLD.wallet_state = 'wallet_request_started' AND NEW.wallet_state IN ('payment_cancelled', 'submission_outcome_unknown', 'payment_verifying'))
		OR (OLD.wallet_state = 'submission_outcome_unknown' AND NEW.wallet_state = 'payment_verifying')
		OR (OLD.wallet_state = 'submission_outcome_unknown' AND NEW.wallet_state = 'payment_cancelled'
			AND OLD.outcome_ruled_out_at IS NULL AND NEW.outcome_ruled_out_at IS NOT NULL)
		OR (OLD.wallet_state = 'payment_verifying' AND NEW.wallet_state IN ('payment_pending', 'payment_failed', 'refunded'))
		OR (OLD.wallet_state = 'payment_pending' AND NEW.wallet_state IN ('payment_verifying', 'payment_failed', 'refunded'))
	) THEN
		RAISE EXCEPTION 'illegal refund attempt transition from % to %', OLD.wallet_state, NEW.wallet_state;
	END IF;
	IF NEW.outcome_ruled_out_at IS NOT NULL AND OLD.outcome_ruled_out_at IS NULL AND (
		OLD.wallet_state <> 'submission_outcome_unknown'
		OR NEW.wallet_state <> 'payment_cancelled'
		OR EXISTS (
			SELECT 1 FROM chain_transactions
			WHERE purpose = 'refund' AND resource_id = NEW.id
		)
	) THEN
		RAISE EXCEPTION 'only an unresolved unknown refund outcome can be ruled out';
	END IF;
	IF NEW.wallet_state = 'refunded' AND NOT EXISTS (
		SELECT 1 FROM refund_transactions WHERE attempt_id = NEW.id
	) THEN
		RAISE EXCEPTION 'refunded state requires verified refund transaction';
	END IF;
	NEW.row_version := OLD.row_version + 1;
	NEW.updated_at := clock_timestamp();
	RETURN NEW;
END;
$$ LANGUAGE plpgsql;--> statement-breakpoint
CREATE OR REPLACE FUNCTION validate_refund_transaction() RETURNS trigger AS $$
DECLARE
	bound_attempt refund_attempts%ROWTYPE;
	bound_chain chain_transactions%ROWTYPE;
	bound_resolution claim_resolutions%ROWTYPE;
BEGIN
	IF TG_OP <> 'INSERT' THEN
		RAISE EXCEPTION 'verified refund transaction is immutable';
	END IF;
	SELECT * INTO bound_attempt FROM refund_attempts WHERE id = NEW.attempt_id;
	SELECT * INTO bound_chain FROM chain_transactions WHERE id = NEW.chain_transaction_id;
	SELECT * INTO bound_resolution FROM claim_resolutions WHERE id = NEW.resolution_id;
	-- Claim-key refunds record the observed sender as evidence; legacy refunds still
	-- require the signed settlement address as sender.
	IF bound_attempt.id IS NULL OR bound_chain.id IS NULL
		OR bound_attempt.claim_id <> NEW.claim_id
		OR bound_attempt.resolution_id <> NEW.resolution_id
		OR bound_attempt.passport_id <> NEW.passport_id
		OR bound_attempt.wallet_state NOT IN ('payment_verifying', 'payment_pending')
		OR bound_resolution.verification_status <> 'verified'
		OR bound_resolution.decision <> 'APPROVED'
		OR bound_chain.purpose <> 'refund'
		OR bound_chain.resource_id <> bound_attempt.id
		OR bound_chain.observed_state <> 'finalized'
		OR bound_chain.transaction_hash <> bound_attempt.transaction_hash
		OR bound_chain.network <> bound_attempt.network
		OR bound_chain.sender IS NULL
		OR (bound_attempt.recipient_rule <> 'claim-key-v2' AND bound_chain.sender <> bound_attempt.expected_sender)
		OR bound_chain.recipient <> bound_attempt.expected_recipient
		OR bound_chain.value_luna <> bound_attempt.expected_value_luna
		OR bound_chain.data_text <> bound_attempt.expected_data
		OR bound_chain.execution_result IS DISTINCT FROM TRUE THEN
		RAISE EXCEPTION 'refund transaction must match finalized attempt evidence';
	END IF;
	RETURN NEW;
END;
$$ LANGUAGE plpgsql;--> statement-breakpoint
CREATE OR REPLACE VIEW promise_ledger_v1
WITH (security_barrier = true)
AS
WITH verified_purchases AS (
	SELECT
		passports.merchant_id,
		count(DISTINCT purchases.id)::bigint AS verified_purchases
	FROM purchase_transactions purchases
	JOIN purchase_passports passports
		ON passports.purchase_transaction_id = purchases.id
	JOIN orders
		ON orders.id = purchases.order_id
	JOIN policy_versions policies
		ON policies.id = passports.policy_version_id
	JOIN chain_transactions chain
		ON chain.id = purchases.chain_transaction_id
	WHERE orders.payment_state = 'purchased'
		AND policies.verification_status = 'verified'
		AND chain.purpose = 'purchase'
		AND chain.observed_state = 'finalized'
		AND chain.execution_result = true
	GROUP BY passports.merchant_id
), accepted_claims AS (
	SELECT
		claims.id,
		claims.merchant_id,
		authorizations.verified_at AS accepted_at,
		eligibility.eligible
	FROM claims
	JOIN claim_authorizations authorizations
		ON authorizations.claim_id = claims.id
		AND authorizations.consumed_at IS NOT NULL
		AND authorizations.verified_at IS NOT NULL
	JOIN claim_eligibility_evaluations eligibility
		ON eligibility.claim_id = claims.id
		AND eligibility.supersedes_id IS NULL
	WHERE claims.signature_status = 'verified'
		AND claims.workflow_state IN ('eligible', 'ineligible', 'decision_pending', 'approved', 'rejected')
), verified_resolutions AS (
	SELECT
		resolutions.id,
		resolutions.claim_id,
		resolutions.merchant_id,
		resolutions.decision,
		resolutions.verified_at,
		accepted_claims.accepted_at
	FROM claim_resolutions resolutions
	JOIN accepted_claims
		ON accepted_claims.id = resolutions.claim_id
		AND accepted_claims.merchant_id = resolutions.merchant_id
	WHERE resolutions.verification_status = 'verified'
		AND resolutions.signer_address = resolutions.policy_signer_address
		AND resolutions.verified_at IS NOT NULL
), verified_refunds AS (
	SELECT
		refunds.id,
		resolutions.merchant_id,
		refunds.resolution_id
	FROM refund_transactions refunds
	JOIN verified_resolutions resolutions
		ON resolutions.id = refunds.resolution_id
		AND resolutions.claim_id = refunds.claim_id
	JOIN refund_attempts attempts
		ON attempts.id = refunds.attempt_id
		AND attempts.claim_id = refunds.claim_id
		AND attempts.resolution_id = refunds.resolution_id
		AND attempts.passport_id = refunds.passport_id
	JOIN chain_transactions chain
		ON chain.id = refunds.chain_transaction_id
	WHERE attempts.wallet_state = 'refunded'
		AND chain.purpose = 'refund'
		AND chain.observed_state = 'finalized'
		AND chain.execution_result = true
		AND chain.network = attempts.network
		AND (attempts.recipient_rule = 'claim-key-v2' OR chain.sender = attempts.expected_sender)
		AND chain.recipient = attempts.expected_recipient
		AND chain.value_luna = attempts.expected_value_luna
		AND chain.data_text = attempts.expected_data
), claim_rollup AS (
	SELECT
		claims.merchant_id,
		count(*)::bigint AS claims_filed,
		count(*) FILTER (WHERE claims.eligible)::bigint AS eligible_claims,
		count(*) FILTER (WHERE NOT claims.eligible)::bigint AS ineligible_claims,
		count(*) FILTER (WHERE resolutions.id IS NULL)::bigint AS unresolved_claims
	FROM accepted_claims claims
	LEFT JOIN verified_resolutions resolutions ON resolutions.claim_id = claims.id
	GROUP BY claims.merchant_id
), resolution_rollup AS (
	SELECT
		resolutions.merchant_id,
		count(*) FILTER (WHERE resolutions.decision = 'APPROVED')::bigint AS approved_claims,
		count(*) FILTER (WHERE resolutions.decision = 'REJECTED')::bigint AS rejected_claims,
		count(*) FILTER (
			WHERE resolutions.verified_at >= resolutions.accepted_at
		)::bigint AS resolution_time_sample_size,
		round(percentile_cont(0.5) WITHIN GROUP (
			ORDER BY extract(epoch FROM (
				date_trunc('milliseconds', resolutions.verified_at)
				- date_trunc('milliseconds', resolutions.accepted_at)
			)) * 1000
		) FILTER (
			WHERE resolutions.verified_at >= resolutions.accepted_at
		))::bigint AS median_resolution_ms
	FROM verified_resolutions resolutions
	GROUP BY resolutions.merchant_id
), refund_rollup AS (
	SELECT
		resolutions.merchant_id,
		count(refunds.id)::bigint AS verified_refunds
	FROM verified_resolutions resolutions
	JOIN verified_refunds refunds ON refunds.resolution_id = resolutions.id
	GROUP BY resolutions.merchant_id
)
SELECT
	merchants.id AS merchant_id,
	merchants.public_id AS merchant_public_id,
	merchants.display_name AS merchant_display_name,
	merchants.policy_signer_address,
	coalesce(verified_purchases.verified_purchases, 0)::bigint AS verified_purchases,
	coalesce(claim_rollup.claims_filed, 0)::bigint AS claims_filed,
	coalesce(claim_rollup.eligible_claims, 0)::bigint AS eligible_claims,
	coalesce(claim_rollup.ineligible_claims, 0)::bigint AS ineligible_claims,
	coalesce(resolution_rollup.approved_claims, 0)::bigint AS approved_claims,
	coalesce(resolution_rollup.rejected_claims, 0)::bigint AS rejected_claims,
	coalesce(claim_rollup.unresolved_claims, 0)::bigint AS unresolved_claims,
	(
		coalesce(resolution_rollup.approved_claims, 0)
		- coalesce(refund_rollup.verified_refunds, 0)
	)::bigint AS refund_pending,
	coalesce(refund_rollup.verified_refunds, 0)::bigint AS verified_refunds,
	resolution_rollup.median_resolution_ms,
	coalesce(resolution_rollup.resolution_time_sample_size, 0)::bigint AS resolution_time_sample_size
FROM merchants
LEFT JOIN verified_purchases ON verified_purchases.merchant_id = merchants.id
LEFT JOIN claim_rollup ON claim_rollup.merchant_id = merchants.id
LEFT JOIN resolution_rollup ON resolution_rollup.merchant_id = merchants.id
LEFT JOIN refund_rollup ON refund_rollup.merchant_id = merchants.id
WHERE merchants.status = 'active';
--> statement-breakpoint
GRANT UPDATE (outcome_reference_height, outcome_ruled_out_at, outcome_ruled_out_height)
	ON TABLE refund_attempts TO nimreturn_runtime;
