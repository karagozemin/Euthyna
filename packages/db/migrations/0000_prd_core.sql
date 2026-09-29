-- Euthyna PRD v1 core schema. Generated application schema lives in src/schema.ts.
-- Monetary columns are NUMERIC(78,0): integers only, never floating point.

CREATE TYPE classification AS ENUM ('REAL', 'TEST');
CREATE TYPE environment AS ENUM ('LOCAL', 'ARC_TESTNET', 'ARC_MAINNET');
CREATE TYPE vendor_status AS ENUM ('PENDING_ONBOARDING', 'ACTIVE', 'PENDING_CHANGE', 'SUSPENDED');
CREATE TYPE destination_status AS ENUM ('PROPOSED', 'VERIFIED', 'SUPERSEDED');
CREATE TYPE evidence_type AS ENUM ('INVOICE', 'AGREEMENT', 'DELIVERY', 'VENDOR_IDENTITY', 'PAYMENT_INSTRUCTION', 'HUMAN_ATTESTATION', 'CREDIT_NOTE');
CREATE TYPE obligation_status AS ENUM ('INGESTED', 'NORMALIZED', 'EVIDENCE_PENDING', 'VERIFIED', 'HOLD', 'REJECTED', 'PLANNED', 'AUTHORIZED', 'SUBMITTED', 'SETTLED');
CREATE TYPE witness_verdict AS ENUM ('VERIFIED', 'HOLD', 'REJECT');
CREATE TYPE payment_action AS ENUM ('PAY_NOW', 'SCHEDULE', 'PARTIAL_PAY', 'ESCALATE', 'NO_ACTION');
CREATE TYPE payment_state AS ENUM ('PROPOSED', 'POLICY_VALIDATED', 'ATTESTED', 'SIMULATED', 'SIGNED', 'SUBMITTED', 'SETTLED', 'ESCALATED', 'APPROVED', 'CANCELLED', 'EXPIRED');
CREATE TYPE settlement_status AS ENUM ('PREPARED', 'SUBMITTED', 'FINAL', 'REVERTED', 'RECONCILED');

