CREATE VIEW promise_ledger_reconciliation_v1
WITH (security_barrier = true)
AS
WITH merchant_chain_transactions AS (
	SELECT
		passports.merchant_id,
		chain.id AS chain_transaction_id
	FROM purchase_transactions purchases
	JOIN purchase_passports passports ON passports.purchase_transaction_id = purchases.id
	JOIN chain_transactions chain
		ON chain.id = purchases.chain_transaction_id
		AND chain.purpose = 'purchase'
		AND chain.observed_state = 'finalized'
		AND chain.execution_result = true
	UNION ALL
	SELECT
		passports.merchant_id,
		chain.id AS chain_transaction_id
	FROM refund_transactions refunds
	JOIN purchase_passports passports ON passports.id = refunds.passport_id
	JOIN chain_transactions chain
		ON chain.id = refunds.chain_transaction_id
		AND chain.purpose = 'refund'
		AND chain.observed_state = 'finalized'
		AND chain.execution_result = true
), latest_reconciliations AS (
	SELECT DISTINCT ON (reconciliations.chain_transaction_id)
		reconciliations.chain_transaction_id,
		reconciliations.outcome
	FROM chain_reconciliations reconciliations
	ORDER BY
		reconciliations.chain_transaction_id,
		reconciliations.checked_at DESC,
		reconciliations.id DESC
)
SELECT
	merchant_chain_transactions.merchant_id,
	count(DISTINCT merchant_chain_transactions.chain_transaction_id) FILTER (
		WHERE latest_reconciliations.outcome = 'exception'
	)::bigint AS evidence_exceptions
FROM merchant_chain_transactions
JOIN latest_reconciliations
	ON latest_reconciliations.chain_transaction_id = merchant_chain_transactions.chain_transaction_id
GROUP BY merchant_chain_transactions.merchant_id;
--> statement-breakpoint
REVOKE ALL ON TABLE promise_ledger_reconciliation_v1 FROM PUBLIC;
--> statement-breakpoint
REVOKE ALL ON TABLE promise_ledger_reconciliation_v1 FROM nimreturn_runtime;
--> statement-breakpoint
GRANT SELECT ON TABLE promise_ledger_reconciliation_v1 TO nimreturn_runtime;
