import { recoverTypedDataAddress, type Address, type Hex } from "viem";
import { describe, expect, it } from "vitest";
import { WITNESS_TYPES, toContractAttestation } from "@euthyna/chain";
import { makeValidInput } from "./fixtures.js";
import {
  LocalPrivateKeyWitnessSigner,
  WitnessAuthorizationService,
} from "./authorization.js";
import { verifyObligation } from "./verify.js";

const privateKey = `0x${"11".repeat(32)}` as Hex;
const vault = "0x1111111111111111111111111111111111111111" as Address;
const chainId = 5_042_002;

function service() {
  return new WitnessAuthorizationService(
    new LocalPrivateKeyWitnessSigner(privateKey, chainId, vault),
  );
}

function meaning() {
  return {
    operationId: "op_release_1",
    businessId: "biz_demo",
    vendorId: "vendor_acme",
    payee: "0x1111111111111111111111111111111111111111" as Address,
    token: "0x3600000000000000000000000000000000000000" as Address,
    amountMinor: "125000000",
    receiptHash: `0x${"8".repeat(64)}` as Hex,
    validUntilUnix: "1800000600",
    chainId,
    verifyingContract: vault,
    witnessVersion: 1,
    rulesVersion: 1,
  };
}

describe("WitnessAuthorizationService", () => {
  it("signs the complete payment meaning after verification and plan validation", async () => {
    const result = await service().issue(
      verifyObligation(makeValidInput()),
      { valid: true, projectedImmediateBalanceMinor: "875000000", errors: [] },
      meaning(),
    );
    const recovered = await recoverTypedDataAddress({
      domain: {
        name: "Euthyna ObligationVault",
        version: "1",
        chainId,
        verifyingContract: vault,
      },
      types: WITNESS_TYPES,
      primaryType: "WitnessAttestation",
      message: toContractAttestation(result.attestation),
      signature: result.signature,
    });
    expect(recovered).toBe(result.signer);
    expect(result.attestation).toMatchObject({
      amountMinor: "125000000",
      evidenceRoot: verifyObligation(makeValidInput()).evidenceRoot,
      chainId: "5042002",
      verifyingContract: vault,
    });
  });

  it("refuses HOLD even if a caller supplies a valid plan flag", async () => {
    const input = makeValidInput();
    input.artifacts[0]!.fields.payoutDestination =
      "0x2222222222222222222222222222222222222222";
    await expect(
      service().issue(
        verifyObligation(input),
        { valid: true, projectedImmediateBalanceMinor: "875000000", errors: [] },
        meaning(),
      ),
    ).rejects.toThrow(/Cannot authorize witness verdict HOLD/);
  });

  it("refuses model output that did not pass the deterministic validator", async () => {
    await expect(
      service().issue(
        verifyObligation(makeValidInput()),
        {
          valid: false,
          projectedImmediateBalanceMinor: "0",
          errors: [{ obligationId: "obl_valid", code: "RESERVE_VIOLATION", message: "bad" }],
        },
        meaning(),
      ),
    ).rejects.toThrow(/failed deterministic validation/);
  });
});

