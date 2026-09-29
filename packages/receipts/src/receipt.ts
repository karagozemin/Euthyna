import {
  DecisionCommitmentBodySchema,
  DecisionCommitmentSchema,
  DecisionReceiptBodySchema,
  DecisionReceiptSchema,
  type DecisionCommitment,
  type DecisionCommitmentBody,
  type DecisionReceipt,
  type DecisionReceiptBody,
} from "@euthyna/domain";
import { canonicalJson, sha256Hex } from "@euthyna/evidence";

export function hashDecisionCommitment(body: DecisionCommitmentBody): `0x${string}` {
  return sha256Hex(canonicalJson(DecisionCommitmentBodySchema.parse(body)));
}

export function createDecisionCommitment(rawBody: DecisionCommitmentBody): DecisionCommitment {
  const body = DecisionCommitmentBodySchema.parse(rawBody);
  return DecisionCommitmentSchema.parse({
    ...body,
    decisionCommitmentHash: hashDecisionCommitment(body),
  });
}

export function verifyDecisionCommitment(commitment: DecisionCommitment): boolean {
  const parsed = DecisionCommitmentSchema.parse(commitment);
  const { decisionCommitmentHash, ...body } = parsed;
  return hashDecisionCommitment(body) === decisionCommitmentHash;
}

export function hashDecisionReceipt(body: DecisionReceiptBody): `0x${string}` {
  return sha256Hex(canonicalJson(DecisionReceiptBodySchema.parse(body)));
}

export function createDecisionReceipt(rawBody: DecisionReceiptBody): DecisionReceipt {
  const body = DecisionReceiptBodySchema.parse(rawBody);
  return DecisionReceiptSchema.parse({ ...body, finalReceiptHash: hashDecisionReceipt(body) });
}

export function verifyDecisionReceipt(receipt: DecisionReceipt): boolean {
  const parsed = DecisionReceiptSchema.parse(receipt);
  const { finalReceiptHash, ...body } = parsed;
  return hashDecisionReceipt(body) === finalReceiptHash;
}
