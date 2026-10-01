import { useEffect, useMemo, useState, type ChangeEvent, type FormEvent, type ReactNode } from "react";

type ApiStatus = "checking" | "online" | "offline";
type EvidenceType = "INVOICE" | "AGREEMENT" | "DELIVERY" | "PAYMENT_INSTRUCTION";

interface PilotDraft {
  privateBusinessLegalName: string;
  privateVendorLegalName: string;
  businessAlias: string;
  vendorAlias: string;
  invoiceNumber: string;
  invoiceDate: string;
  agreementReference: string;
  agreementStartsOn: string;
  agreementEndsOn: string;
  agreementActiveConfirmed: boolean;
  deliveryAcceptedConfirmed: boolean;
  amountUsdc: string;
  dueDate: string;
  payoutDestination: string;
  destinationVerified: boolean;
  lineItemDescription: string;
  availableBalanceUsdc: string;
  minimumReserveUsdc: string;
  approvalThresholdUsdc: string;
  vendorCriticality: number;
  processConsentReference: string;
  publicMetricsConsent: boolean;
  publicMetricsReference: string;
  settlementConsent: boolean;
  settlementReference: string;
  settlementScope: "NONE" | "ARC_TESTNET" | "REAL_USDC";
  amountDisclosure: "NONE" | "EXACT" | "RANGE";
  amountRangeLabel: string;
  discloseEvidenceRoot: boolean;
  discloseSettlementTxHash: boolean;
  includeInAggregateVolume: boolean;
}

interface PilotResult {
  classification: "REAL";
  pilotId: string;
  publicId: string;
  privateStorage: string;
  evidenceTypes: EvidenceType[];
  witness: {
    verdict: "VERIFIED" | "HOLD" | "REJECT";
    reasonCode: string | null;
    evidenceRoot: string;
    requiredAction: string | null;
    checks: Array<{ id: string; name: string; status: "PASS" | "FAIL"; reasonCode: string | null }>;
  };
  decision: null | { action: string; rationale: string; reasonCodes: string[]; confidenceBps: number };
  validation: null | { valid: boolean; projectedImmediateBalanceMinor: string; errors: Array<{ code: string; message: string }> };
  settlementEligible: boolean;
  settlementConsentScope: "NONE" | "ARC_TESTNET" | "REAL_USDC";
  settlementBroadcast: false;
}

const apiBase = `${import.meta.env.BASE_URL}pilot-api`;
const isLocalPilotApi = import.meta.env.DEV;

function isoDay(offsetDays = 0): string {
  const date = new Date();
  date.setUTCDate(date.getUTCDate() + offsetDays);
  return date.toISOString().slice(0, 10);
}

const initialDraft: PilotDraft = {
  privateBusinessLegalName: "",
  privateVendorLegalName: "",
  businessAlias: "Pilot Business A",
  vendorAlias: "Supplier A",
  invoiceNumber: "",
  invoiceDate: isoDay(),
  agreementReference: "",
  agreementStartsOn: isoDay(-30),
  agreementEndsOn: isoDay(365),
  agreementActiveConfirmed: false,
  deliveryAcceptedConfirmed: false,
  amountUsdc: "",
  dueDate: isoDay(7),
  payoutDestination: "",
  destinationVerified: false,
  lineItemDescription: "",
  availableBalanceUsdc: "",
  minimumReserveUsdc: "",
  approvalThresholdUsdc: "",
  vendorCriticality: 3,
  processConsentReference: "",
  publicMetricsConsent: false,
  publicMetricsReference: "not-granted",
  settlementConsent: false,
  settlementReference: "not-granted",
  settlementScope: "NONE",
  amountDisclosure: "NONE",
  amountRangeLabel: "",
  discloseEvidenceRoot: false,
  discloseSettlementTxHash: false,
  includeInAggregateVolume: false,
};

function Field({ label, hint, children }: { label: string; hint?: string; children: ReactNode }) {
  return <label className="pilot-field"><span>{label}</span>{children}{hint ? <small>{hint}</small> : null}</label>;
}

function CheckField({ checked, onChange, children }: { checked: boolean; onChange: (checked: boolean) => void; children: ReactNode }) {
  return <label className="pilot-check"><input type="checkbox" checked={checked} onChange={(event) => onChange(event.target.checked)} /><span>{children}</span></label>;
}