CREATE TABLE businesses (
  id text PRIMARY KEY, name text NOT NULL, timezone text NOT NULL, base_currency text NOT NULL,
  token_decimals integer NOT NULL CHECK (token_decimals BETWEEN 0 AND 36),
  minimum_reserve_minor numeric(78,0) NOT NULL CHECK (minimum_reserve_minor >= 0),
  per_payment_cap_minor numeric(78,0) NOT NULL CHECK (per_payment_cap_minor > 0),
  approval_threshold_minor numeric(78,0) NOT NULL CHECK (approval_threshold_minor >= 0 AND approval_threshold_minor <= per_payment_cap_minor),
  policy_version bigint NOT NULL DEFAULT 1 CHECK (policy_version > 0), environment environment NOT NULL,
  classification classification NOT NULL, created_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE vendors (
  id text PRIMARY KEY, business_id text NOT NULL REFERENCES businesses(id), legal_name text NOT NULL,
  normalized_name text NOT NULL, status vendor_status NOT NULL, current_version bigint NOT NULL CHECK (current_version > 0),
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX vendors_business_idx ON vendors(business_id);
CREATE TABLE vendor_destinations (
  vendor_id text NOT NULL REFERENCES vendors(id), version bigint NOT NULL CHECK (version > 0), chain text NOT NULL,
  address text NOT NULL, verification_method text NOT NULL, approved_by text NOT NULL, approved_at timestamptz NOT NULL,
  status destination_status NOT NULL, change_kind text NOT NULL, first_seen_at timestamptz NOT NULL,
  PRIMARY KEY(vendor_id, version), UNIQUE(vendor_id, version, address)
);
CREATE TABLE evidence_artifacts (
  id text PRIMARY KEY, business_id text NOT NULL REFERENCES businesses(id), type evidence_type NOT NULL,
  source_uri text NOT NULL, source_channel text NOT NULL, issuer_id text, issuer_name text, received_at timestamptz NOT NULL,
  content_hash text NOT NULL, normalized_content_hash text NOT NULL, raw_artifact_hash text NOT NULL,
  relevant_identifiers_json jsonb NOT NULL, relationships_json jsonb NOT NULL, provenance_metadata_json jsonb NOT NULL,
  mime_type text NOT NULL,
  parser_name text NOT NULL, parser_version text NOT NULL, extracted_json jsonb NOT NULL, provenance_json jsonb NOT NULL,
  ingested_at timestamptz NOT NULL, valid_until timestamptz, created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE(business_id, content_hash)
);
CREATE INDEX evidence_business_type_idx ON evidence_artifacts(business_id, type);
CREATE TABLE obligations (
  id text PRIMARY KEY, business_id text NOT NULL REFERENCES businesses(id), vendor_id text NOT NULL REFERENCES vendors(id),
  invoice_key text NOT NULL, invoice_number text NOT NULL, invoice_date date NOT NULL, agreement_reference text NOT NULL,
  amount_minor numeric(78,0) NOT NULL CHECK (amount_minor > 0), currency text NOT NULL,
  token_decimals integer NOT NULL CHECK (token_decimals BETWEEN 0 AND 36), issue_date date NOT NULL, due_date date NOT NULL,
  requested_payout text NOT NULL, partial_payment_allowed boolean NOT NULL DEFAULT false, revision_of_obligation_id text,
  status obligation_status NOT NULL, classification classification NOT NULL, settled_tx text,
  created_at timestamptz NOT NULL DEFAULT now(), UNIQUE(business_id, invoice_key)
);
CREATE INDEX obligations_business_status_idx ON obligations(business_id, status);
CREATE TABLE obligation_evidence (
  obligation_id text NOT NULL REFERENCES obligations(id), artifact_id text NOT NULL REFERENCES evidence_artifacts(id),
  role text NOT NULL, required boolean NOT NULL, match_result jsonb NOT NULL,
  PRIMARY KEY(obligation_id, artifact_id, role)
);
CREATE TABLE witness_runs (
  id text PRIMARY KEY, obligation_id text NOT NULL REFERENCES obligations(id), vendor_version bigint NOT NULL,
  policy_version bigint NOT NULL, evidence_root text NOT NULL, verdict witness_verdict NOT NULL, reason_code text,
  checks_json jsonb NOT NULL, signer_version text, latency_ms integer NOT NULL CHECK (latency_ms >= 0),
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX witness_obligation_created_idx ON witness_runs(obligation_id, created_at);
CREATE TABLE payment_plans (
  id text PRIMARY KEY, business_id text NOT NULL REFERENCES businesses(id), business_state_hash text NOT NULL,
  provider text NOT NULL, model text NOT NULL, model_version text NOT NULL, decisions_json jsonb NOT NULL,
  assumptions_json jsonb NOT NULL, created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX plans_business_created_idx ON payment_plans(business_id, created_at);
CREATE TABLE payment_intents (
  id text PRIMARY KEY, plan_id text NOT NULL REFERENCES payment_plans(id), obligation_id text NOT NULL REFERENCES obligations(id),
  action payment_action NOT NULL, amount_minor numeric(78,0) NOT NULL CHECK (amount_minor > 0), currency text NOT NULL,
  payee text NOT NULL, scheduled_for date, state payment_state NOT NULL, policy_version bigint NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(), UNIQUE(plan_id, obligation_id)
);
CREATE TABLE attestations (
  id text PRIMARY KEY, intent_id text NOT NULL UNIQUE REFERENCES payment_intents(id), operation_id text NOT NULL UNIQUE,
  typed_data_hash text NOT NULL,
  decision_commitment_hash text NOT NULL,
  valid_until timestamptz NOT NULL, witness_signature text NOT NULL, signer_version text NOT NULL,
  vendor_version bigint NOT NULL, policy_version bigint NOT NULL, witness_version bigint NOT NULL, rules_version bigint NOT NULL,
  chain_id bigint NOT NULL, verifying_contract text NOT NULL, created_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE settlements (
  id text PRIMARY KEY, intent_id text NOT NULL UNIQUE REFERENCES payment_intents(id), chain_id bigint NOT NULL,
  chain text NOT NULL, tx_hash text NOT NULL, submitted_at timestamptz NOT NULL, finalized_at timestamptz,
  block_number numeric(78,0), status settlement_status NOT NULL,
  decision_commitment_hash text NOT NULL, attestation_hash text NOT NULL, final_receipt_hash text,
  created_at timestamptz NOT NULL DEFAULT now(), UNIQUE(chain_id, tx_hash)
);
CREATE TABLE audit_events (
  id uuid PRIMARY KEY, business_id text NOT NULL REFERENCES businesses(id), entity_type text NOT NULL, entity_id text NOT NULL,
  action text NOT NULL, actor text NOT NULL, previous_state text, new_state text, reason_code text,
  payload_json jsonb NOT NULL, payload_hash text NOT NULL, created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX audit_business_created_idx ON audit_events(business_id, created_at);
CREATE TABLE feedback_events (
  id uuid PRIMARY KEY, business_id text NOT NULL REFERENCES businesses(id), user_id text NOT NULL, decision_id text NOT NULL,
  agreed boolean NOT NULL, note text, created_at timestamptz NOT NULL DEFAULT now()
);

CREATE FUNCTION reject_immutable_mutation() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN RAISE EXCEPTION '% is append-only/immutable', TG_TABLE_NAME; END;
$$;
CREATE TRIGGER audit_events_append_only BEFORE UPDATE OR DELETE ON audit_events
  FOR EACH ROW EXECUTE FUNCTION reject_immutable_mutation();
CREATE TRIGGER evidence_artifacts_immutable BEFORE UPDATE OR DELETE ON evidence_artifacts
  FOR EACH ROW EXECUTE FUNCTION reject_immutable_mutation();
CREATE TRIGGER witness_runs_append_only BEFORE UPDATE OR DELETE ON witness_runs
  FOR EACH ROW EXECUTE FUNCTION reject_immutable_mutation();
CREATE TRIGGER attestations_append_only BEFORE UPDATE OR DELETE ON attestations
  FOR EACH ROW EXECUTE FUNCTION reject_immutable_mutation();
