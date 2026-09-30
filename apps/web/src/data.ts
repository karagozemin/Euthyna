export type Classification = "TEST" | "REAL";
export type WitnessVerdict = "VERIFIED" | "HOLD" | "REJECTED";
export type AgentAction = "PAY_NOW" | "SCHEDULE" | "ESCALATE" | "NOT_ELIGIBLE";
export type CheckStatus = "PASS" | "HOLD" | "REJECT";

export interface WitnessCheck {
  id: `W${number}`;
  name: string;
  status: CheckStatus;
  evidence: string[];
  expected?: string;
  observed?: string;
  reason?: string;
}

export interface EvidenceItem {
  type: "INVOICE" | "AGREEMENT" | "DELIVERY" | "PAYMENT_INSTRUCTION";
  label: string;
  summary: string;
  fingerprint: string;
}

export interface DemoObligation {
  id: string;
  scenario: ScenarioSlug;
  classification: Classification;
  vendor: string;
  invoice: string;
  amount: string;
  amountMinor: number;
  dueDate: string;
  state: "SETTLED" | "VERIFIED" | "HOLD" | "REJECTED";
  witnessVerdict: WitnessVerdict;
  agentAction: AgentAction;
  reason: string;
  evidenceRoot: string;
  settlementStatus: "RECONCILED" | "NOT_SUBMITTED" | "SCHEDULED";
}

export type ScenarioSlug = "valid" | "prioritization" | "duplicate" | "destination-change";

export interface Scenario {
  slug: ScenarioSlug;
  letter: "A" | "B" | "C" | "D";
  eyebrow: string;
  title: string;
  summary: string;
  outcome: string;
  tone: "verified" | "decision" | "rejected" | "hold";
  moved: string;
  obligations: DemoObligation[];
  evidence: EvidenceItem[];
  checks: WitnessCheck[];
  rationale: string;
  reasonCodes: string[];
  requiredAction?: string;
}

export const ARC_PROOF = {
  classification: "TEST" as const,
  network: "Arc Testnet",
  chainId: 5_042_002,
  vault: "0x61322f6e21ec822cb220b145fb9184265a580b12",
  vaultExplorer: "https://explorer.testnet.arc.io/address/0x61322f6e21ec822cb220b145fb9184265a580b12",
  transaction: "0xb386d3041613b028bc6aa88518e8a010b01b1c0eb59aca632da4eefc4fac6b42",
  transactionExplorer:
    "https://explorer.testnet.arc.io/tx/0xb386d3041613b028bc6aa88518e8a010b01b1c0eb59aca632da4eefc4fac6b42",
  settlementBlock: "64819572",
  operationId: "op_arc_test_001_release_1",
  operationIdHash: "0x43708ead7ef24e9f70797b8e66bae029ba506e0c1a0ec487fa246054500891b3",
  evidenceRoot: "0x0358f0605038371dc683a0913ce99a2158866598ce1cf0d94cec84e651b05de4",
  decisionCommitment: "0x9f95e48beff1e2494da9ba19fd9b282aa22f989cb253f99f851711481344f685",
  attestationHash: "0x0d15a44772bbcca032a431f8279b7dae4d08c41dc3b950801d04a38bac9b140f",
  finalReceiptHash: "0xe6e6445c09817d10ee9efad3ef5875fd2a401ad319242f9e91db3b42eb2d17de",
  settledAmount: "0.001 USDC",
  finalizedAt: "2026-09-30T18:32:44.000Z",
} as const;

const checkDefinitions = [
  ["W01", "Required evidence classes are present", ["Invoice", "Agreement", "Delivery"]],
  ["W02", "Vendor identity matches agreement and invoice", ["Invoice", "Agreement"]],
  ["W03", "Currency and amount agree", ["Invoice", "Agreement"]],
  ["W04", "Agreement is active for this obligation", ["Agreement"]],
  ["W05", "Delivery satisfies the release condition", ["Delivery"]],
  ["W06", "Obligation is not a semantic duplicate", ["Invoice", "Prior obligations"]],
  ["W07", "Payout destination is the verified destination", ["Invoice", "Vendor record"]],
  ["W08", "Obligation has not already settled", ["Settlement history"]],
  ["W09", "Evidence timestamps and versions are fresh", ["All evidence"]],
  ["W10", "Payment fields are resolved and unambiguous", ["Invoice", "Agreement", "Delivery"]],
] as const;

function passingChecks(): WitnessCheck[] {
  return checkDefinitions.map(([id, name, evidence]) => ({
    id,
    name,
    status: "PASS",
    evidence: [...evidence],
  }));
}

function checksWith(
  id: WitnessCheck["id"],
  status: Exclude<CheckStatus, "PASS">,
  details: Pick<WitnessCheck, "expected" | "observed" | "reason">,
): WitnessCheck[] {
  return passingChecks().map((check) => (check.id === id ? { ...check, status, ...details } : check));
}

