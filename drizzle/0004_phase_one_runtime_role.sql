DO $$
BEGIN
	IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'nimreturn_runtime') THEN
		CREATE ROLE nimreturn_runtime NOLOGIN;
	END IF;
END;
$$;--> statement-breakpoint
ALTER ROLE nimreturn_runtime
	NOLOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE NOREPLICATION NOBYPASSRLS;--> statement-breakpoint
REVOKE CREATE ON SCHEMA public FROM PUBLIC;--> statement-breakpoint
REVOKE ALL ON ALL TABLES IN SCHEMA public FROM nimreturn_runtime;--> statement-breakpoint
REVOKE ALL ON ALL SEQUENCES IN SCHEMA public FROM nimreturn_runtime;--> statement-breakpoint
GRANT USAGE ON SCHEMA public TO nimreturn_runtime;--> statement-breakpoint
GRANT USAGE ON TYPE merchant_status, product_status, policy_verification_status,
	signing_challenge_action, evidence_type TO nimreturn_runtime;--> statement-breakpoint
GRANT SELECT, INSERT ON TABLE merchants TO nimreturn_runtime;--> statement-breakpoint
GRANT UPDATE (
	policy_signer_address, default_settlement_address, display_name, status, updated_at
) ON TABLE merchants TO nimreturn_runtime;--> statement-breakpoint
GRANT SELECT, INSERT ON TABLE merchant_bootstrap_sessions TO nimreturn_runtime;--> statement-breakpoint
GRANT UPDATE (consumed_at) ON TABLE merchant_bootstrap_sessions TO nimreturn_runtime;--> statement-breakpoint
GRANT SELECT, INSERT ON TABLE products TO nimreturn_runtime;--> statement-breakpoint
GRANT UPDATE (
	name, description, status, active_policy_version_id, updated_at
) ON TABLE products TO nimreturn_runtime;--> statement-breakpoint
GRANT SELECT, INSERT ON TABLE policy_versions TO nimreturn_runtime;--> statement-breakpoint
GRANT UPDATE (
	signer_address, public_key, signature, verification_status, verified_at, verifier_version
) ON TABLE policy_versions TO nimreturn_runtime;--> statement-breakpoint
GRANT SELECT, INSERT ON TABLE signing_challenges TO nimreturn_runtime;--> statement-breakpoint
GRANT UPDATE (consumed_at) ON TABLE signing_challenges TO nimreturn_runtime;--> statement-breakpoint
GRANT SELECT, INSERT ON TABLE protocol_events TO nimreturn_runtime;--> statement-breakpoint
GRANT USAGE, SELECT ON SEQUENCE protocol_events_id_seq TO nimreturn_runtime;--> statement-breakpoint
CREATE OR REPLACE FUNCTION prevent_merchant_identity_rewrite() RETURNS trigger AS $$
BEGIN
	IF TG_OP = 'INSERT' THEN
		IF NEW.policy_signer_address IS NOT NULL THEN
			RAISE EXCEPTION 'new merchant must begin without a policy signer';
		END IF;
		RETURN NEW;
	END IF;

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
DROP TRIGGER merchants_identity_immutable ON merchants;--> statement-breakpoint
CREATE TRIGGER merchants_identity_immutable
	BEFORE INSERT OR UPDATE OR DELETE ON merchants
	FOR EACH ROW EXECUTE FUNCTION prevent_merchant_identity_rewrite();--> statement-breakpoint
CREATE OR REPLACE FUNCTION protect_policy_version() RETURNS trigger AS $$
DECLARE
	established_signer varchar(36);
BEGIN
	IF TG_OP = 'INSERT' THEN
		IF NEW.verification_status <> 'pending'
			OR NEW.signer_address IS NOT NULL
			OR NEW.public_key IS NOT NULL
			OR NEW.signature IS NOT NULL
			OR NEW.verified_at IS NOT NULL
			OR NEW.verifier_version IS NOT NULL THEN
			RAISE EXCEPTION 'new policy version must begin pending without proof';
		END IF;
		RETURN NEW;
	END IF;

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
DROP TRIGGER policy_versions_immutable ON policy_versions;--> statement-breakpoint
CREATE TRIGGER policy_versions_immutable
	BEFORE INSERT OR UPDATE OR DELETE ON policy_versions
	FOR EACH ROW EXECUTE FUNCTION protect_policy_version();
