CREATE TYPE "public"."evidence_type" AS ENUM('signature', 'chain', 'backend');--> statement-breakpoint
CREATE TYPE "public"."policy_verification_status" AS ENUM('pending', 'verified', 'invalid', 'expired');--> statement-breakpoint
CREATE TYPE "public"."product_status" AS ENUM('draft', 'active', 'archived');--> statement-breakpoint
CREATE TYPE "public"."signing_challenge_action" AS ENUM('POLICY');--> statement-breakpoint
CREATE TABLE "policy_versions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"public_id" char(22) NOT NULL,
	"product_id" uuid NOT NULL,
	"merchant_id" uuid NOT NULL,
	"version" integer NOT NULL,
	"product_name" varchar(100) NOT NULL,
	"price_luna" bigint NOT NULL,
	"return_window_seconds" bigint NOT NULL,
	"warranty_window_seconds" bigint NOT NULL,
	"warranty_transfer_allowed" boolean NOT NULL,
	"protocol_version" varchar(8) NOT NULL,
	"challenge_nonce" char(22) NOT NULL,
	"payload" jsonb NOT NULL,
	"canonical_message" text NOT NULL,
	"payload_hash" char(64) NOT NULL,
	"settlement_address" varchar(36) NOT NULL,
	"signer_address" varchar(36),
	"public_key" char(64),
	"signature" char(128),
	"verification_status" "policy_verification_status" DEFAULT 'pending' NOT NULL,
	"verified_at" timestamp with time zone,
	"verifier_version" varchar(40),
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "policy_versions_public_id_unique" UNIQUE("public_id"),
	CONSTRAINT "policy_versions_product_version_unique" UNIQUE("product_id","version"),
	CONSTRAINT "policy_versions_challenge_nonce_unique" UNIQUE("challenge_nonce"),
	CONSTRAINT "policy_versions_id_product_unique" UNIQUE("id","product_id"),
	CONSTRAINT "policy_versions_id_merchant_unique" UNIQUE("id","merchant_id"),
	CONSTRAINT "policy_versions_public_id_format" CHECK ("policy_versions"."public_id" ~ '^[A-Za-z0-9_-]{22}$'),
	CONSTRAINT "policy_versions_version_positive" CHECK ("policy_versions"."version" > 0),
	CONSTRAINT "policy_versions_price_luna_range" CHECK ("policy_versions"."price_luna" > 0 and "policy_versions"."price_luna" <= 9007199254740991),
	CONSTRAINT "policy_versions_return_window_range" CHECK ("policy_versions"."return_window_seconds" >= 0 and "policy_versions"."return_window_seconds" <= 157680000),
	CONSTRAINT "policy_versions_warranty_window_range" CHECK ("policy_versions"."warranty_window_seconds" >= 0 and "policy_versions"."warranty_window_seconds" <= 157680000),
	CONSTRAINT "policy_versions_protocol" CHECK ("policy_versions"."protocol_version" = 'NR1'),
	CONSTRAINT "policy_versions_challenge_nonce_format" CHECK ("policy_versions"."challenge_nonce" ~ '^[A-Za-z0-9_-]{22}$'),
	CONSTRAINT "policy_versions_payload_object" CHECK (jsonb_typeof("policy_versions"."payload") = 'object'),
	CONSTRAINT "policy_versions_canonical_message_domain" CHECK ("policy_versions"."canonical_message" like 'NIMRETURN/1/POLICY' || chr(10) || '%'),
	CONSTRAINT "policy_versions_payload_hash_format" CHECK ("policy_versions"."payload_hash" ~ '^[0-9a-f]{64}$'),
	CONSTRAINT "policy_versions_settlement_address_format" CHECK ("policy_versions"."settlement_address" ~ '^NQ[0-9A-HJ-NP-VXY]{34}$'),
	CONSTRAINT "policy_versions_signer_address_format" CHECK ("policy_versions"."signer_address" is null or "policy_versions"."signer_address" ~ '^NQ[0-9A-HJ-NP-VXY]{34}$'),
	CONSTRAINT "policy_versions_public_key_format" CHECK ("policy_versions"."public_key" is null or "policy_versions"."public_key" ~ '^[0-9a-f]{64}$'),
	CONSTRAINT "policy_versions_signature_format" CHECK ("policy_versions"."signature" is null or "policy_versions"."signature" ~ '^[0-9a-f]{128}$'),
	CONSTRAINT "policy_versions_verified_proof_complete" CHECK ("policy_versions"."verification_status" <> 'verified' or ("policy_versions"."signer_address" is not null and "policy_versions"."public_key" is not null and "policy_versions"."signature" is not null and "policy_versions"."verified_at" is not null and "policy_versions"."verifier_version" is not null)),
	CONSTRAINT "policy_versions_unverified_has_no_verified_at" CHECK ("policy_versions"."verification_status" = 'verified' or "policy_versions"."verified_at" is null)
);
--> statement-breakpoint
CREATE TABLE "products" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"public_id" char(22) NOT NULL,
	"merchant_id" uuid NOT NULL,
	"name" varchar(100) NOT NULL,
	"description" varchar(500) DEFAULT '' NOT NULL,
	"status" "product_status" DEFAULT 'draft' NOT NULL,
	"active_policy_version_id" uuid,
	"row_version" integer DEFAULT 1 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "products_public_id_unique" UNIQUE("public_id"),
	CONSTRAINT "products_id_merchant_unique" UNIQUE("id","merchant_id"),
	CONSTRAINT "products_public_id_format" CHECK ("products"."public_id" ~ '^[A-Za-z0-9_-]{22}$'),
	CONSTRAINT "products_name_format" CHECK (btrim("products"."name") = "products"."name" and "products"."name" <> '' and "products"."name" !~ '[[:cntrl:]]'),
	CONSTRAINT "products_description_format" CHECK (btrim("products"."description") = "products"."description" and "products"."description" !~ '[[:cntrl:]]'),
	CONSTRAINT "products_row_version_positive" CHECK ("products"."row_version" > 0),
	CONSTRAINT "products_active_requires_policy" CHECK ("products"."status" <> 'active' or "products"."active_policy_version_id" is not null)
);
--> statement-breakpoint
CREATE TABLE "protocol_events" (
	"id" bigserial PRIMARY KEY NOT NULL,
	"event_id" uuid DEFAULT gen_random_uuid() NOT NULL,
	"aggregate_type" varchar(40) NOT NULL,
	"aggregate_id" uuid NOT NULL,
	"event_type" varchar(60) NOT NULL,
	"protocol_version" varchar(8) NOT NULL,
	"occurred_at" timestamp with time zone NOT NULL,
	"actor_address" varchar(36),
	"causation_id" uuid,
	"correlation_id" uuid NOT NULL,
	"evidence_type" "evidence_type" NOT NULL,
	"evidence_id" uuid,
	"payload" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "protocol_events_event_id_unique" UNIQUE("event_id"),
	CONSTRAINT "protocol_events_protocol" CHECK ("protocol_events"."protocol_version" = 'NR1'),
	CONSTRAINT "protocol_events_actor_address_format" CHECK ("protocol_events"."actor_address" is null or "protocol_events"."actor_address" ~ '^NQ[0-9A-HJ-NP-VXY]{34}$'),
	CONSTRAINT "protocol_events_payload_object" CHECK (jsonb_typeof("protocol_events"."payload") = 'object')
);
--> statement-breakpoint
CREATE TABLE "signing_challenges" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"nonce" char(22) NOT NULL,
	"action" "signing_challenge_action" NOT NULL,
	"merchant_id" uuid NOT NULL,
	"policy_version_id" uuid NOT NULL,
	"bootstrap_session_id" uuid,
	"expected_signer_address" varchar(36),
	"canonical_message" text NOT NULL,
	"payload_hash" char(64) NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	"consumed_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "signing_challenges_nonce_unique" UNIQUE("nonce"),
	CONSTRAINT "signing_challenges_policy_version_unique" UNIQUE("policy_version_id"),
	CONSTRAINT "signing_challenges_nonce_format" CHECK ("signing_challenges"."nonce" ~ '^[A-Za-z0-9_-]{22}$'),
	CONSTRAINT "signing_challenges_expected_signer_format" CHECK ("signing_challenges"."expected_signer_address" is null or "signing_challenges"."expected_signer_address" ~ '^NQ[0-9A-HJ-NP-VXY]{34}$'),
	CONSTRAINT "signing_challenges_bootstrap_or_established_signer" CHECK (("signing_challenges"."expected_signer_address" is null and "signing_challenges"."bootstrap_session_id" is not null) or ("signing_challenges"."expected_signer_address" is not null and "signing_challenges"."bootstrap_session_id" is null)),
	CONSTRAINT "signing_challenges_canonical_message_domain" CHECK ("signing_challenges"."canonical_message" like 'NIMRETURN/1/POLICY' || chr(10) || '%'),
	CONSTRAINT "signing_challenges_payload_hash_format" CHECK ("signing_challenges"."payload_hash" ~ '^[0-9a-f]{64}$'),
	CONSTRAINT "signing_challenges_valid_times" CHECK ("signing_challenges"."expires_at" > "signing_challenges"."created_at" and ("signing_challenges"."consumed_at" is null or ("signing_challenges"."consumed_at" >= "signing_challenges"."created_at" and "signing_challenges"."consumed_at" <= "signing_challenges"."expires_at")))
);
--> statement-breakpoint
ALTER TABLE "policy_versions" ADD CONSTRAINT "policy_versions_product_merchant_fk" FOREIGN KEY ("product_id","merchant_id") REFERENCES "public"."products"("id","merchant_id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "products" ADD CONSTRAINT "products_merchant_id_merchants_id_fk" FOREIGN KEY ("merchant_id") REFERENCES "public"."merchants"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "products" ADD CONSTRAINT "products_active_policy_version_id_policy_versions_id_fk" FOREIGN KEY ("active_policy_version_id") REFERENCES "public"."policy_versions"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "signing_challenges" ADD CONSTRAINT "signing_challenges_policy_merchant_fk" FOREIGN KEY ("policy_version_id","merchant_id") REFERENCES "public"."policy_versions"("id","merchant_id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "signing_challenges" ADD CONSTRAINT "signing_challenges_bootstrap_merchant_fk" FOREIGN KEY ("bootstrap_session_id","merchant_id") REFERENCES "public"."merchant_bootstrap_sessions"("id","merchant_id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "policy_versions_product_version_index" ON "policy_versions" USING btree ("product_id","version");--> statement-breakpoint
CREATE INDEX "policy_versions_merchant_status_index" ON "policy_versions" USING btree ("merchant_id","verification_status");--> statement-breakpoint
CREATE INDEX "products_merchant_status_index" ON "products" USING btree ("merchant_id","status");--> statement-breakpoint
CREATE INDEX "protocol_events_aggregate_index" ON "protocol_events" USING btree ("aggregate_type","aggregate_id","id");--> statement-breakpoint
CREATE INDEX "protocol_events_type_occurred_at_index" ON "protocol_events" USING btree ("event_type","occurred_at");--> statement-breakpoint
CREATE INDEX "signing_challenges_expires_at_index" ON "signing_challenges" USING btree ("expires_at");--> statement-breakpoint
CREATE FUNCTION validate_policy_version_payload() RETURNS trigger AS $$
DECLARE
	merchant_public_id char(22);
	product_public_id char(22);
	expected_payload jsonb;
BEGIN
	SELECT merchants.public_id, products.public_id
	INTO merchant_public_id, product_public_id
	FROM products
	JOIN merchants ON merchants.id = products.merchant_id
	WHERE products.id = NEW.product_id AND merchants.id = NEW.merchant_id;

	IF NOT FOUND THEN
		RAISE EXCEPTION 'policy product and merchant ownership do not match';
	END IF;

	IF jsonb_typeof(NEW.payload->'createdAt') <> 'number'
		OR (NEW.payload->>'createdAt')::numeric < 0
		OR (NEW.payload->>'createdAt')::numeric > 9007199254740991
		OR trunc((NEW.payload->>'createdAt')::numeric) <> (NEW.payload->>'createdAt')::numeric THEN
		RAISE EXCEPTION 'policy payload createdAt must be a non-negative safe integer';
	END IF;

	expected_payload := jsonb_build_object(
		'createdAt', NEW.payload->'createdAt',
		'merchantId', btrim(merchant_public_id),
		'nonce', btrim(NEW.challenge_nonce),
		'policyId', btrim(NEW.public_id),
		'priceLuna', NEW.price_luna,
		'productId', btrim(product_public_id),
		'productName', NEW.product_name,
		'protocol', NEW.protocol_version,
		'returnWindowSeconds', NEW.return_window_seconds,
		'settlementAddress', NEW.settlement_address,
		'type', 'POLICY',
		'version', NEW.version,
		'warrantyTransferAllowed', NEW.warranty_transfer_allowed,
		'warrantyWindowSeconds', NEW.warranty_window_seconds
	);

	IF NEW.payload <> expected_payload THEN
		RAISE EXCEPTION 'policy payload does not match normalized policy columns';
	END IF;

	RETURN NEW;
END;
$$ LANGUAGE plpgsql;--> statement-breakpoint
CREATE TRIGGER policy_versions_payload_guard
	BEFORE INSERT OR UPDATE ON "policy_versions"
	FOR EACH ROW EXECUTE FUNCTION validate_policy_version_payload();--> statement-breakpoint
CREATE FUNCTION protect_policy_version() RETURNS trigger AS $$
DECLARE
	established_signer varchar(36);
BEGIN
	IF TG_OP = 'DELETE' THEN
		IF OLD.verification_status = 'verified' THEN
			RAISE EXCEPTION 'verified policy version is immutable';
		END IF;
		RETURN OLD;
	END IF;

	IF OLD.verification_status <> 'pending' THEN
		RAISE EXCEPTION 'terminal policy version is immutable';
	END IF;

	IF ROW(
		NEW.public_id, NEW.product_id, NEW.merchant_id, NEW.version,
		NEW.product_name, NEW.price_luna, NEW.return_window_seconds,
		NEW.warranty_window_seconds, NEW.warranty_transfer_allowed,
		NEW.protocol_version, NEW.challenge_nonce, NEW.payload,
		NEW.canonical_message, NEW.payload_hash, NEW.settlement_address,
		NEW.created_at
	) IS DISTINCT FROM ROW(
		OLD.public_id, OLD.product_id, OLD.merchant_id, OLD.version,
		OLD.product_name, OLD.price_luna, OLD.return_window_seconds,
		OLD.warranty_window_seconds, OLD.warranty_transfer_allowed,
		OLD.protocol_version, OLD.challenge_nonce, OLD.payload,
		OLD.canonical_message, OLD.payload_hash, OLD.settlement_address,
		OLD.created_at
	) THEN
		RAISE EXCEPTION 'signed policy candidate fields are immutable';
	END IF;

	IF NEW.verification_status = 'pending' THEN
		RAISE EXCEPTION 'policy update must enter a terminal verification state';
	END IF;

	IF NEW.verification_status = 'verified' THEN
		SELECT policy_signer_address
		INTO established_signer
		FROM merchants
		WHERE id = NEW.merchant_id
		FOR KEY SHARE;

		IF established_signer IS NULL OR NEW.signer_address IS DISTINCT FROM established_signer THEN
			RAISE EXCEPTION 'verified policy signer does not match established merchant signer';
		END IF;
	END IF;

	RETURN NEW;
END;
$$ LANGUAGE plpgsql;--> statement-breakpoint
CREATE TRIGGER policy_versions_immutable
	BEFORE UPDATE OR DELETE ON "policy_versions"
	FOR EACH ROW EXECUTE FUNCTION protect_policy_version();--> statement-breakpoint
CREATE FUNCTION validate_product_active_policy() RETURNS trigger AS $$
DECLARE
	policy_is_valid boolean;
BEGIN
	IF TG_OP = 'UPDATE' THEN
		NEW.row_version := OLD.row_version + 1;
		NEW.updated_at := clock_timestamp();
	END IF;

	IF NEW.active_policy_version_id IS NOT NULL THEN
		SELECT EXISTS (
			SELECT 1 FROM policy_versions
			WHERE id = NEW.active_policy_version_id
				AND product_id = NEW.id
				AND merchant_id = NEW.merchant_id
				AND verification_status = 'verified'
		) INTO policy_is_valid;

		IF NOT policy_is_valid THEN
			RAISE EXCEPTION 'active policy must be a verified version of this product';
		END IF;
	END IF;

	RETURN NEW;
END;
$$ LANGUAGE plpgsql;--> statement-breakpoint
CREATE TRIGGER products_active_policy_guard
	BEFORE INSERT OR UPDATE ON "products"
	FOR EACH ROW EXECUTE FUNCTION validate_product_active_policy();--> statement-breakpoint
CREATE FUNCTION protect_signing_challenge() RETURNS trigger AS $$
DECLARE
	policy_record policy_versions%ROWTYPE;
	merchant_signer varchar(36);
	bootstrap_valid boolean;
BEGIN
	IF TG_OP = 'INSERT' THEN
		IF NEW.consumed_at IS NOT NULL THEN
			RAISE EXCEPTION 'new signing challenge cannot already be consumed';
		END IF;

		SELECT * INTO policy_record
		FROM policy_versions
		WHERE id = NEW.policy_version_id AND merchant_id = NEW.merchant_id;

		IF NOT FOUND OR policy_record.verification_status <> 'pending'
			OR NEW.nonce IS DISTINCT FROM policy_record.challenge_nonce
			OR NEW.canonical_message IS DISTINCT FROM policy_record.canonical_message
			OR NEW.payload_hash IS DISTINCT FROM policy_record.payload_hash THEN
			RAISE EXCEPTION 'signing challenge does not match its pending policy version';
		END IF;

		SELECT policy_signer_address INTO merchant_signer
		FROM merchants WHERE id = NEW.merchant_id FOR KEY SHARE;

		IF NEW.bootstrap_session_id IS NOT NULL THEN
			SELECT EXISTS (
				SELECT 1 FROM merchant_bootstrap_sessions
				WHERE id = NEW.bootstrap_session_id
					AND merchant_id = NEW.merchant_id
					AND consumed_at IS NULL
					AND expires_at > clock_timestamp()
			) INTO bootstrap_valid;

			IF merchant_signer IS NOT NULL OR NOT bootstrap_valid THEN
				RAISE EXCEPTION 'first-policy challenge requires a live merchant bootstrap';
			END IF;
		ELSIF merchant_signer IS NULL OR NEW.expected_signer_address IS DISTINCT FROM merchant_signer THEN
			RAISE EXCEPTION 'signing challenge expected signer does not match merchant authority';
		END IF;

		RETURN NEW;
	END IF;

	IF ROW(
		NEW.nonce, NEW.action, NEW.merchant_id, NEW.policy_version_id,
		NEW.bootstrap_session_id, NEW.expected_signer_address,
		NEW.canonical_message, NEW.payload_hash, NEW.expires_at, NEW.created_at
	) IS DISTINCT FROM ROW(
		OLD.nonce, OLD.action, OLD.merchant_id, OLD.policy_version_id,
		OLD.bootstrap_session_id, OLD.expected_signer_address,
		OLD.canonical_message, OLD.payload_hash, OLD.expires_at, OLD.created_at
	) THEN
		RAISE EXCEPTION 'signing challenge fields are immutable';
	END IF;

	IF OLD.consumed_at IS NOT NULL OR NEW.consumed_at IS NULL THEN
		RAISE EXCEPTION 'signing challenge consumption is one-way';
	END IF;

	RETURN NEW;
END;
$$ LANGUAGE plpgsql;--> statement-breakpoint
CREATE TRIGGER signing_challenges_guard
	BEFORE INSERT OR UPDATE ON "signing_challenges"
	FOR EACH ROW EXECUTE FUNCTION protect_signing_challenge();--> statement-breakpoint
CREATE FUNCTION prevent_protocol_event_mutation() RETURNS trigger AS $$
BEGIN
	RAISE EXCEPTION 'protocol events are append-only';
END;
$$ LANGUAGE plpgsql;--> statement-breakpoint
CREATE TRIGGER protocol_events_append_only
	BEFORE UPDATE OR DELETE ON "protocol_events"
	FOR EACH ROW EXECUTE FUNCTION prevent_protocol_event_mutation();