const publicEvidence: EvidenceItem[] = [
  {
    type: "INVOICE",
    label: "Invoice · redacted fixture",
    summary: "Vendor, amount, due date and payout destination normalized.",
    fingerprint: "sha256:9d3c…71a0",
  },
  {
    type: "AGREEMENT",
    label: "Agreement · redacted fixture",
    summary: "Active agreement and payment terms confirmed.",
    fingerprint: "sha256:21e8…0f44",
  },
  {
    type: "DELIVERY",
    label: "Delivery acceptance · redacted fixture",
    summary: "Release condition accepted before authorization.",
    fingerprint: "sha256:715b…c832",
  },
];

const valid: DemoObligation = {
  id: "obl_arc_test_001",
  scenario: "valid",
  classification: "TEST",
  vendor: "Arc Test Vendor",
  invoice: "INV-ARC-001",
  amount: "0.001 USDC",
  amountMinor: 1_000,
  dueDate: "Sep 30, 2026",
  state: "SETTLED",
  witnessVerdict: "VERIFIED",
  agentAction: "PAY_NOW",
  reason: "Due now · critical vendor · all evidence agrees",
  evidenceRoot: ARC_PROOF.evidenceRoot,
  settlementStatus: "RECONCILED",
};

const priorityRoots = [
  "0x6d9524a084a73e3747bc428ca868115b34c88f3b4f4a2a5a49fa18024dd84f7c",
  "0xe7ff0b39c65d20fd1b7bfabfc1bf7ddf4b731fa18878b864b4174bfa4f4072ac",
  "0x72fdd45abe11f3f6fd3fe10a4e2c9ac4e624a724f7cced09a8e9f27a8ce91a81",
];

const priorityObligations: DemoObligation[] = [
  {
    id: "obl_demo_critical",
    scenario: "prioritization",
    classification: "TEST",
    vendor: "Northstar Infrastructure",
    invoice: "NS-600",
    amount: "600 USDC",
    amountMinor: 600_000_000,
    dueDate: "Today",
    state: "VERIFIED",
    witnessVerdict: "VERIFIED",
    agentAction: "PAY_NOW",
    reason: "Critical supplier · due today · highest interruption risk",
    evidenceRoot: priorityRoots[0]!,
    settlementStatus: "NOT_SUBMITTED",
  },
  {
    id: "obl_demo_discount",
    scenario: "prioritization",
    classification: "TEST",
    vendor: "LedgerWorks",
    invoice: "LW-400",
    amount: "400 USDC",
    amountMinor: 400_000_000,
    dueDate: "In 10 days",
    state: "VERIFIED",
    witnessVerdict: "VERIFIED",
    agentAction: "SCHEDULE",
    reason: "4% discount noted · schedule after expected inflow",
    evidenceRoot: priorityRoots[1]!,
    settlementStatus: "SCHEDULED",
  },
  {
    id: "obl_demo_standard",
    scenario: "prioritization",
    classification: "TEST",
    vendor: "Harbor Supply",
    invoice: "HS-300",
    amount: "300 USDC",
    amountMinor: 300_000_000,
    dueDate: "Today",
    state: "VERIFIED",
    witnessVerdict: "VERIFIED",
    agentAction: "SCHEDULE",
    reason: "Lower criticality · reserve takes precedence",
    evidenceRoot: priorityRoots[2]!,
    settlementStatus: "SCHEDULED",
  },
];

const duplicate: DemoObligation = {
  id: "obl_demo_duplicate",
  scenario: "duplicate",
  classification: "TEST",
  vendor: "Arc Test Vendor",
  invoice: "inv arc 001 · reformatted",
  amount: "0.001 USDC",
  amountMinor: 1_000,
  dueDate: "Sep 30, 2026",
  state: "REJECTED",
  witnessVerdict: "REJECTED",
  agentAction: "NOT_ELIGIBLE",
  reason: "Semantic fingerprint matches an already settled obligation",
  evidenceRoot: "0xbfde9c64ea9310e33d61e8ba4a52f341d50b17d9aab040f775807cf9851e9d85",
  settlementStatus: "NOT_SUBMITTED",
};

const destinationChange: DemoObligation = {
  id: "obl_demo_destination_change",
  scenario: "destination-change",
  classification: "TEST",
  vendor: "Acme Design Ltd",
  invoice: "INV-1042",
  amount: "125 USDC",
  amountMinor: 125_000_000,
  dueDate: "Today",
  state: "HOLD",
  witnessVerdict: "HOLD",
  agentAction: "NOT_ELIGIBLE",
  reason: "PAYOUT_DESTINATION_CHANGED",
  evidenceRoot: "0x1e62ffae2861dd5106fda5fe33fcc790bf2d1d2863018f68bff83c22971b71aa",
  settlementStatus: "NOT_SUBMITTED",
};