async function fileBase64(file: File): Promise<string> {
  if (file.size > 25 * 1024 * 1024) throw new Error(`${file.name} exceeds the 25 MiB private-file limit.`);
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onerror = () => reject(new Error(`Could not read ${file.name}.`));
    reader.onload = () => {
      const value = String(reader.result);
      resolve(value.slice(value.indexOf(",") + 1));
    };
    reader.readAsDataURL(file);
  });
}

export function PilotPageContent() {
  const [apiStatus, setApiStatus] = useState<ApiStatus>("checking");
  const [step, setStep] = useState(1);
  const [draft, setDraft] = useState<PilotDraft>(initialDraft);
  const [documents, setDocuments] = useState<Partial<Record<EvidenceType, File>>>({});
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState("");
  const [result, setResult] = useState<PilotResult | null>(null);

  function checkApi() {
    setApiStatus("checking");
    fetch(`${apiBase}/health`, { cache: "no-store" })
      .then(async (response) => {
        if (!response.ok || !response.headers.get("content-type")?.includes("application/json")) throw new Error("Private API unavailable");
        const body = await response.json() as { service?: string };
        if (body.service !== "euthyna-private-pilot") throw new Error("Unexpected service");
        setApiStatus("online");
      })
      .catch(() => setApiStatus("offline"));
  }

  useEffect(checkApi, []);

  const uploadedTypes = useMemo(() => Object.entries(documents).filter((entry): entry is [EvidenceType, File] => Boolean(entry[1])), [documents]);
  const set = <K extends keyof PilotDraft>(key: K, value: PilotDraft[K]) => setDraft((current) => ({ ...current, [key]: value }));
  const fileChange = (type: EvidenceType) => (event: ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    setDocuments((current) => ({ ...current, [type]: file }));
  };

  function next(event: FormEvent) {
    event.preventDefault();
    setError("");
    setStep((current) => Math.min(4, current + 1));
    window.scrollTo({ top: 0, behavior: "smooth" });
  }

  async function evaluate(event: FormEvent) {
    event.preventDefault();
    if (apiStatus !== "online") return setError("The private pilot API is unavailable. Retry the connection before submitting evidence.");
    if (uploadedTypes.length === 0) return setError("Upload at least one private evidence document.");
    setSubmitting(true);
    setError("");
    try {
      const encodedDocuments = await Promise.all(uploadedTypes.map(async ([type, file]) => ({
        type,
        fileName: file.name,
        mimeType: file.type || "application/octet-stream",
        base64: await fileBase64(file),
      })));
      const response = await fetch(`${apiBase}/v1/pilots/intake-and-evaluate`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          ...draft,
          processConsent: { granted: true, reference: draft.processConsentReference },
          publicMetricsConsent: { granted: draft.publicMetricsConsent, reference: draft.publicMetricsReference },
          settlementConsent: { granted: draft.settlementConsent, reference: draft.settlementReference, scope: draft.settlementScope },
          amountRangeLabel: draft.amountDisclosure === "RANGE" ? draft.amountRangeLabel : null,
          documents: encodedDocuments,
          processConsentReference: undefined,
          publicMetricsReference: undefined,
          settlementReference: undefined,
          settlementScope: undefined,
        }),
      });
      const body = await response.json() as PilotResult | { message?: string };
      if (!response.ok) throw new Error("message" in body ? body.message : "Private evaluation failed.");
      setResult(body as PilotResult);
      setStep(5);
      window.scrollTo({ top: 0, behavior: "smooth" });
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "Private evaluation failed.");
    } finally {
      setSubmitting(false);
    }
  }

  if (result) return <PilotResultView result={result} />;

  return (
    <div className="pilot-page">
      <section className="pilot-hero section-pad">
        <div><span className="kicker">Private operator session</span><h1>Run a real obligation.<br /><em>Keep the evidence private.</em></h1><p>Source documents go only to the pilot API. The unchanged Witness and bounded Agent evaluate a REAL record; no browser key or document enters the public bundle.</p></div>
        <div className={`pilot-runtime pilot-runtime--${apiStatus}`}><span>{apiStatus === "online" ? "● PRIVATE API ONLINE" : apiStatus === "checking" ? "○ CHECKING PRIVATE API" : "× PRIVATE API OFFLINE"}</span><strong>{isLocalPilotApi ? "127.0.0.1:8787" : "euthyna.onrender.com"}</strong><small>{isLocalPilotApi ? "Localhost operator runtime" : "Hosted on Render · encrypted in transit"}</small>{apiStatus === "offline" ? <button type="button" onClick={checkApi}>Retry connection</button> : null}</div>
      </section>

      {apiStatus === "offline" ? <section className="pilot-offline section-pad"><div><span className="kicker">Private API unavailable</span><h2>{isLocalPilotApi ? "Start the private workflow locally." : "The hosted pilot service is not responding."}</h2><p>{isLocalPilotApi ? <>Run <code>pnpm pilot:ui</code> from the repository, then open <code>http://localhost:5173/pilot</code>.</> : <>The Render service may be waking up. Wait a moment, then retry the connection.</>}</p></div></section> : null}

      <section className="pilot-workspace section-pad">
        <nav className="pilot-steps" aria-label="Private pilot steps">
          {["Obligation", "Evidence", "Consent & economics", "Review & evaluate"].map((label, index) => <div className={step === index + 1 ? "pilot-step pilot-step--active" : step > index + 1 ? "pilot-step pilot-step--done" : "pilot-step"} key={label}><span>{step > index + 1 ? "✓" : index + 1}</span><strong>{label}</strong></div>)}
        </nav>

        <div className="pilot-form-shell">
          {step === 1 ? <form onSubmit={next}><div className="pilot-form-head"><span>01</span><div><h2>Business obligation</h2><p>Private names remain in the private server record. Public aliases are the only names eligible for reviewer proof.</p></div></div><div className="pilot-grid">
            <Field label="Business legal name"><input required value={draft.privateBusinessLegalName} onChange={(e) => set("privateBusinessLegalName", e.target.value)} /></Field>
            <Field label="Public business alias"><input required value={draft.businessAlias} onChange={(e) => set("businessAlias", e.target.value)} /></Field>
            <Field label="Vendor legal name"><input required value={draft.privateVendorLegalName} onChange={(e) => set("privateVendorLegalName", e.target.value)} /></Field>
            <Field label="Public vendor alias"><input required value={draft.vendorAlias} onChange={(e) => set("vendorAlias", e.target.value)} /></Field>
            <Field label="Invoice number"><input required value={draft.invoiceNumber} onChange={(e) => set("invoiceNumber", e.target.value)} /></Field>
            <Field label="Invoice date"><input required type="date" value={draft.invoiceDate} onChange={(e) => set("invoiceDate", e.target.value)} /></Field>
            <Field label="Agreement / PO reference"><input required value={draft.agreementReference} onChange={(e) => set("agreementReference", e.target.value)} /></Field>
            <Field label="Due date"><input required type="date" value={draft.dueDate} onChange={(e) => set("dueDate", e.target.value)} /></Field>
            <Field label="Amount (USDC)"><input required inputMode="decimal" pattern="(0|[1-9][0-9]*)(\.[0-9]{1,6})?" value={draft.amountUsdc} onChange={(e) => set("amountUsdc", e.target.value)} /></Field>
            <Field label="Line item / obligation"><input required value={draft.lineItemDescription} onChange={(e) => set("lineItemDescription", e.target.value)} /></Field>
            <Field label="Payout destination" hint="Arc-compatible 0x address"><input required pattern="0x[0-9a-fA-F]{40}" value={draft.payoutDestination} onChange={(e) => set("payoutDestination", e.target.value)} /></Field>
          </div><div className="pilot-actions"><button className="button button--primary" type="submit">Continue to evidence →</button></div></form> : null}

          {step === 2 ? <form onSubmit={next}><div className="pilot-form-head"><span>02</span><div><h2>Private evidence</h2><p>Upload what actually exists. Missing evidence must produce HOLD; do not manufacture a complete pack.</p></div></div><div className="pilot-upload-grid">
            {(["INVOICE", "AGREEMENT", "DELIVERY", "PAYMENT_INSTRUCTION"] as EvidenceType[]).map((type) => <label className={documents[type] ? "pilot-upload pilot-upload--ready" : "pilot-upload"} key={type}><span>{documents[type] ? "✓" : "+"}</span><strong>{type.replaceAll("_", " ")}</strong><small>{documents[type]?.name ?? "PDF, image, or text · max 25 MiB"}</small><input type="file" accept=".pdf,.png,.jpg,.jpeg,.txt,application/pdf,image/png,image/jpeg,text/plain" onChange={fileChange(type)} /></label>)}
          </div><div className="pilot-confirmations"><div className="pilot-grid"><Field label="Agreement starts"><input required type="date" value={draft.agreementStartsOn} onChange={(e) => set("agreementStartsOn", e.target.value)} /></Field><Field label="Agreement ends"><input required type="date" value={draft.agreementEndsOn} onChange={(e) => set("agreementEndsOn", e.target.value)} /></Field></div><CheckField checked={draft.agreementActiveConfirmed} onChange={(value) => set("agreementActiveConfirmed", value)}>Operator confirms the uploaded agreement is active for this obligation.</CheckField><CheckField checked={draft.deliveryAcceptedConfirmed} onChange={(value) => set("deliveryAcceptedConfirmed", value)}>Operator confirms the uploaded delivery or milestone proof shows acceptance.</CheckField><CheckField checked={draft.destinationVerified} onChange={(value) => set("destinationVerified", value)}>Payout destination was verified out of band with the vendor.</CheckField></div><div className="pilot-actions"><button className="button button--secondary" type="button" onClick={() => setStep(1)}>← Back</button><button className="button button--primary" type="submit">Continue to consent →</button></div></form> : null}

          {step === 3 ? <form onSubmit={next}><div className="pilot-form-head"><span>03</span><div><h2>Consent and economics</h2><p>These are independent permissions. Processing consent never implies publication or payment consent.</p></div></div><div className="pilot-consent-block"><CheckField checked onChange={() => undefined}>Business grants private evidence processing for this obligation. Required to continue.</CheckField><Field label="Processing consent reference" hint="Private email, form, or approval reference"><input required value={draft.processConsentReference} onChange={(e) => set("processConsentReference", e.target.value)} /></Field></div><div className="pilot-consent-block"><CheckField checked={draft.publicMetricsConsent} onChange={(value) => set("publicMetricsConsent", value)}>Business permits redacted metrics and aliases in public reviewer proof.</CheckField>{draft.publicMetricsConsent ? <><Field label="Public consent reference"><input required value={draft.publicMetricsReference === "not-granted" ? "" : draft.publicMetricsReference} onChange={(e) => set("publicMetricsReference", e.target.value)} /></Field><div className="pilot-grid"><Field label="Amount disclosure"><select value={draft.amountDisclosure} onChange={(e) => set("amountDisclosure", e.target.value as PilotDraft["amountDisclosure"])}><option value="NONE">Do not disclose</option><option value="EXACT">Exact amount</option><option value="RANGE">Consented range</option></select></Field>{draft.amountDisclosure === "RANGE" ? <Field label="Public range label"><input required placeholder="$100–$500" value={draft.amountRangeLabel} onChange={(e) => set("amountRangeLabel", e.target.value)} /></Field> : null}</div><CheckField checked={draft.discloseEvidenceRoot} onChange={(value) => set("discloseEvidenceRoot", value)}>Allow evidence root in public proof.</CheckField><CheckField checked={draft.includeInAggregateVolume} onChange={(value) => set("includeInAggregateVolume", value)}>Include settlement amount in aggregate REAL volume.</CheckField></> : null}</div><div className="pilot-consent-block"><CheckField checked={draft.settlementConsent} onChange={(value) => { set("settlementConsent", value); set("settlementScope", value ? "ARC_TESTNET" : "NONE"); }}>Business permits a settlement only within the selected scope.</CheckField>{draft.settlementConsent ? <div className="pilot-grid"><Field label="Settlement scope"><select value={draft.settlementScope} onChange={(e) => set("settlementScope", e.target.value as PilotDraft["settlementScope"])}><option value="ARC_TESTNET">Arc Testnet</option><option value="REAL_USDC">Real USDC</option></select></Field><Field label="Settlement consent reference"><input required value={draft.settlementReference === "not-granted" ? "" : draft.settlementReference} onChange={(e) => set("settlementReference", e.target.value)} /></Field></div> : null}</div><h3 className="pilot-subhead">Economic context</h3><div className="pilot-grid"><Field label="Available balance (USDC)"><input required inputMode="decimal" value={draft.availableBalanceUsdc} onChange={(e) => set("availableBalanceUsdc", e.target.value)} /></Field><Field label="Minimum reserve (USDC)"><input required inputMode="decimal" value={draft.minimumReserveUsdc} onChange={(e) => set("minimumReserveUsdc", e.target.value)} /></Field><Field label="Autonomous approval limit (USDC)"><input required inputMode="decimal" value={draft.approvalThresholdUsdc} onChange={(e) => set("approvalThresholdUsdc", e.target.value)} /></Field><Field label="Vendor criticality"><select value={draft.vendorCriticality} onChange={(e) => set("vendorCriticality", Number(e.target.value))}>{[1,2,3,4,5].map((value) => <option value={value} key={value}>{value} / 5</option>)}</select></Field></div><div className="pilot-actions"><button className="button button--secondary" type="button" onClick={() => setStep(2)}>← Back</button><button className="button button--primary" type="submit">Review REAL record →</button></div></form> : null}

          {step === 4 ? <form onSubmit={evaluate}><div className="pilot-form-head"><span>04</span><div><h2>Evaluate the real obligation</h2><p>The server will hash private bytes, run W01–W10, and invoke the Agent only if the Witness returns VERIFIED.</p></div></div><div className="pilot-review"><div><span>Classification</span><strong>REAL</strong></div><div><span>Business / vendor</span><strong>{draft.businessAlias} · {draft.vendorAlias}</strong></div><div><span>Obligation</span><strong>{draft.amountUsdc} USDC · due {draft.dueDate}</strong></div><div><span>Evidence received</span><strong>{uploadedTypes.length ? uploadedTypes.map(([type]) => type).join(" · ") : "NONE — will HOLD"}</strong></div><div><span>Public metrics consent</span><strong>{draft.publicMetricsConsent ? "GRANTED" : "NOT GRANTED"}</strong></div><div><span>Settlement consent</span><strong>{draft.settlementConsent ? draft.settlementScope : "NOT GRANTED"}</strong></div></div><div className="pilot-privacy-lock"><strong>Private boundary</strong><span>Files will be written under the server's private <code>.euthyna/pilots/</code> directory. Raw contents are never returned to reviewer mode.</span></div>{error ? <p className="pilot-error">{error}</p> : null}<div className="pilot-actions"><button className="button button--secondary" type="button" onClick={() => setStep(3)} disabled={submitting}>← Back</button><button className="button button--primary" type="submit" disabled={submitting || apiStatus !== "online"}>{submitting ? "Hashing and evaluating…" : "Run Witness & Agent"}</button></div></form> : null}
        </div>
      </section>
    </div>
  );
}

function PilotResultView({ result }: { result: PilotResult }) {
  const verdictTone = result.witness.verdict === "VERIFIED" ? "verified" : result.witness.verdict === "HOLD" ? "hold" : "rejected";
  const [feedback, setFeedback] = useState({
    witnessAgreement: "YES",
    agentAgreement: result.decision ? "YES" : "NOT_ASKED",
    preferredAction: result.decision?.action ?? (result.witness.verdict === "HOLD" ? "HOLD" : "REJECT"),
    frictionNotesPrivate: "",
    wouldUseAgain: "YES",
  });
  const [feedbackStatus, setFeedbackStatus] = useState<"idle" | "saving" | "saved" | "error">("idle");
  const [feedbackError, setFeedbackError] = useState("");

  async function saveFeedback(event: FormEvent) {
    event.preventDefault();
    setFeedbackStatus("saving");
    setFeedbackError("");
    try {
      const response = await fetch(`${apiBase}/v1/pilots/${result.pilotId}/feedback`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(feedback),
      });
      const body = await response.json() as { message?: string };
      if (!response.ok) throw new Error(body.message ?? "Feedback could not be saved.");
      setFeedbackStatus("saved");
    } catch (reason) {
      setFeedbackStatus("error");
      setFeedbackError(reason instanceof Error ? reason.message : "Feedback could not be saved.");
    }
  }

  return <div className="pilot-page">
    <section className="pilot-result-hero section-pad">
      <div><span className="pilot-real-label">REAL · PRIVATE RESULT</span><h1>{result.witness.verdict}</h1><p>{result.witness.reasonCode ? result.witness.reasonCode.replaceAll("_", " ") : "All required business-truth checks passed."}</p></div>
      <div className={`pilot-result-seal pilot-result-seal--${verdictTone}`}><span>{result.witness.verdict === "VERIFIED" ? "✓" : "!"}</span><strong>{result.decision?.action ?? "NO AGENT DECISION"}</strong><small>{result.publicId}</small></div>
    </section>
    <section className="pilot-result-grid section-pad">
      <div className="pilot-result-main">
        <div className="pilot-result-head"><div><span className="kicker">Evidence Witness</span><h2>W01–W10 result</h2></div><code>{result.witness.evidenceRoot}</code></div>
        <div className="pilot-result-checks">{result.witness.checks.map((check) => <div className={check.status === "PASS" ? "pilot-result-check pilot-result-check--pass" : "pilot-result-check pilot-result-check--fail"} key={check.id}><span>{check.id}</span><strong>{check.name}</strong><em>{check.status}</em>{check.reasonCode ? <small>{check.reasonCode}</small> : null}</div>)}</div>
        {result.witness.requiredAction ? <div className="pilot-required"><strong>Required human action</strong><span>{result.witness.requiredAction.replaceAll("_", " ")}</span></div> : null}
      </div>
      <aside className="pilot-result-side">
        <div><span className="kicker">Decision Agent</span><h2>{result.decision?.action ?? "Not invoked"}</h2><p>{result.decision?.rationale ?? "The Agent is intentionally not called unless the Witness verifies the obligation."}</p>{result.decision ? <div className="reason-codes">{result.decision.reasonCodes.map((code) => <span className="badge" key={code}>{code.replaceAll("_", " ")}</span>)}</div> : null}</div>
        <div className="pilot-settlement-state"><span className="kicker">Settlement boundary</span><h3>{result.settlementEligible ? "Eligible for authorization" : "Not eligible"}</h3><p>{result.settlementEligible ? `Consent scope: ${result.settlementConsentScope}. No transaction has been broadcast; a business-bound vault and configured operator executor are still required.` : "No transaction was requested. Witness, Agent, consent, and policy gates must all pass."}</p><strong>TRANSACTION: NOT SUBMITTED</strong></div>
        <div className="pilot-private-record"><span>Private record</span><code>{result.privateStorage}</code><small>Ignored by git · mode 600 source files</small></div>
      </aside>
    </section>
    <section className="pilot-feedback section-pad">
      <div className="pilot-feedback-copy"><span className="kicker">Pilot learning</span><h2>Capture the business response.</h2><p>These answers remain private. Only consented aggregate agreement counts can be published later.</p></div>
      <form onSubmit={saveFeedback}>
        <div className="pilot-grid">
          <Field label="Agree with Witness?"><select value={feedback.witnessAgreement} onChange={(e) => setFeedback((value) => ({ ...value, witnessAgreement: e.target.value }))}><option value="YES">Yes</option><option value="PARTIAL">Partially</option><option value="NO">No</option></select></Field>
          <Field label="Agree with Agent?"><select value={feedback.agentAgreement} onChange={(e) => setFeedback((value) => ({ ...value, agentAgreement: e.target.value }))}><option value="YES">Yes</option><option value="PARTIAL">Partially</option><option value="NO">No</option>{!result.decision ? <option value="NOT_ASKED">Not asked</option> : null}</select></Field>
          <Field label="What would they have done?"><select value={feedback.preferredAction} onChange={(e) => setFeedback((value) => ({ ...value, preferredAction: e.target.value }))}>{["PAY_NOW", "SCHEDULE", "HOLD", "REJECT", "ESCALATE", "NO_ACTION"].map((action) => <option key={action} value={action}>{action.replaceAll("_", " ")}</option>)}</select></Field>
          <Field label="Would they use it again?"><select value={feedback.wouldUseAgain} onChange={(e) => setFeedback((value) => ({ ...value, wouldUseAgain: e.target.value }))}><option value="YES">Yes</option><option value="MAYBE">Maybe</option><option value="NO">No</option></select></Field>
        </div>
        <Field label="Workflow friction (private)"><textarea value={feedback.frictionNotesPrivate} onChange={(e) => setFeedback((value) => ({ ...value, frictionNotesPrivate: e.target.value }))} maxLength={5000} placeholder="Record what actually caused friction; do not manufacture positive feedback." /></Field>
        {feedbackStatus === "saved" ? <p className="pilot-feedback-success">✓ Feedback saved privately.</p> : null}
        {feedbackStatus === "error" ? <p className="pilot-error">{feedbackError}</p> : null}
        <div className="pilot-actions"><button className="button button--primary" type="submit" disabled={feedbackStatus === "saving"}>{feedbackStatus === "saving" ? "Saving…" : feedbackStatus === "saved" ? "Update private feedback" : "Save private feedback"}</button></div>
      </form>
    </section>
  </div>;
}
