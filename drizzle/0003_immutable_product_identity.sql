CREATE FUNCTION protect_product_identity() RETURNS trigger AS $$
BEGIN
	IF NEW.public_id IS DISTINCT FROM OLD.public_id
		OR NEW.merchant_id IS DISTINCT FROM OLD.merchant_id
		OR NEW.created_at IS DISTINCT FROM OLD.created_at THEN
		RAISE EXCEPTION 'product identity and ownership are immutable';
	END IF;

	RETURN NEW;
END;
$$ LANGUAGE plpgsql;--> statement-breakpoint
CREATE TRIGGER products_identity_immutable
	BEFORE UPDATE ON "products"
	FOR EACH ROW EXECUTE FUNCTION protect_product_identity();
