import { writeFileSync } from "node:fs";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import {
  CircleArcExecutor,
  RpcExecutionSimulator,
  createCircleTransactionSigner,
  loadArcDeploymentConfigFromEnv,
  runArcFundingPreflight,
} from "@euthyna/chain";
import { InMemoryEuthynaRepository } from "@euthyna/db";
import type { BusinessState, PlanningObligation } from "@euthyna/domain";
import { canonicalJson, sha256Hex } from "@euthyna/evidence";
import { BoundedDecisionAgent, validatePaymentPlan } from "@euthyna/planner";
import {
  createDecisionCommitment,
  createDecisionReceipt,
  verifyDecisionReceipt,
} from "@euthyna/receipts";
import {
  LocalPrivateKeyWitnessSigner,
  WitnessAuthorizationService,
  makeValidInput,
  verifyObligation,
} from "@euthyna/witness";
import {
  createPublicClient,
  http,
  keccak256,
  stringToHex,
  type Address,
  type Hex,
} from "viem";
import { arcTestnet } from "viem/chains";

function required(name: string): string {
  const value = process.env[name];
  if (!value) throw new Error(`Missing required environment variable ${name}`);
  return value;
}

function taggedHash(value: unknown): string {
  return `sha256:${sha256Hex(canonicalJson(value)).slice(2)}`;
}

function dateOnly(iso: string): string {
  return iso.slice(0, 10);
}

