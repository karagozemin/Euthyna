import {
  DecisionReceiptBodySchema,
  DecisionReceiptSchema,
  type DecisionReceipt,
  type DecisionReceiptBody,
} from "@euthyna/domain";
import { canonicalJson, sha256Hex } from "@euthyna/evidence";

export function hashDecisionReceipt(body: DecisionReceiptBody): `0x${string}` {
  return sha256Hex(canonicalJson(DecisionReceiptBodySchema.parse(body)));
}

export function createDecisionReceipt(rawBody: DecisionReceiptBody): DecisionReceipt {
  const body = DecisionReceiptBodySchema.parse(rawBody);
  return DecisionReceiptSchema.parse({ ...body, receiptHash: hashDecisionReceipt(body) });
}

export function verifyDecisionReceipt(receipt: DecisionReceipt): boolean {
  const parsed = DecisionReceiptSchema.parse(receipt);
  const { receiptHash, ...body } = parsed;
  return hashDecisionReceipt(body) === receiptHash;
}

