CREATE TYPE "public"."chain_reconciliation_outcome" AS ENUM('confirmed', 'inconclusive', 'exception');--> statement-breakpoint
CREATE TABLE "chain_reconciliations" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"chain_transaction_id" uuid NOT NULL,
	"outcome" "chain_reconciliation_outcome" NOT NULL,
	"normalized_evidence" jsonb,
	"reason" varchar(500) NOT NULL,
	"verifier_version" varchar(40) NOT NULL,
	"checked_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "chain_reconciliations_reason_not_blank" CHECK (btrim("chain_reconciliations"."reason") <> ''),
	CONSTRAINT "chain_reconciliations_evidence_object" CHECK ("chain_reconciliations"."normalized_evidence" is null or jsonb_typeof("chain_reconciliations"."normalized_evidence") = 'object')
);
--> statement-breakpoint
ALTER TABLE "chain_reconciliations" ADD CONSTRAINT "chain_reconciliations_chain_transaction_id_chain_transactions_id_fk" FOREIGN KEY ("chain_transaction_id") REFERENCES "public"."chain_transactions"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "chain_reconciliations_chain_checked_index" ON "chain_reconciliations" USING btree ("chain_transaction_id","checked_at");--> statement-breakpoint
CREATE FUNCTION prevent_chain_reconciliation_mutation() RETURNS trigger AS $$
BEGIN
	RAISE EXCEPTION 'chain reconciliation evidence is append-only';
END;
$$ LANGUAGE plpgsql;--> statement-breakpoint
CREATE TRIGGER chain_reconciliations_append_only
	BEFORE UPDATE OR DELETE ON chain_reconciliations
	FOR EACH ROW EXECUTE FUNCTION prevent_chain_reconciliation_mutation();--> statement-breakpoint
GRANT SELECT, INSERT ON TABLE chain_reconciliations TO nimreturn_runtime;
