CREATE TYPE "public"."refund_attempt_state" AS ENUM('payment_requested', 'wallet_request_started', 'payment_cancelled', 'submission_outcome_unknown', 'payment_verifying', 'payment_pending', 'payment_failed', 'refunded');--> statement-breakpoint
CREATE TABLE "refund_attempts" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"public_id" char(22) NOT NULL,
	"claim_id" uuid NOT NULL,
	"claim_public_id" char(22) NOT NULL,
	"resolution_id" uuid NOT NULL,
	"passport_id" uuid NOT NULL,
	"merchant_id" uuid NOT NULL,
	"network" varchar(24) NOT NULL,
	"expected_sender" varchar(36) NOT NULL,
	"expected_recipient" varchar(36) NOT NULL,
	"expected_value_luna" bigint NOT NULL,
	"expected_data" varchar(64) NOT NULL,
	"wallet_state" "refund_attempt_state" DEFAULT 'payment_requested' NOT NULL,
	"transaction_hash" char(64),
	"failure_code" varchar(50),
	"row_version" integer DEFAULT 1 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "refund_attempts_public_id_unique" UNIQUE("public_id"),
	CONSTRAINT "refund_attempts_id_claim_unique" UNIQUE("id","claim_id"),
	CONSTRAINT "refund_attempts_id_resolution_unique" UNIQUE("id","resolution_id"),
	CONSTRAINT "refund_attempts_id_passport_unique" UNIQUE("id","passport_id"),
	CONSTRAINT "refund_attempts_public_id_format" CHECK ("refund_attempts"."public_id" ~ '^[A-Za-z0-9_-]{22}$'),
	CONSTRAINT "refund_attempts_claim_public_id_format" CHECK ("refund_attempts"."claim_public_id" ~ '^[A-Za-z0-9_-]{22}$'),
	CONSTRAINT "refund_attempts_network_not_blank" CHECK (btrim("refund_attempts"."network") <> ''),
	CONSTRAINT "refund_attempts_address_format" CHECK ("refund_attempts"."expected_sender" ~ '^NQ[0-9A-HJ-NP-VXY]{34}$' and "refund_attempts"."expected_recipient" ~ '^NQ[0-9A-HJ-NP-VXY]{34}$'),
	CONSTRAINT "refund_attempts_value_range" CHECK ("refund_attempts"."expected_value_luna" > 0 and "refund_attempts"."expected_value_luna" <= 9007199254740991),
	CONSTRAINT "refund_attempts_data_binding" CHECK ("refund_attempts"."expected_data" = 'NR1:R:' || "refund_attempts"."claim_public_id"),
	CONSTRAINT "refund_attempts_hash_state" CHECK (("refund_attempts"."transaction_hash" is null and "refund_attempts"."wallet_state" in ('payment_requested', 'wallet_request_started', 'payment_cancelled', 'submission_outcome_unknown')) or ("refund_attempts"."transaction_hash" is not null and "refund_attempts"."wallet_state" in ('payment_verifying', 'payment_pending', 'payment_failed', 'refunded'))),
	CONSTRAINT "refund_attempts_hash_format" CHECK ("refund_attempts"."transaction_hash" is null or "refund_attempts"."transaction_hash" ~ '^[0-9a-f]{64}$'),
	CONSTRAINT "refund_attempts_failure_state" CHECK (("refund_attempts"."wallet_state" = 'payment_failed' and "refund_attempts"."failure_code" is not null) or ("refund_attempts"."wallet_state" <> 'payment_failed' and "refund_attempts"."failure_code" is null)),
	CONSTRAINT "refund_attempts_row_version_positive" CHECK ("refund_attempts"."row_version" > 0)
);
--> statement-breakpoint
CREATE TABLE "refund_transactions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"attempt_id" uuid NOT NULL,
	"claim_id" uuid NOT NULL,
	"resolution_id" uuid NOT NULL,
	"passport_id" uuid NOT NULL,
	"chain_transaction_id" uuid NOT NULL,
	"verified_at" timestamp with time zone NOT NULL,
	"confirmation_policy" varchar(40) NOT NULL,
	CONSTRAINT "refund_transactions_attempt_unique" UNIQUE("attempt_id"),
	CONSTRAINT "refund_transactions_claim_unique" UNIQUE("claim_id"),
	CONSTRAINT "refund_transactions_resolution_unique" UNIQUE("resolution_id"),
	CONSTRAINT "refund_transactions_passport_unique" UNIQUE("passport_id"),
	CONSTRAINT "refund_transactions_chain_unique" UNIQUE("chain_transaction_id"),
	CONSTRAINT "refund_transactions_confirmation_policy" CHECK ("refund_transactions"."confirmation_policy" = 'albatross-next-macro-v1')
);
--> statement-breakpoint
ALTER TABLE "claim_resolutions" ADD CONSTRAINT "claim_resolutions_id_claim_unique" UNIQUE("id","claim_id");--> statement-breakpoint
ALTER TABLE "claim_resolutions" ADD CONSTRAINT "claim_resolutions_id_merchant_unique" UNIQUE("id","merchant_id");--> statement-breakpoint
ALTER TABLE "refund_attempts" ADD CONSTRAINT "refund_attempts_claim_passport_fk" FOREIGN KEY ("claim_id","passport_id") REFERENCES "public"."claims"("id","passport_id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "refund_attempts" ADD CONSTRAINT "refund_attempts_resolution_claim_fk" FOREIGN KEY ("resolution_id","claim_id") REFERENCES "public"."claim_resolutions"("id","claim_id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "refund_attempts" ADD CONSTRAINT "refund_attempts_resolution_merchant_fk" FOREIGN KEY ("resolution_id","merchant_id") REFERENCES "public"."claim_resolutions"("id","merchant_id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "refund_attempts" ADD CONSTRAINT "refund_attempts_passport_merchant_fk" FOREIGN KEY ("passport_id","merchant_id") REFERENCES "public"."purchase_passports"("id","merchant_id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "refund_transactions" ADD CONSTRAINT "refund_transactions_chain_transaction_id_chain_transactions_id_fk" FOREIGN KEY ("chain_transaction_id") REFERENCES "public"."chain_transactions"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "refund_transactions" ADD CONSTRAINT "refund_transactions_attempt_claim_fk" FOREIGN KEY ("attempt_id","claim_id") REFERENCES "public"."refund_attempts"("id","claim_id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "refund_transactions" ADD CONSTRAINT "refund_transactions_attempt_resolution_fk" FOREIGN KEY ("attempt_id","resolution_id") REFERENCES "public"."refund_attempts"("id","resolution_id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "refund_transactions" ADD CONSTRAINT "refund_transactions_attempt_passport_fk" FOREIGN KEY ("attempt_id","passport_id") REFERENCES "public"."refund_attempts"("id","passport_id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "refund_attempts_one_open_per_claim" ON "refund_attempts" USING btree ("claim_id") WHERE "refund_attempts"."wallet_state" in ('payment_requested', 'wallet_request_started', 'submission_outcome_unknown', 'payment_verifying', 'payment_pending');--> statement-breakpoint
CREATE INDEX "refund_attempts_claim_created_index" ON "refund_attempts" USING btree ("claim_id","created_at");--> statement-breakpoint
CREATE INDEX "refund_attempts_state_updated_index" ON "refund_attempts" USING btree ("wallet_state","updated_at");--> statement-breakpoint
CREATE FUNCTION protect_refund_attempt() RETURNS trigger AS $$
DECLARE
	bound_claim claims%ROWTYPE;
	bound_resolution claim_resolutions%ROWTYPE;
	bound_passport purchase_passports%ROWTYPE;
	bound_order orders%ROWTYPE;
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
		OR NEW.expected_recipient <> bound_passport.original_buyer_address
		OR NEW.expected_value_luna <> bound_resolution.approved_refund_luna
		OR NEW.expected_value_luna <> bound_passport.price_luna
		OR NEW.expected_data <> 'NR1:R:' || bound_claim.public_id THEN
		RAISE EXCEPTION 'refund attempt does not match verified approval and purchase evidence';
	END IF;

	IF TG_OP = 'INSERT' THEN
		IF NEW.wallet_state <> 'payment_requested' OR NEW.transaction_hash IS NOT NULL
			OR NEW.failure_code IS NOT NULL OR NEW.row_version <> 1 THEN
			RAISE EXCEPTION 'new refund attempt must begin unsubmitted';
		END IF;
		RETURN NEW;
	END IF;

	IF ROW(
		NEW.public_id, NEW.claim_id, NEW.claim_public_id, NEW.resolution_id,
		NEW.passport_id, NEW.merchant_id, NEW.network, NEW.expected_sender,
		NEW.expected_recipient, NEW.expected_value_luna, NEW.expected_data, NEW.created_at
	) IS DISTINCT FROM ROW(
		OLD.public_id, OLD.claim_id, OLD.claim_public_id, OLD.resolution_id,
		OLD.passport_id, OLD.merchant_id, OLD.network, OLD.expected_sender,
		OLD.expected_recipient, OLD.expected_value_luna, OLD.expected_data, OLD.created_at
	) THEN
		RAISE EXCEPTION 'refund attempt expectation is immutable';
	END IF;
	IF OLD.transaction_hash IS NOT NULL AND NEW.transaction_hash IS DISTINCT FROM OLD.transaction_hash THEN
		RAISE EXCEPTION 'refund attempt hash is immutable once attached';
	END IF;
	IF NOT (
		(OLD.wallet_state = 'payment_requested' AND NEW.wallet_state IN ('wallet_request_started', 'payment_cancelled'))
		OR (OLD.wallet_state = 'wallet_request_started' AND NEW.wallet_state IN ('payment_cancelled', 'submission_outcome_unknown', 'payment_verifying'))
		OR (OLD.wallet_state = 'submission_outcome_unknown' AND NEW.wallet_state = 'payment_verifying')
		OR (OLD.wallet_state = 'payment_verifying' AND NEW.wallet_state IN ('payment_pending', 'payment_failed', 'refunded'))
		OR (OLD.wallet_state = 'payment_pending' AND NEW.wallet_state IN ('payment_verifying', 'payment_failed', 'refunded'))
	) THEN
		RAISE EXCEPTION 'illegal refund attempt transition from % to %', OLD.wallet_state, NEW.wallet_state;
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
CREATE TRIGGER refund_attempts_lifecycle_guard
	BEFORE INSERT OR UPDATE OR DELETE ON refund_attempts
	FOR EACH ROW EXECUTE FUNCTION protect_refund_attempt();--> statement-breakpoint
CREATE FUNCTION validate_refund_transaction() RETURNS trigger AS $$
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
		OR bound_chain.sender <> bound_attempt.expected_sender
		OR bound_chain.recipient <> bound_attempt.expected_recipient
		OR bound_chain.value_luna <> bound_attempt.expected_value_luna
		OR bound_chain.data_text <> bound_attempt.expected_data
		OR bound_chain.execution_result IS DISTINCT FROM TRUE THEN
		RAISE EXCEPTION 'refund transaction must match finalized attempt evidence';
	END IF;
	RETURN NEW;
END;
$$ LANGUAGE plpgsql;--> statement-breakpoint
CREATE TRIGGER refund_transactions_immutable_guard
	BEFORE INSERT OR UPDATE OR DELETE ON refund_transactions
	FOR EACH ROW EXECUTE FUNCTION validate_refund_transaction();--> statement-breakpoint
CREATE OR REPLACE FUNCTION validate_purchase_passport() RETURNS trigger AS $$
DECLARE
	bound_order orders%ROWTYPE;
	bound_purchase purchase_transactions%ROWTYPE;
	bound_chain chain_transactions%ROWTYPE;
	bound_policy policy_versions%ROWTYPE;
	expected_return_deadline timestamptz;
	expected_warranty_deadline timestamptz;
BEGIN
	IF TG_OP = 'DELETE' THEN
		RAISE EXCEPTION 'purchase passport evidence is immutable';
	END IF;
	IF TG_OP = 'UPDATE' THEN
		IF ROW(
			NEW.public_id, NEW.order_id, NEW.purchase_transaction_id, NEW.policy_version_id,
			NEW.product_id, NEW.merchant_id, NEW.original_buyer_address, NEW.product_name,
			NEW.product_description, NEW.merchant_display_name, NEW.policy_payload_hash,
			NEW.policy_version, NEW.protocol_version, NEW.price_luna, NEW.settlement_recipient,
			NEW.purchase_time, NEW.return_deadline, NEW.warranty_deadline, NEW.created_at
		) IS DISTINCT FROM ROW(
			OLD.public_id, OLD.order_id, OLD.purchase_transaction_id, OLD.policy_version_id,
			OLD.product_id, OLD.merchant_id, OLD.original_buyer_address, OLD.product_name,
			OLD.product_description, OLD.merchant_display_name, OLD.policy_payload_hash,
			OLD.policy_version, OLD.protocol_version, OLD.price_luna, OLD.settlement_recipient,
			OLD.purchase_time, OLD.return_deadline, OLD.warranty_deadline, OLD.created_at
		) OR OLD.status <> 'active' OR NEW.status <> 'refunded'
			OR NOT EXISTS (SELECT 1 FROM refund_transactions WHERE passport_id = NEW.id) THEN
			RAISE EXCEPTION 'passport refund transition requires verified refund evidence';
		END IF;
		NEW.updated_at := clock_timestamp();
		RETURN NEW;
	END IF;

	SELECT * INTO bound_order FROM orders WHERE id = NEW.order_id;
	SELECT * INTO bound_purchase FROM purchase_transactions WHERE id = NEW.purchase_transaction_id;
	SELECT * INTO bound_chain FROM chain_transactions WHERE id = bound_purchase.chain_transaction_id;
	SELECT * INTO bound_policy FROM policy_versions WHERE id = NEW.policy_version_id;
	IF bound_order.payment_state <> 'purchased'
		OR bound_purchase.order_id <> bound_order.id
		OR bound_chain.observed_state <> 'finalized'
		OR bound_chain.sender IS DISTINCT FROM bound_order.buyer_address
		OR NEW.original_buyer_address IS DISTINCT FROM bound_order.buyer_address
		OR NEW.product_id <> bound_order.product_id OR NEW.merchant_id <> bound_order.merchant_id
		OR NEW.policy_version_id <> bound_order.policy_version_id
		OR NEW.product_name <> bound_order.product_name
		OR NEW.product_description <> bound_order.product_description
		OR NEW.merchant_display_name <> bound_order.merchant_display_name
		OR NEW.policy_payload_hash <> bound_order.policy_payload_hash
		OR NEW.policy_version <> bound_order.policy_version
		OR NEW.protocol_version <> bound_order.protocol_version
		OR NEW.price_luna <> bound_order.expected_value_luna
		OR NEW.settlement_recipient <> bound_order.expected_recipient
		OR NEW.purchase_time <> to_timestamp(bound_chain.block_timestamp_ms / 1000.0)
		OR NEW.status <> 'active' THEN
		RAISE EXCEPTION 'purchase passport does not match immutable order and chain evidence';
	END IF;
	expected_return_deadline := CASE WHEN bound_policy.return_window_seconds = 0 THEN NULL ELSE NEW.purchase_time + make_interval(secs => bound_policy.return_window_seconds::double precision) END;
	expected_warranty_deadline := CASE WHEN bound_policy.warranty_window_seconds = 0 THEN NULL ELSE NEW.purchase_time + make_interval(secs => bound_policy.warranty_window_seconds::double precision) END;
	IF NEW.return_deadline IS DISTINCT FROM expected_return_deadline OR NEW.warranty_deadline IS DISTINCT FROM expected_warranty_deadline THEN
		RAISE EXCEPTION 'purchase passport deadlines do not match purchase-bound policy';
	END IF;
	RETURN NEW;
END;
$$ LANGUAGE plpgsql;--> statement-breakpoint
GRANT SELECT, INSERT ON TABLE refund_attempts TO nimreturn_runtime;--> statement-breakpoint
GRANT UPDATE (wallet_state, transaction_hash, failure_code) ON TABLE refund_attempts TO nimreturn_runtime;--> statement-breakpoint
GRANT SELECT, INSERT ON TABLE refund_transactions TO nimreturn_runtime;--> statement-breakpoint
GRANT UPDATE (status) ON TABLE purchase_passports TO nimreturn_runtime;