async function main(): Promise<void> {
  if (process.env.ARC_TESTNET_SETTLEMENT_ACK !== "YES") {
    throw new Error("Set ARC_TESTNET_SETTLEMENT_ACK=YES to authorize this TEST USDC settlement run");
  }
  if (process.env.NODE_ENV === "production") {
    throw new Error("This fixture runner refuses production; use a managed WitnessTypedDataSigner there");
  }
  if (process.env.ALLOW_TESTNET_RAW_WITNESS_KEY !== "YES") {
    throw new Error("Set ALLOW_TESTNET_RAW_WITNESS_KEY=YES for this Arc Testnet-only fixture runner");
  }

  const config = loadArcDeploymentConfigFromEnv();
  if (config.environment !== "testnet" || config.chainId !== 5_042_002) {
    throw new Error("First settlement runner is restricted to Arc Testnet");
  }
  const businessId = required("VAULT_BUSINESS_ID");
  const vendorId = required("TEST_VENDOR_ID");
  const expectedVendorHash = required("TEST_VENDOR_ID_HASH").toLowerCase();
  const payee = required("TEST_VENDOR_PAYEE_ADDRESS") as Address;
  const amountMinor = required("SETTLEMENT_AMOUNT_MINOR");
  const createdAt = required("TEST_RUN_CREATED_AT");
  const validUntilUnix = required("TEST_VALID_UNTIL_UNIX");
  const obligationId = required("TEST_OBLIGATION_ID");
  const operationId = required("TEST_OPERATION_ID");
  const policyVersion = Number(required("VAULT_POLICY_VERSION"));
  const witnessVersion = Number(required("VAULT_WITNESS_VERSION"));
  const rulesVersion = Number(required("VAULT_RULES_VERSION"));
  const approvalThresholdMinor = required("VAULT_APPROVAL_THRESHOLD_MINOR");

  if (!/^[1-9][0-9]*$/.test(amountMinor)) throw new Error("Settlement amount must be positive integer base units");
  if (BigInt(amountMinor) > BigInt(approvalThresholdMinor)) {
    throw new Error("First settlement amount must not require owner approval");
  }
  if (BigInt(validUntilUnix) <= BigInt(Math.floor(Date.now() / 1_000))) {
    throw new Error("TEST_VALID_UNTIL_UNIX must still be in the future");
  }
  if (keccak256(stringToHex(businessId)).toLowerCase() !== config.vaultBusinessIdHash.toLowerCase()) {
    throw new Error("VAULT_BUSINESS_ID does not hash to the deployed vault business binding");
  }
  if (keccak256(stringToHex(vendorId)).toLowerCase() !== expectedVendorHash) {
    throw new Error("TEST_VENDOR_ID does not match TEST_VENDOR_ID_HASH");
  }

  const preflight = await runArcFundingPreflight(config, BigInt(amountMinor));
  const repository = new InMemoryEuthynaRepository();
  const input = makeValidInput();
  const day = dateOnly(createdAt);
  const agreementStart = new Date(Date.parse(createdAt) - 86_400_000).toISOString().slice(0, 10);
  const agreementEnd = new Date(Date.parse(createdAt) + 30 * 86_400_000).toISOString().slice(0, 10);
  const lineItems = [{ description: "Euthyna Arc Testnet proof-of-obligation fixture", amountMinor, quantityMinor: "1" }];
  input.evaluatedAt = createdAt;
  input.policy.policyVersion = policyVersion;
  input.obligation = {
    ...input.obligation,
    id: obligationId,
    businessId,
    vendorId,
    invoiceNumber: `TEST-${obligationId}`,
    invoiceDate: day,
    amountMinor,
    dueDate: day,
    requestedPayoutDestination: payee,
    lineItems,
  };
  input.vendor = {
    ...input.vendor,
    id: vendorId,
    businessId,
    currentVersion: 1,
  };
  input.vendorDestination = {
    ...input.vendorDestination!,
    vendorId,
    version: 1,
    address: payee,
    approvedAt: createdAt,
    firstSeenAt: createdAt,
  };
  input.artifacts = input.artifacts.map((artifact) => {
    const fields = {
      ...artifact.fields,
      vendorId,
      amountMinor: artifact.type === "DELIVERY" ? null : amountMinor,
      invoiceNumber: artifact.type === "INVOICE" ? input.obligation.invoiceNumber : artifact.fields.invoiceNumber,
      issueDate: artifact.type === "INVOICE" ? day : artifact.fields.issueDate,
      dueDate: artifact.type === "INVOICE" ? day : artifact.fields.dueDate,
      agreementStartsOn: artifact.type === "AGREEMENT" ? agreementStart : artifact.fields.agreementStartsOn,
      agreementEndsOn: artifact.type === "AGREEMENT" ? agreementEnd : artifact.fields.agreementEndsOn,
      payoutDestination: artifact.type === "INVOICE" ? payee : artifact.fields.payoutDestination,
      lineItems: artifact.type === "DELIVERY" ? [] : lineItems,
    };
    const publicDocument = { classification: "TEST", type: artifact.type, fields };
    return {
      ...artifact,
      id: `${obligationId}_${artifact.type.toLowerCase()}`,
      businessId,
      issuer: { ...artifact.issuer, id: vendorId },
      receivedAt: createdAt,
      contentHash: taggedHash(publicDocument),
      normalizedContentHash: taggedHash({ ...publicDocument, normalized: true }),
      rawArtifactHash: taggedHash({ ...publicDocument, raw: true }),
      provenanceMetadata: { fixture: true, classification: "TEST", generatedBy: "first-arc-settlement" },
      ingestedAt: createdAt,
      fields,
    };
  });

  await repository.transaction((tx) => {
    const pendingVendor = { ...input.vendor, status: "PENDING_ONBOARDING" as const, currentVersion: 0 };
    tx.createVendor(pendingVendor, "test-owner", createdAt);
    const destination = tx.proposeDestination(vendorId, payee, "ARC_TESTNET", "test-owner", createdAt);
    tx.verifyDestination(vendorId, destination.version, "OWNER_OUT_OF_BAND", "test-owner", createdAt);
    for (const artifact of input.artifacts) tx.putArtifact(artifact, "test-fixture-generator");
    tx.createObligation(input.obligation, input.artifacts.map((artifact) => artifact.id), "first-arc-runner", createdAt);
  });

  const witness = verifyObligation(input);
  if (witness.verdict !== "VERIFIED") {
    throw new Error(`Evidence Witness refused TEST obligation: ${witness.reasonCode}`);
  }
  await repository.transaction((tx) => tx.saveWitnessResult(witness, `witness:rules-v${rulesVersion}`));

  const state: BusinessState = {
    businessId,
    asOf: createdAt,
    availableBalanceMinor: (BigInt(amountMinor) * 3n).toString(),
    minimumReserveMinor: amountMinor,
    approvalThresholdMinor,
    currency: "USDC",
    tokenDecimals: 6,
    expectedInflows: [],
  };
  const planningObligation: PlanningObligation = {
    obligationId,
    vendorId,
    witnessVerdict: witness.verdict,
    evidenceRoot: witness.evidenceRoot,
    vendorVersion: witness.vendorVersion,
    amountMinor,
    currency: "USDC",
    tokenDecimals: 6,
    payee,
    dueDate: day,
    vendorCriticality: 5,
    lateFeeBps: 0,
    earlyPayDiscountBps: 0,
    earlyPayDeadline: null,
    partialPaymentAllowed: false,
  };
  const context = { state, obligations: [planningObligation] };
  const plan = await new BoundedDecisionAgent().createPlan(context);
  const validation = validatePaymentPlan(plan, context);
  if (!validation.valid || plan.decisions[0]?.action !== "PAY_NOW") {
    throw new Error("Decision Agent did not produce a validated PAY_NOW decision");
  }
  await repository.transaction((tx) => {
    tx.savePlan(plan);
    tx.transitionObligation(obligationId, "PLANNED", "decision-agent", null, createdAt);
  });

  const commitment = createDecisionCommitment({
    commitmentVersion: "1",
    receiptId: `receipt_${obligationId}`,
    businessId,
    vendorId,
    obligationId,
    classification: "TEST",
    agent: { ...plan.decisions[0]!, ...plan.agent, planId: plan.planId, businessStateHash: plan.businessStateHash },
    witness: {
      verdict: witness.verdict,
      reasonCode: witness.reasonCode,
      evidenceRoot: witness.evidenceRoot,
      checks: witness.checks,
      vendorVersion: witness.vendorVersion,
    },
    payment: { operationId, payee, token: config.usdcAddress, amountMinor },
    authorizationContext: {
      policyVersion,
      witnessVersion,
      rulesVersion,
      validUntilUnix,
      chainId: config.chainId,
      verifyingContract: config.vaultAddress,
    },
    createdAt,
  });

  const witnessSigner = new LocalPrivateKeyWitnessSigner(
    required("WITNESS_SIGNER_PRIVATE_KEY") as Hex,
    config.chainId,
    config.vaultAddress as Address,
  );
  if (witnessSigner.address.toLowerCase() !== config.witnessSignerAddress.toLowerCase()) {
    throw new Error("WITNESS_SIGNER_PRIVATE_KEY does not match deployed witness signer address");
  }
  const authorization = await new WitnessAuthorizationService(witnessSigner).issue(
    witness,
    validation,
    {
      operationId,
      businessId,
      vendorId,
      payee,
      token: config.usdcAddress as Address,
      amountMinor,
      decisionCommitmentHash: commitment.decisionCommitmentHash as Hex,
      validUntilUnix,
      chainId: config.chainId,
      verifyingContract: config.vaultAddress as Address,
      witnessVersion,
      rulesVersion,
    },
  );
  await repository.transaction((tx) => {
    tx.saveAuthorization({
      id: `auth_${obligationId}`,
      operationId,
      obligationId,
      decisionCommitmentHash: commitment.decisionCommitmentHash,
      attestationHash: authorization.attestationHash,
      payload: authorization,
      createdAt,
    });
    tx.transitionObligation(obligationId, "AUTHORIZED", `witness:v${witnessVersion}`, null, createdAt);
  });

  const publicClient = createPublicClient({ chain: arcTestnet, transport: http(config.rpcUrl) });
  const circleSigner = createCircleTransactionSigner(
    { apiKey: required("CIRCLE_API_KEY"), entitySecret: required("CIRCLE_ENTITY_SECRET") },
    config.circleWalletId,
  );
  const executor = new CircleArcExecutor(
    config,
    circleSigner,
    new RpcExecutionSimulator(publicClient, `-${amountMinor}`),
    publicClient,
  );
  const checkpointDirectory = ".euthyna";
  const checkpointPath = `${checkpointDirectory}/first-arc-broadcast.json`;
  await mkdir(checkpointDirectory, { recursive: true });
  try {
    const checkpoint = JSON.parse(await readFile(checkpointPath, "utf8")) as {
      obligationId?: string;
      attestationHash?: string;
      txHash?: Hex;
    };
    if (
      checkpoint.obligationId !== obligationId ||
      checkpoint.attestationHash?.toLowerCase() !== authorization.attestationHash.toLowerCase() ||
      !checkpoint.txHash
    ) {
      throw new Error("Existing broadcast checkpoint belongs to a different authorization");
    }
    // Do not race an accepted transaction with a retry. Wait for its receipt,
    // then let exact event reconciliation decide whether payment occurred.
    await publicClient.waitForTransactionReceipt({ hash: checkpoint.txHash });
  } catch (error) {
    const code = (error as NodeJS.ErrnoException).code;
    if (code !== "ENOENT") throw error;
  }
  const simulateCrash = process.env.FIRST_ARC_CRASH_AFTER_BROADCAST === "YES";
  const settlement = await executor.submit({
    attestation: authorization.attestation,
    witnessSignature: authorization.signature,
    ...(simulateCrash
      ? {
          afterBroadcast: (txHash: Hex) => {
            const checkpoint = {
              obligationId,
              operationId,
              attestationHash: authorization.attestationHash,
              txHash,
              state: "BROADCAST_BEFORE_RECONCILIATION",
            };
            writeFileSync(checkpointPath, `${JSON.stringify(checkpoint, null, 2)}\n`, { mode: 0o600 });
            writeFileSync(1, `${JSON.stringify({ simulatedCrashAfterBroadcast: true, txHash })}\n`);
            process.exit(86);
          },
        }
      : {}),
  });
  await repository.transaction((tx) => tx.saveSettlement(obligationId, settlement, "arc-reconciler"));
  await writeFile(
    checkpointPath,
    `${JSON.stringify(
      {
        obligationId,
        operationId,
        attestationHash: authorization.attestationHash,
        txHash: settlement.txHash,
        state: "RECONCILED",
      },
      null,
      2,
    )}\n`,
    { mode: 0o600 },
  );

  const finalReceipt = createDecisionReceipt({
    receiptId: commitment.receiptId,
    businessId,
    vendorId,
    obligationId,
    classification: "TEST",
    agent: commitment.agent,
    witness: commitment.witness,
    decisionCommitmentHash: commitment.decisionCommitmentHash,
    authorization: {
      policyVersion,
      attestationHash: authorization.attestationHash,
      validUntil: new Date(Number(validUntilUnix) * 1_000).toISOString(),
      signerVersion: `witness-v${witnessVersion}`,
    },
    settlement,
    humanAction: null,
    createdAt,
  });
  if (!verifyDecisionReceipt(finalReceipt)) throw new Error("Final receipt failed self-verification");
  await repository.transaction((tx) => tx.saveReceipt(finalReceipt));
  const output = {
    classification: "TEST",
    preflight,
    evidencePack: input.artifacts,
    witness,
    plan,
    validation,
    decisionCommitment: commitment,
    authorization,
    settlement,
    finalReceipt,
    auditEvents: repository.snapshot().auditEvents,
  };
  await mkdir("artifacts", { recursive: true });
  await writeFile("artifacts/first-arc-settlement.json", `${JSON.stringify(output, null, 2)}\n`, {
    mode: 0o644,
  });
  process.stdout.write(`${JSON.stringify({ settlement, finalReceiptHash: finalReceipt.finalReceiptHash }, null, 2)}\n`);
}

if (process.argv[1]?.endsWith("first-arc-settlement.js")) {
  main().catch((error: unknown) => {
    process.stderr.write(`${error instanceof Error ? error.message : "Unknown Arc settlement failure"}\n`);
    process.exitCode = 1;
  });
}
