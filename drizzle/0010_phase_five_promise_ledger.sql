CREATE VIEW promise_ledger_v1
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
		AND chain.sender = attempts.expected_sender
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
REVOKE ALL ON TABLE promise_ledger_v1 FROM PUBLIC;
--> statement-breakpoint
REVOKE ALL ON TABLE promise_ledger_v1 FROM nimreturn_runtime;
--> statement-breakpoint
GRANT SELECT ON TABLE promise_ledger_v1 TO nimreturn_runtime;
