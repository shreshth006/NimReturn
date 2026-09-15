CREATE TYPE "public"."chain_observed_state" AS ENUM('absent', 'mempool', 'included', 'finalized', 'invalid', 'inconclusive');--> statement-breakpoint
CREATE TYPE "public"."chain_transaction_purpose" AS ENUM('purchase', 'refund');--> statement-breakpoint
CREATE TYPE "public"."order_payment_state" AS ENUM('payment_requested', 'wallet_request_started', 'payment_cancelled', 'submission_outcome_unknown', 'payment_verifying', 'payment_pending', 'payment_failed', 'expired', 'purchased');--> statement-breakpoint
CREATE TYPE "public"."passport_status" AS ENUM('active', 'refunded');--> statement-breakpoint
CREATE TABLE "chain_transactions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"network" varchar(24) NOT NULL,
	"transaction_hash" char(64) NOT NULL,
	"purpose" "chain_transaction_purpose" NOT NULL,
	"resource_id" uuid NOT NULL,
	"observed_state" "chain_observed_state" DEFAULT 'inconclusive' NOT NULL,
	"normalized_evidence" jsonb,
	"provider_id" varchar(80) NOT NULL,
	"observed_at" timestamp with time zone NOT NULL,
	"block_number" bigint,
	"block_timestamp_ms" bigint,
	"finalizing_block_number" bigint,
	"head_block_number" bigint,
	"confirmations" bigint,
	"execution_result" boolean,
	"sender" varchar(36),
	"recipient" varchar(36),
	"value_luna" bigint,
	"data_text" varchar(64),
	"verification_checks" jsonb,
	"verification_reason" varchar(500) NOT NULL,
	"verifier_version" varchar(40) NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "chain_transactions_network_hash_unique" UNIQUE("network","transaction_hash"),
	CONSTRAINT "chain_transactions_purpose_resource_unique" UNIQUE("purpose","resource_id"),
	CONSTRAINT "chain_transactions_hash_format" CHECK ("chain_transactions"."transaction_hash" ~ '^[0-9a-f]{64}$'),
	CONSTRAINT "chain_transactions_network_not_blank" CHECK (btrim("chain_transactions"."network") <> ''),
	CONSTRAINT "chain_transactions_provider_not_blank" CHECK (btrim("chain_transactions"."provider_id") <> ''),
	CONSTRAINT "chain_transactions_reason_not_blank" CHECK (btrim("chain_transactions"."verification_reason") <> ''),
	CONSTRAINT "chain_transactions_sender_format" CHECK ("chain_transactions"."sender" is null or "chain_transactions"."sender" ~ '^NQ[0-9A-HJ-NP-VXY]{34}$'),
	CONSTRAINT "chain_transactions_recipient_format" CHECK ("chain_transactions"."recipient" is null or "chain_transactions"."recipient" ~ '^NQ[0-9A-HJ-NP-VXY]{34}$'),
	CONSTRAINT "chain_transactions_value_range" CHECK ("chain_transactions"."value_luna" is null or ("chain_transactions"."value_luna" >= 0 and "chain_transactions"."value_luna" <= 9007199254740991)),
	CONSTRAINT "chain_transactions_block_ranges" CHECK (("chain_transactions"."block_number" is null or "chain_transactions"."block_number" >= 0) and ("chain_transactions"."block_timestamp_ms" is null or ("chain_transactions"."block_timestamp_ms" >= 0 and "chain_transactions"."block_timestamp_ms" <= 9007199254740991)) and ("chain_transactions"."finalizing_block_number" is null or "chain_transactions"."finalizing_block_number" >= 0) and ("chain_transactions"."head_block_number" is null or "chain_transactions"."head_block_number" >= 0) and ("chain_transactions"."confirmations" is null or "chain_transactions"."confirmations" >= 0)),
	CONSTRAINT "chain_transactions_normalized_evidence_object" CHECK ("chain_transactions"."normalized_evidence" is null or jsonb_typeof("chain_transactions"."normalized_evidence") = 'object'),
	CONSTRAINT "chain_transactions_verification_checks_object" CHECK ("chain_transactions"."verification_checks" is null or jsonb_typeof("chain_transactions"."verification_checks") = 'object')
);
--> statement-breakpoint
CREATE TABLE "orders" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"public_id" char(22) NOT NULL,
	"product_id" uuid NOT NULL,
	"policy_version_id" uuid NOT NULL,
	"merchant_id" uuid NOT NULL,
	"product_name" varchar(100) NOT NULL,
	"product_description" varchar(500) DEFAULT '' NOT NULL,
	"merchant_display_name" varchar(80) NOT NULL,
	"policy_payload_hash" char(64) NOT NULL,
	"policy_version" integer NOT NULL,
	"protocol_version" varchar(8) NOT NULL,
	"expected_recipient" varchar(36) NOT NULL,
	"expected_value_luna" bigint NOT NULL,
	"expected_data" varchar(64) NOT NULL,
	"network" varchar(24) NOT NULL,
	"buyer_address" varchar(36),
	"payment_state" "order_payment_state" DEFAULT 'payment_requested' NOT NULL,
	"failure_code" varchar(50),
	"expires_at" timestamp with time zone NOT NULL,
	"row_version" integer DEFAULT 1 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "orders_public_id_unique" UNIQUE("public_id"),
	CONSTRAINT "orders_id_product_unique" UNIQUE("id","product_id"),
	CONSTRAINT "orders_id_policy_unique" UNIQUE("id","policy_version_id"),
	CONSTRAINT "orders_id_merchant_unique" UNIQUE("id","merchant_id"),
	CONSTRAINT "orders_public_id_format" CHECK ("orders"."public_id" ~ '^[A-Za-z0-9_-]{22}$'),
	CONSTRAINT "orders_policy_payload_hash_format" CHECK ("orders"."policy_payload_hash" ~ '^[0-9a-f]{64}$'),
	CONSTRAINT "orders_policy_version_positive" CHECK ("orders"."policy_version" > 0),
	CONSTRAINT "orders_protocol" CHECK ("orders"."protocol_version" = 'NR1'),
	CONSTRAINT "orders_expected_recipient_format" CHECK ("orders"."expected_recipient" ~ '^NQ[0-9A-HJ-NP-VXY]{34}$'),
	CONSTRAINT "orders_buyer_address_format" CHECK ("orders"."buyer_address" is null or "orders"."buyer_address" ~ '^NQ[0-9A-HJ-NP-VXY]{34}$'),
	CONSTRAINT "orders_expected_value_range" CHECK ("orders"."expected_value_luna" > 0 and "orders"."expected_value_luna" <= 9007199254740991),
	CONSTRAINT "orders_expected_data_binding" CHECK ("orders"."expected_data" = 'NR1:P:' || "orders"."public_id"),
	CONSTRAINT "orders_valid_expiry" CHECK ("orders"."expires_at" > "orders"."created_at"),
	CONSTRAINT "orders_row_version_positive" CHECK ("orders"."row_version" > 0),
	CONSTRAINT "orders_buyer_only_when_purchased" CHECK (("orders"."payment_state" = 'purchased' and "orders"."buyer_address" is not null) or ("orders"."payment_state" <> 'purchased' and "orders"."buyer_address" is null)),
	CONSTRAINT "orders_failure_code_state" CHECK (("orders"."payment_state" = 'payment_failed' and "orders"."failure_code" is not null) or ("orders"."payment_state" <> 'payment_failed' and "orders"."failure_code" is null))
);
--> statement-breakpoint
CREATE TABLE "purchase_passports" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"public_id" char(22) NOT NULL,
	"order_id" uuid NOT NULL,
	"purchase_transaction_id" uuid NOT NULL,
	"policy_version_id" uuid NOT NULL,
	"product_id" uuid NOT NULL,
	"merchant_id" uuid NOT NULL,
	"original_buyer_address" varchar(36) NOT NULL,
	"product_name" varchar(100) NOT NULL,
	"product_description" varchar(500) DEFAULT '' NOT NULL,
	"merchant_display_name" varchar(80) NOT NULL,
	"policy_payload_hash" char(64) NOT NULL,
	"policy_version" integer NOT NULL,
	"protocol_version" varchar(8) NOT NULL,
	"price_luna" bigint NOT NULL,
	"settlement_recipient" varchar(36) NOT NULL,
	"purchase_time" timestamp with time zone NOT NULL,
	"return_deadline" timestamp with time zone,
	"warranty_deadline" timestamp with time zone,
	"status" "passport_status" DEFAULT 'active' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "purchase_passports_public_id_unique" UNIQUE("public_id"),
	CONSTRAINT "purchase_passports_order_unique" UNIQUE("order_id"),
	CONSTRAINT "purchase_passports_purchase_transaction_unique" UNIQUE("purchase_transaction_id"),
	CONSTRAINT "purchase_passports_public_id_format" CHECK ("purchase_passports"."public_id" ~ '^[A-Za-z0-9_-]{22}$'),
	CONSTRAINT "purchase_passports_buyer_address_format" CHECK ("purchase_passports"."original_buyer_address" ~ '^NQ[0-9A-HJ-NP-VXY]{34}$'),
	CONSTRAINT "purchase_passports_settlement_address_format" CHECK ("purchase_passports"."settlement_recipient" ~ '^NQ[0-9A-HJ-NP-VXY]{34}$'),
	CONSTRAINT "purchase_passports_policy_hash_format" CHECK ("purchase_passports"."policy_payload_hash" ~ '^[0-9a-f]{64}$'),
	CONSTRAINT "purchase_passports_policy_version_positive" CHECK ("purchase_passports"."policy_version" > 0),
	CONSTRAINT "purchase_passports_protocol" CHECK ("purchase_passports"."protocol_version" = 'NR1'),
	CONSTRAINT "purchase_passports_price_range" CHECK ("purchase_passports"."price_luna" > 0 and "purchase_passports"."price_luna" <= 9007199254740991),
	CONSTRAINT "purchase_passports_deadline_order" CHECK (("purchase_passports"."return_deadline" is null or "purchase_passports"."return_deadline" >= "purchase_passports"."purchase_time") and ("purchase_passports"."warranty_deadline" is null or "purchase_passports"."warranty_deadline" >= "purchase_passports"."purchase_time"))
);
--> statement-breakpoint
CREATE TABLE "purchase_transactions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"order_id" uuid NOT NULL,
	"chain_transaction_id" uuid NOT NULL,
	"verified_at" timestamp with time zone NOT NULL,
	"confirmation_policy" varchar(40) NOT NULL,
	CONSTRAINT "purchase_transactions_order_unique" UNIQUE("order_id"),
	CONSTRAINT "purchase_transactions_chain_unique" UNIQUE("chain_transaction_id"),
	CONSTRAINT "purchase_transactions_confirmation_policy" CHECK ("purchase_transactions"."confirmation_policy" = 'albatross-next-macro-v1')
);
--> statement-breakpoint
ALTER TABLE "orders" ADD CONSTRAINT "orders_product_merchant_fk" FOREIGN KEY ("product_id","merchant_id") REFERENCES "public"."products"("id","merchant_id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "orders" ADD CONSTRAINT "orders_policy_product_fk" FOREIGN KEY ("policy_version_id","product_id") REFERENCES "public"."policy_versions"("id","product_id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "orders" ADD CONSTRAINT "orders_policy_merchant_fk" FOREIGN KEY ("policy_version_id","merchant_id") REFERENCES "public"."policy_versions"("id","merchant_id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "purchase_passports" ADD CONSTRAINT "purchase_passports_order_id_orders_id_fk" FOREIGN KEY ("order_id") REFERENCES "public"."orders"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "purchase_passports" ADD CONSTRAINT "purchase_passports_purchase_transaction_id_purchase_transactions_id_fk" FOREIGN KEY ("purchase_transaction_id") REFERENCES "public"."purchase_transactions"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "purchase_passports" ADD CONSTRAINT "purchase_passports_policy_version_id_policy_versions_id_fk" FOREIGN KEY ("policy_version_id") REFERENCES "public"."policy_versions"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "purchase_passports" ADD CONSTRAINT "purchase_passports_product_id_products_id_fk" FOREIGN KEY ("product_id") REFERENCES "public"."products"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "purchase_passports" ADD CONSTRAINT "purchase_passports_merchant_id_merchants_id_fk" FOREIGN KEY ("merchant_id") REFERENCES "public"."merchants"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "purchase_passports" ADD CONSTRAINT "purchase_passports_order_product_fk" FOREIGN KEY ("order_id","product_id") REFERENCES "public"."orders"("id","product_id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "purchase_passports" ADD CONSTRAINT "purchase_passports_order_policy_fk" FOREIGN KEY ("order_id","policy_version_id") REFERENCES "public"."orders"("id","policy_version_id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "purchase_passports" ADD CONSTRAINT "purchase_passports_order_merchant_fk" FOREIGN KEY ("order_id","merchant_id") REFERENCES "public"."orders"("id","merchant_id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "purchase_transactions" ADD CONSTRAINT "purchase_transactions_order_id_orders_id_fk" FOREIGN KEY ("order_id") REFERENCES "public"."orders"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "purchase_transactions" ADD CONSTRAINT "purchase_transactions_chain_transaction_id_chain_transactions_id_fk" FOREIGN KEY ("chain_transaction_id") REFERENCES "public"."chain_transactions"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "chain_transactions_state_updated_index" ON "chain_transactions" USING btree ("observed_state","updated_at");--> statement-breakpoint
CREATE INDEX "orders_merchant_state_created_index" ON "orders" USING btree ("merchant_id","payment_state","created_at");--> statement-breakpoint
CREATE INDEX "orders_state_updated_index" ON "orders" USING btree ("payment_state","updated_at");--> statement-breakpoint
CREATE INDEX "orders_buyer_created_index" ON "orders" USING btree ("buyer_address","created_at");--> statement-breakpoint
CREATE INDEX "purchase_passports_buyer_created_index" ON "purchase_passports" USING btree ("original_buyer_address","created_at");--> statement-breakpoint
CREATE INDEX "purchase_passports_merchant_created_index" ON "purchase_passports" USING btree ("merchant_id","created_at");--> statement-breakpoint
CREATE FUNCTION protect_order_lifecycle() RETURNS trigger AS $$
BEGIN
	IF TG_OP = 'INSERT' THEN
		IF NEW.payment_state <> 'payment_requested'
			OR NEW.buyer_address IS NOT NULL
			OR NEW.failure_code IS NOT NULL
			OR NEW.row_version <> 1 THEN
			RAISE EXCEPTION 'new order must begin as an unbound payment request';
		END IF;
		RETURN NEW;
	END IF;

	IF TG_OP = 'DELETE' THEN
		RAISE EXCEPTION 'orders are retained for purchase evidence';
	END IF;

	IF ROW(
		NEW.public_id, NEW.product_id, NEW.policy_version_id, NEW.merchant_id,
		NEW.product_name, NEW.product_description, NEW.merchant_display_name,
		NEW.policy_payload_hash, NEW.policy_version, NEW.protocol_version,
		NEW.expected_recipient, NEW.expected_value_luna, NEW.expected_data,
		NEW.network, NEW.expires_at, NEW.created_at
	) IS DISTINCT FROM ROW(
		OLD.public_id, OLD.product_id, OLD.policy_version_id, OLD.merchant_id,
		OLD.product_name, OLD.product_description, OLD.merchant_display_name,
		OLD.policy_payload_hash, OLD.policy_version, OLD.protocol_version,
		OLD.expected_recipient, OLD.expected_value_luna, OLD.expected_data,
		OLD.network, OLD.expires_at, OLD.created_at
	) THEN
		RAISE EXCEPTION 'order payment expectations are immutable';
	END IF;

	IF OLD.payment_state = 'purchased' OR OLD.payment_state = 'payment_failed' OR OLD.payment_state = 'expired' THEN
		RAISE EXCEPTION 'terminal order is immutable';
	END IF;

	IF NOT (
		(OLD.payment_state = 'payment_requested' AND NEW.payment_state IN ('wallet_request_started', 'payment_cancelled', 'submission_outcome_unknown', 'payment_verifying', 'expired'))
		OR (OLD.payment_state = 'wallet_request_started' AND NEW.payment_state IN ('payment_cancelled', 'submission_outcome_unknown', 'payment_verifying', 'expired'))
		OR (OLD.payment_state = 'payment_cancelled' AND NEW.payment_state IN ('wallet_request_started', 'expired'))
		OR (OLD.payment_state = 'submission_outcome_unknown' AND NEW.payment_state = 'payment_verifying')
		OR (OLD.payment_state = 'payment_verifying' AND NEW.payment_state IN ('payment_pending', 'payment_failed', 'purchased'))
		OR (OLD.payment_state = 'payment_pending' AND NEW.payment_state IN ('payment_verifying', 'payment_failed', 'purchased'))
	) THEN
		RAISE EXCEPTION 'illegal order payment transition from % to %', OLD.payment_state, NEW.payment_state;
	END IF;

	IF NEW.payment_state = 'purchased' AND NEW.buyer_address IS NULL THEN
		RAISE EXCEPTION 'purchased order requires chain-derived buyer';
	END IF;
	IF NEW.payment_state <> 'purchased' AND NEW.buyer_address IS NOT NULL THEN
		RAISE EXCEPTION 'buyer can be assigned only when order is purchased';
	END IF;

	NEW.row_version := OLD.row_version + 1;
	NEW.updated_at := clock_timestamp();
	RETURN NEW;
END;
$$ LANGUAGE plpgsql;--> statement-breakpoint
CREATE TRIGGER orders_lifecycle_guard
	BEFORE INSERT OR UPDATE OR DELETE ON orders
	FOR EACH ROW EXECUTE FUNCTION protect_order_lifecycle();--> statement-breakpoint
CREATE FUNCTION protect_chain_transaction() RETURNS trigger AS $$
BEGIN
	IF TG_OP = 'DELETE' THEN
		RAISE EXCEPTION 'chain transaction evidence is immutable';
	END IF;

	IF TG_OP = 'UPDATE' THEN
		IF OLD.observed_state IN ('finalized', 'invalid') THEN
			RAISE EXCEPTION 'terminal chain transaction evidence is immutable';
		END IF;
		IF ROW(NEW.network, NEW.transaction_hash, NEW.purpose, NEW.resource_id, NEW.provider_id, NEW.created_at)
			IS DISTINCT FROM ROW(OLD.network, OLD.transaction_hash, OLD.purpose, OLD.resource_id, OLD.provider_id, OLD.created_at) THEN
			RAISE EXCEPTION 'chain transaction binding is immutable';
		END IF;
		NEW.updated_at := clock_timestamp();
	END IF;

	IF NEW.observed_state = 'finalized' AND (
		NEW.normalized_evidence IS NULL
		OR NEW.verification_checks IS NULL
		OR NEW.execution_result IS DISTINCT FROM TRUE
		OR NEW.sender IS NULL
		OR NEW.recipient IS NULL
		OR NEW.value_luna IS NULL
		OR NEW.data_text IS NULL
		OR NEW.block_number IS NULL
		OR NEW.block_timestamp_ms IS NULL
		OR NEW.finalizing_block_number IS NULL
		OR NEW.head_block_number IS NULL
		OR NEW.head_block_number < NEW.finalizing_block_number
		OR NEW.finalizing_block_number <= NEW.block_number
	) THEN
		RAISE EXCEPTION 'finalized chain transaction requires complete successful evidence';
	END IF;

	RETURN NEW;
END;
$$ LANGUAGE plpgsql;--> statement-breakpoint
CREATE TRIGGER chain_transactions_immutable_guard
	BEFORE INSERT OR UPDATE OR DELETE ON chain_transactions
	FOR EACH ROW EXECUTE FUNCTION protect_chain_transaction();--> statement-breakpoint
CREATE FUNCTION validate_purchase_transaction() RETURNS trigger AS $$
DECLARE
	order_state order_payment_state;
	chain_state chain_observed_state;
	chain_purpose chain_transaction_purpose;
	chain_resource uuid;
BEGIN
	IF TG_OP <> 'INSERT' THEN
		RAISE EXCEPTION 'verified purchase transaction is immutable';
	END IF;

	SELECT payment_state INTO order_state FROM orders WHERE id = NEW.order_id;
	SELECT observed_state, purpose, resource_id
	INTO chain_state, chain_purpose, chain_resource
	FROM chain_transactions WHERE id = NEW.chain_transaction_id;

	IF order_state <> 'purchased'
		OR chain_state <> 'finalized'
		OR chain_purpose <> 'purchase'
		OR chain_resource <> NEW.order_id THEN
		RAISE EXCEPTION 'purchase transaction must bind one purchased order to finalized purchase evidence';
	END IF;

	RETURN NEW;
END;
$$ LANGUAGE plpgsql;--> statement-breakpoint
CREATE TRIGGER purchase_transactions_immutable_guard
	BEFORE INSERT OR UPDATE OR DELETE ON purchase_transactions
	FOR EACH ROW EXECUTE FUNCTION validate_purchase_transaction();--> statement-breakpoint
CREATE FUNCTION validate_purchase_passport() RETURNS trigger AS $$
DECLARE
	bound_order orders%ROWTYPE;
	bound_purchase purchase_transactions%ROWTYPE;
	bound_chain chain_transactions%ROWTYPE;
	bound_policy policy_versions%ROWTYPE;
	expected_return_deadline timestamptz;
	expected_warranty_deadline timestamptz;
BEGIN
	IF TG_OP <> 'INSERT' THEN
		RAISE EXCEPTION 'purchase passport evidence is immutable';
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
		OR NEW.product_id <> bound_order.product_id
		OR NEW.merchant_id <> bound_order.merchant_id
		OR NEW.policy_version_id <> bound_order.policy_version_id
		OR NEW.product_name <> bound_order.product_name
		OR NEW.product_description <> bound_order.product_description
		OR NEW.merchant_display_name <> bound_order.merchant_display_name
		OR NEW.policy_payload_hash <> bound_order.policy_payload_hash
		OR NEW.policy_version <> bound_order.policy_version
		OR NEW.protocol_version <> bound_order.protocol_version
		OR NEW.price_luna <> bound_order.expected_value_luna
		OR NEW.settlement_recipient <> bound_order.expected_recipient
		OR NEW.purchase_time <> to_timestamp(bound_chain.block_timestamp_ms / 1000.0) THEN
		RAISE EXCEPTION 'purchase passport does not match immutable order and chain evidence';
	END IF;

	expected_return_deadline := CASE
		WHEN bound_policy.return_window_seconds = 0 THEN NULL
		ELSE NEW.purchase_time + make_interval(secs => bound_policy.return_window_seconds::double precision)
	END;
	expected_warranty_deadline := CASE
		WHEN bound_policy.warranty_window_seconds = 0 THEN NULL
		ELSE NEW.purchase_time + make_interval(secs => bound_policy.warranty_window_seconds::double precision)
	END;

	IF NEW.return_deadline IS DISTINCT FROM expected_return_deadline
		OR NEW.warranty_deadline IS DISTINCT FROM expected_warranty_deadline THEN
		RAISE EXCEPTION 'purchase passport deadlines do not match purchase-bound policy';
	END IF;

	RETURN NEW;
END;
$$ LANGUAGE plpgsql;--> statement-breakpoint
CREATE TRIGGER purchase_passports_immutable_guard
	BEFORE INSERT OR UPDATE OR DELETE ON purchase_passports
	FOR EACH ROW EXECUTE FUNCTION validate_purchase_passport();--> statement-breakpoint
GRANT SELECT, INSERT ON TABLE orders TO nimreturn_runtime;--> statement-breakpoint
GRANT UPDATE (buyer_address, payment_state, failure_code) ON TABLE orders TO nimreturn_runtime;--> statement-breakpoint
GRANT SELECT, INSERT ON TABLE chain_transactions TO nimreturn_runtime;--> statement-breakpoint
GRANT UPDATE (
	observed_state, normalized_evidence, observed_at, block_number, block_timestamp_ms,
	finalizing_block_number, head_block_number, confirmations, execution_result,
	sender, recipient, value_luna, data_text, verification_checks,
	verification_reason, verifier_version
) ON TABLE chain_transactions TO nimreturn_runtime;--> statement-breakpoint
GRANT SELECT, INSERT ON TABLE purchase_transactions TO nimreturn_runtime;--> statement-breakpoint
GRANT SELECT, INSERT ON TABLE purchase_passports TO nimreturn_runtime;