export const SCENARIOS: Scenario[] = [
  {
    slug: "valid",
    letter: "A",
    eyebrow: "Proof before payment",
    title: "Valid obligation",
    summary: "Invoice, agreement and delivery agree. The exact authorization settles once on Arc.",
    outcome: "VERIFIED → PAY_NOW → SETTLED",
    tone: "verified",
    moved: ARC_PROOF.settledAmount,
    obligations: [valid],
    evidence: publicEvidence,
    checks: passingChecks(),
    rationale: "The obligation is due, all deterministic checks pass, and the payment remains within policy.",
    reasonCodes: ["DUE_OR_OVERDUE", "CRITICAL_VENDOR"],
  },
  {
    slug: "prioritization",
    letter: "B",
    eyebrow: "Agentic sophistication",
    title: "Constrained-cash prioritization",
    summary: "Three legitimate obligations compete for limited USDC. The Agent chooses timing; the Witness does not.",
    outcome: "1 PAY_NOW · 2 SCHEDULE",
    tone: "decision",
    moved: "$0 · decision preview",
    obligations: priorityObligations,
    evidence: publicEvidence,
    checks: passingChecks(),
    rationale:
      "Pay the critical supplier now, preserve the 300 USDC minimum reserve, then schedule the other obligations against the expected inflow.",
    reasonCodes: ["CRITICAL_VENDOR", "DUE_OR_OVERDUE", "PRESERVE_RESERVE", "EXPECTED_INFLOW"],
  },
  {
    slug: "duplicate",
    letter: "C",
    eyebrow: "Business-level replay defense",
    title: "Duplicate obligation",
    summary: "A reformatted invoice represents the same underlying obligation that already settled.",
    outcome: "REJECTED · DUPLICATE_OBLIGATION",
    tone: "rejected",
    moved: "$0 moved",
    obligations: [duplicate],
    evidence: publicEvidence.map((item, index) =>
      index === 0 ? { ...item, label: "Invoice variant · formatting changed", fingerprint: "sha256:4b92…aac1" } : item,
    ),
    checks: checksWith("W06", "REJECT", {
      expected: "A new business obligation",
      observed: "Semantic match: obl_arc_test_001 · already settled",
      reason: "DUPLICATE_OBLIGATION",
    }),
    rationale: "The Agent never receives a rejected obligation and no signing request is constructed.",
    reasonCodes: ["DUPLICATE_OBLIGATION", "ALREADY_SETTLED"],
  },
  {
    slug: "destination-change",
    letter: "D",
    eyebrow: "Payment redirection defense",
    title: "Payout destination changed",
    summary: "Every business fact agrees except the newly requested payout address.",
    outcome: "HOLD · PAYOUT_DESTINATION_CHANGED",
    tone: "hold",
    moved: "$0 moved",
    obligations: [destinationChange],
    evidence: [
      ...publicEvidence,
      {
        type: "PAYMENT_INSTRUCTION",
        label: "New payout instruction · redacted",
        summary: "A destination not present in the verified vendor version was requested.",
        fingerprint: "sha256:a7c2…e118",
      },
    ],
    checks: checksWith("W07", "HOLD", {
      expected: "0x1111…1111 · verified vendor destination",
      observed: "0x2222…2222 · newly requested destination",
      reason: "PAYOUT_DESTINATION_CHANGED",
    }),
    rationale: "Destination changes require out-of-band owner verification. The Agent and signing path are not reached.",
    reasonCodes: ["PAYOUT_DESTINATION_CHANGED"],
    requiredAction: "Owner must re-verify the vendor destination out of band. Vendor remains on version 3.",
  },
];

export const OBLIGATIONS = SCENARIOS.flatMap((scenario) => scenario.obligations);

export const DEMO_METRICS = {
  classification: "TEST" as const,
  obligationsProcessed: OBLIGATIONS.length,
  totalPaymentVolume: ARC_PROOF.settledAmount,
  duplicateObligationsCaught: 1,
  obligationsSettledAutonomously: 1,
  decisions: 4,
  escalations: 1,
  humanAgreementRate: "N/A · no reviewed pilot decisions",
  holdEvents: 1,
  payoutDestinationChangesCaught: 1,
  settlementSuccessRate: "100% · 1 of 1 submitted",
};

export const REAL_METRICS = {
  classification: "REAL" as const,
  obligationsProcessed: 0,
  totalPaymentVolume: "0 USDC",
  duplicateObligationsCaught: 0,
  obligationsSettledAutonomously: 0,
  decisions: 0,
  escalations: 0,
  humanAgreementRate: "N/A · pilot not onboarded",
  holdEvents: 0,
  payoutDestinationChangesCaught: 0,
  settlementSuccessRate: "N/A · no real submissions",
};

export function getScenario(slug: string | undefined): Scenario | undefined {
  return SCENARIOS.find((scenario) => scenario.slug === slug);
}

export function shortHash(value: string): string {
  return `${value.slice(0, 8)}…${value.slice(-6)}`;
}
