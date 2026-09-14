CREATE TYPE "public"."merchant_status" AS ENUM('active', 'disabled');--> statement-breakpoint
CREATE TABLE "merchant_bootstrap_sessions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"merchant_id" uuid NOT NULL,
	"capability_hash" char(64) NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	"consumed_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "merchant_bootstrap_sessions_capability_hash_unique" UNIQUE("capability_hash"),
	CONSTRAINT "merchant_bootstrap_sessions_id_merchant_unique" UNIQUE("id","merchant_id"),
	CONSTRAINT "merchant_bootstrap_sessions_capability_hash_format" CHECK ("merchant_bootstrap_sessions"."capability_hash" ~ '^[0-9a-f]{64}$'),
	CONSTRAINT "merchant_bootstrap_sessions_valid_times" CHECK ("merchant_bootstrap_sessions"."expires_at" > "merchant_bootstrap_sessions"."created_at" and ("merchant_bootstrap_sessions"."consumed_at" is null or ("merchant_bootstrap_sessions"."consumed_at" >= "merchant_bootstrap_sessions"."created_at" and "merchant_bootstrap_sessions"."consumed_at" <= "merchant_bootstrap_sessions"."expires_at")))
);
--> statement-breakpoint
CREATE TABLE "merchants" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"public_id" char(22) NOT NULL,
	"policy_signer_address" varchar(36),
	"default_settlement_address" varchar(36) NOT NULL,
	"display_name" varchar(80) NOT NULL,
	"status" "merchant_status" DEFAULT 'active' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "merchants_public_id_unique" UNIQUE("public_id"),
	CONSTRAINT "merchants_public_id_format" CHECK ("merchants"."public_id" ~ '^[A-Za-z0-9_-]{22}$'),
	CONSTRAINT "merchants_policy_signer_address_format" CHECK ("merchants"."policy_signer_address" is null or "merchants"."policy_signer_address" ~ '^NQ[0-9A-HJ-NP-VXY]{34}$'),
	CONSTRAINT "merchants_default_settlement_address_format" CHECK ("merchants"."default_settlement_address" ~ '^NQ[0-9A-HJ-NP-VXY]{34}$'),
	CONSTRAINT "merchants_display_name_not_blank" CHECK (btrim("merchants"."display_name") <> '')
);
--> statement-breakpoint
ALTER TABLE "merchant_bootstrap_sessions" ADD CONSTRAINT "merchant_bootstrap_sessions_merchant_id_merchants_id_fk" FOREIGN KEY ("merchant_id") REFERENCES "public"."merchants"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "merchant_bootstrap_sessions_one_unconsumed_per_merchant" ON "merchant_bootstrap_sessions" USING btree ("merchant_id") WHERE "merchant_bootstrap_sessions"."consumed_at" is null;--> statement-breakpoint
CREATE INDEX "merchant_bootstrap_sessions_expires_at_index" ON "merchant_bootstrap_sessions" USING btree ("expires_at");--> statement-breakpoint
CREATE UNIQUE INDEX "merchants_policy_signer_address_unique" ON "merchants" USING btree ("policy_signer_address") WHERE "merchants"."policy_signer_address" is not null;--> statement-breakpoint
CREATE INDEX "merchants_status_created_at_index" ON "merchants" USING btree ("status","created_at");--> statement-breakpoint
CREATE FUNCTION prevent_merchant_identity_rewrite() RETURNS trigger AS $$
BEGIN
	IF TG_OP = 'DELETE' THEN
		IF OLD.policy_signer_address IS NOT NULL THEN
			RAISE EXCEPTION 'an established merchant policy signer is immutable';
		END IF;
		RETURN OLD;
	END IF;

	IF OLD.policy_signer_address IS NOT NULL
		AND NEW.policy_signer_address IS DISTINCT FROM OLD.policy_signer_address THEN
		RAISE EXCEPTION 'merchant policy signer cannot be changed or cleared';
	END IF;

	RETURN NEW;
END;
$$ LANGUAGE plpgsql;--> statement-breakpoint
CREATE TRIGGER merchants_identity_immutable
	BEFORE UPDATE OR DELETE ON "merchants"
	FOR EACH ROW EXECUTE FUNCTION prevent_merchant_identity_rewrite();--> statement-breakpoint
CREATE FUNCTION protect_merchant_bootstrap_session() RETURNS trigger AS $$
DECLARE
	has_policy_signer boolean;
BEGIN
	IF TG_OP = 'INSERT' THEN
		SELECT policy_signer_address IS NOT NULL
		INTO has_policy_signer
		FROM merchants
		WHERE id = NEW.merchant_id
		FOR UPDATE;

		IF has_policy_signer THEN
			RAISE EXCEPTION 'cannot bootstrap an established merchant';
		END IF;

		RETURN NEW;
	END IF;

	IF OLD.merchant_id IS DISTINCT FROM NEW.merchant_id
		OR OLD.capability_hash IS DISTINCT FROM NEW.capability_hash
		OR OLD.expires_at IS DISTINCT FROM NEW.expires_at
		OR OLD.created_at IS DISTINCT FROM NEW.created_at THEN
		RAISE EXCEPTION 'merchant bootstrap session identity is immutable';
	END IF;

	IF OLD.consumed_at IS NOT NULL AND NEW.consumed_at IS DISTINCT FROM OLD.consumed_at THEN
		RAISE EXCEPTION 'consumed merchant bootstrap session is immutable';
	END IF;

	RETURN NEW;
END;
$$ LANGUAGE plpgsql;--> statement-breakpoint
CREATE TRIGGER merchant_bootstrap_session_guard
	BEFORE INSERT OR UPDATE ON "merchant_bootstrap_sessions"
	FOR EACH ROW EXECUTE FUNCTION protect_merchant_bootstrap_session();
