import { Component, type ErrorInfo, type ReactNode, useEffect, useMemo, useState } from "react";
import { Link, NavLink, Navigate, Route, Routes, useLocation, useParams } from "react-router-dom";
import {
  ARC_PROOF,
  DEMO_METRICS,
  OBLIGATIONS,
  REAL_METRICS,
  SCENARIOS,
  getScenario,
  shortHash,
  type DemoObligation,
  type Scenario,
  type WitnessCheck,
} from "./data";

const navItems = [
  { to: "/demo", label: "Reviewer demo" },
  { to: "/metrics", label: "Metrics" },
];

function ArrowIcon() {
  return <span aria-hidden="true">↗</span>;
}

function BrandMark() {
  return (
    <span className="brand-mark" aria-hidden="true">
      <span />
      <span />
      <span />
    </span>
  );
}

function Badge({ children, tone = "neutral" }: { children: ReactNode; tone?: string }) {
  return <span className={`badge badge--${tone}`}>{children}</span>;
}

function AppShell({ children }: { children: ReactNode }) {
  const [menuOpen, setMenuOpen] = useState(false);

  return (
    <div className="app-shell">
      <header className="site-header">
        <Link className="brand" to="/demo" aria-label="Euthyna reviewer demo home">
          <BrandMark />
          <span>Euthyna</span>
        </Link>
        <button
          className="menu-button"
          type="button"
          aria-expanded={menuOpen}
          aria-controls="primary-navigation"
          onClick={() => setMenuOpen((open) => !open)}
        >
          Menu
        </button>
        <nav id="primary-navigation" className={menuOpen ? "site-nav site-nav--open" : "site-nav"}>
          {navItems.map((item) => (
            <NavLink
              key={item.to}
              to={item.to}
              onClick={() => setMenuOpen(false)}
              className={({ isActive }) => (isActive ? "active" : undefined)}
            >
              {item.label}
            </NavLink>
          ))}
          <a href={ARC_PROOF.transactionExplorer} target="_blank" rel="noreferrer">
            Arc proof <ArrowIcon />
          </a>
        </nav>
      </header>
      <main>{children}</main>
      <footer className="site-footer">
        <div>
          <span className="brand footer-brand"><BrandMark /> Euthyna</span>
          <p>Proof of obligation for autonomous payments.</p>
        </div>
        <div className="footer-meta">
          <Badge tone="test">TEST — Arc Testnet</Badge>
          <span>No private evidence is exposed in reviewer mode.</span>
        </div>
      </footer>
    </div>
  );
}

function MetricCard({ label, value, detail }: { label: string; value: string | number; detail?: string }) {
  return (
    <article className="metric-card">
      <span>{label}</span>
      <strong>{value}</strong>
      {detail ? <small>{detail}</small> : null}
    </article>
  );
}

function HashValue({ label, value }: { label: string; value: string }) {
  const [copied, setCopied] = useState(false);

  async function copy() {
    try {
      await navigator.clipboard.writeText(value);
      setCopied(true);
      window.setTimeout(() => setCopied(false), 1_500);
    } catch {
      setCopied(false);
    }
  }

  return (
    <div className="hash-row">
      <span>{label}</span>
      <code title={value}>{shortHash(value)}</code>
      <button type="button" onClick={copy} aria-label={`Copy ${label}`}>
        {copied ? "Copied" : "Copy"}
      </button>
    </div>
  );
}

function TrustFlow({ active = -1 }: { active?: number }) {
  const stages = [
    ["01", "Evidence", "Business records"],
    ["02", "Witness", "Business truth"],
    ["03", "Agent", "Economic judgment"],
    ["04", "Contract", "Authority"],
    ["05", "Arc / Circle", "Settlement"],
  ];

  return (
    <div className="trust-flow" aria-label="Evidence to settlement trust path">
      {stages.map(([number, title, role], index) => (
        <div key={title} className={index <= active ? "flow-step flow-step--active" : "flow-step"}>
          <span>{number}</span>
          <strong>{title}</strong>
          <small>{role}</small>
        </div>
      ))}
    </div>
  );
}

function Hero() {
  const counts = useMemo(
    () => ({
      verified: OBLIGATIONS.filter((item) => item.witnessVerdict === "VERIFIED").length,
      held: OBLIGATIONS.filter((item) => item.witnessVerdict === "HOLD").length,
      rejected: OBLIGATIONS.filter((item) => item.witnessVerdict === "REJECTED").length,
    }),
    [],
  );

  return (
    <section className="hero section-pad">
      <div className="hero-copy">
        <div className="eyebrow-row">
          <Badge tone="live"><span className="live-dot" /> Live on Arc Testnet</Badge>
          <Badge tone="test">Public reviewer mode</Badge>
        </div>
        <h1>Proof before <em>payment.</em></h1>
        <p className="hero-thesis">Before an agent can pay, Euthyna proves there is something to pay for.</p>
        <p className="hero-support">
          A deterministic Evidence Witness establishes business truth. Only then can an Agent make an economic
          decision and ask the vault to settle.
        </p>
        <div className="hero-actions">
          <a className="button button--primary" href="#scenarios">Run the four scenarios</a>
          <a className="button button--secondary" href={ARC_PROOF.transactionExplorer} target="_blank" rel="noreferrer">
            Inspect real Arc settlement <ArrowIcon />
          </a>
        </div>
      </div>
      <aside className="hero-proof" aria-label="First Arc settlement proof">
        <div className="proof-topline">
          <span>First settlement proof</span>
          <Badge tone="test">TEST</Badge>
        </div>
        <strong className="proof-amount">{ARC_PROOF.settledAmount}</strong>
        <span className="proof-status"><span className="check-dot">✓</span> Reconciled on Arc</span>
        <div className="proof-detail-grid">
          <span>Block<strong>{ARC_PROOF.settlementBlock}</strong></span>
          <span>Chain<strong>{ARC_PROOF.chainId}</strong></span>
        </div>
        <HashValue label="Transaction" value={ARC_PROOF.transaction} />
        <HashValue label="Vault" value={ARC_PROOF.vault} />
        <a className="proof-link" href={ARC_PROOF.transactionExplorer} target="_blank" rel="noreferrer">
          Open in Arc explorer <ArrowIcon />
        </a>
      </aside>
      <div className="hero-metrics" aria-label="Reviewer demo summary">
        <MetricCard label="Obligations evaluated" value={OBLIGATIONS.length} detail="All clearly marked TEST" />
        <MetricCard label="Verified / held / rejected" value={`${counts.verified} / ${counts.held} / ${counts.rejected}`} />
        <MetricCard label="USDC settled" value="0.001" detail="Real Arc Testnet transaction" />
        <MetricCard label="Duplicates prevented" value="1" detail="$0 moved" />
      </div>
    </section>
  );
}

function ScenarioCard({ scenario }: { scenario: Scenario }) {
  return (
    <article className={`scenario-card scenario-card--${scenario.tone}`}>
      <div className="scenario-number">{scenario.letter}</div>
      <div className="scenario-card-body">
        <span className="kicker">{scenario.eyebrow}</span>
        <h3>{scenario.title}</h3>
        <p>{scenario.summary}</p>
        <div className="scenario-outcome">
          <Badge tone={scenario.tone}>{scenario.outcome}</Badge>
          <strong>{scenario.moved}</strong>
        </div>
        <Link className="text-link" to={`/demo/${scenario.slug}`}>
          Run scenario <span aria-hidden="true">→</span>
        </Link>
      </div>
    </article>
  );
}

function StatusBadge({ value }: { value: string }) {
  const tone = value === "VERIFIED" || value === "SETTLED" || value === "PAY_NOW" || value === "RECONCILED"
    ? "verified"
    : value === "HOLD" || value === "SCHEDULE" || value === "SCHEDULED"
      ? "hold"
      : value === "REJECTED" || value === "NOT_ELIGIBLE"
        ? "rejected"
        : "neutral";
  return <Badge tone={tone}>{value.replaceAll("_", " ")}</Badge>;
}

function ObligationFeed() {
  return (
    <section className="section-pad feed-section" id="obligations">
      <div className="section-heading">
        <div>
          <span className="kicker">Transparent by default</span>
          <h2>Obligation feed</h2>
        </div>
        <p>Review accepted, held and rejected cases side by side. Every row is deterministic demo data.</p>
      </div>
      <div className="table-wrap">
        <table>
          <thead>
            <tr>
              <th>Obligation</th>
              <th>Amount / due</th>
              <th>Witness</th>
              <th>Agent</th>
              <th>Settlement</th>
              <th aria-label="Open details" />
            </tr>
          </thead>
          <tbody>
            {OBLIGATIONS.map((item) => (
              <tr key={item.id}>
                <td>
                  <div className="table-primary">{item.vendor}</div>
                  <span>{item.invoice} · <Badge tone="test">{item.classification}</Badge></span>
                </td>
                <td>
                  <div className="table-primary">{item.amount}</div>
                  <span>{item.dueDate}</span>
                </td>
                <td><StatusBadge value={item.witnessVerdict} /></td>
                <td>
                  <StatusBadge value={item.agentAction} />
                  <span className="reason-cell">{item.reason}</span>
                </td>
                <td><StatusBadge value={item.settlementStatus} /></td>
                <td><Link className="row-link" to={`/obligations/${item.id}`} aria-label={`Inspect ${item.id}`}>→</Link></td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </section>
  );
}

function ProofSection() {
  return (
    <section className="section-pad proof-section" id="proof">
      <div className="proof-story">
        <span className="kicker">Public onchain proof</span>
        <h2>One decision.<br />One authorization.<br /><em>One settlement.</em></h2>
        <p>
          The first Euthyna test fixture passed W01–W10, received a bounded agent decision, was authorized once,
          and reconciled after an intentional process crash without a duplicate payment.
        </p>
        <div className="no-duplicate"><strong>$0</strong><span>duplicate amount after crash + retry</span></div>
      </div>
      <div className="proof-ledger">
        <div className="proof-ledger-head">
          <div>
            <Badge tone="test">TEST — Arc Testnet</Badge>
            <h3>Receipt · obl_arc_test_001</h3>
          </div>
          <span className="seal">✓</span>
        </div>
        <HashValue label="Evidence root" value={ARC_PROOF.evidenceRoot} />
        <HashValue label="Decision commitment" value={ARC_PROOF.decisionCommitment} />
        <HashValue label="Attestation" value={ARC_PROOF.attestationHash} />
        <HashValue label="Final receipt" value={ARC_PROOF.finalReceiptHash} />
        <div className="ledger-footer">
          <span>Operation</span><code>{ARC_PROOF.operationId}</code>
          <span>Finalized</span><strong>Sep 30, 2026 · block {ARC_PROOF.settlementBlock}</strong>
        </div>
        <a className="button button--primary button--full" href={ARC_PROOF.transactionExplorer} target="_blank" rel="noreferrer">
          Verify settlement on Arc <ArrowIcon />
        </a>
      </div>
    </section>
  );
}

function DemoPage() {
  return (
    <AppShell>
      <Hero />
      <section className="flow-section section-pad">
        <div className="section-heading section-heading--flow">
          <div><span className="kicker">Separation of powers</span><h2>The trust path</h2></div>
          <p>The Witness proves facts. The Agent judges timing. The contract alone holds authority.</p>
        </div>
        <TrustFlow active={4} />
      </section>
      <section className="section-pad scenarios-section" id="scenarios">
        <div className="section-heading">
          <div><span className="kicker">Four reviewer paths</span><h2>See why money moves—or doesn’t.</h2></div>
          <p>Each scenario runs locally in the browser with fixed public-safe data. No wallet or login required.</p>
        </div>
        <div className="scenario-grid">
          {SCENARIOS.map((scenario) => <ScenarioCard key={scenario.slug} scenario={scenario} />)}
        </div>
      </section>
      <ObligationFeed />
      <ProofSection />
      <section className="section-pad metrics-callout">
        <div><span className="kicker">Honest metrics</span><h2>TEST evidence is not traction.</h2></div>
        <p>Demo and adversarial cases are separated from real pilot records everywhere in the product.</p>
        <Link className="button button--light" to="/metrics">Inspect hackathon metrics →</Link>
      </section>
    </AppShell>
  );
}

const runLabels: Record<Scenario["slug"], string[]> = {
  valid: ["Normalize redacted evidence", "Run Witness W01–W10", "Validate Agent decision", "Verify Arc receipt"],
  prioritization: ["Load constrained business state", "Confirm all three obligations", "Rank economic priorities", "Validate reserve"],
  duplicate: ["Normalize invoice variant", "Compare semantic fingerprint", "Reject before Agent", "Confirm $0 moved"],
  "destination-change": ["Normalize payment instruction", "Compare vendor version", "Hold before Agent", "Confirm $0 moved"],
};

function ScenarioRunner({ scenario }: { scenario: Scenario }) {
  const [status, setStatus] = useState<"idle" | "running" | "complete">("idle");
  const [step, setStep] = useState(-1);

  useEffect(() => {
    if (status !== "running") return;
    const timer = window.setInterval(() => {
      setStep((current) => {
        if (current >= 3) {
          window.clearInterval(timer);
          setStatus("complete");
          return current;
        }
        return current + 1;
      });
    }, 420);
    return () => window.clearInterval(timer);
  }, [status]);

  function run() {
    setStep(-1);
    setStatus("running");
  }

  return (
    <div className={`scenario-runner scenario-runner--${scenario.tone}`} aria-live="polite">
      <div className="runner-head">
        <div><span className="kicker">Deterministic browser replay</span><h2>{scenario.title}</h2></div>
        <button className="button button--primary" type="button" onClick={run} disabled={status === "running"}>
          {status === "idle" ? "Run Scenario" : status === "running" ? "Running…" : "Run Again"}
        </button>
      </div>
      <div className="runner-steps">
        {runLabels[scenario.slug].map((label, index) => (
          <div key={label} className={index <= step ? "runner-step runner-step--done" : "runner-step"}>
            <span>{index <= step ? "✓" : index + 1}</span><p>{label}</p>
          </div>
        ))}
      </div>
      <div className={status === "complete" ? "runner-result runner-result--visible" : "runner-result"}>
        <Badge tone={scenario.tone}>{scenario.outcome}</Badge>
        <strong>{scenario.moved}</strong>
      </div>
    </div>
  );
}

function DetailNav() {
  const items = [
    ["obligation", "Obligation"], ["evidence", "Evidence"], ["checks", "Witness checks"],
    ["decision", "Agent decision"], ["authorization", "Authorization"], ["settlement", "Settlement"],
    ["receipt", "Audit receipt"],
  ];
  return (
    <nav className="detail-nav" aria-label="Decision detail sections">
      {items.map(([id, label], index) => <a key={id} href={`#${id}`}><span>{index + 1}</span>{label}</a>)}
    </nav>
  );
}

function SectionTitle({ number, title, description }: { number: string; title: string; description?: string }) {
  return (
    <div className="detail-title"><span>{number}</span><div><h2>{title}</h2>{description ? <p>{description}</p> : null}</div></div>
  );
}

function ObligationCards({ obligations, focusedId }: { obligations: DemoObligation[]; focusedId?: string }) {
  const ordered = focusedId
    ? [...obligations].sort((a) => (a.id === focusedId ? -1 : 1))
    : obligations;
  return (
    <div className="obligation-cards">
      {ordered.map((item, index) => (
        <article key={item.id} className={item.id === focusedId ? "obligation-card obligation-card--focused" : "obligation-card"}>
          <div className="obligation-rank">{index + 1}</div>
          <div><span>Vendor</span><strong>{item.vendor}</strong></div>
          <div><span>Amount</span><strong>{item.amount}</strong></div>
          <div><span>Due</span><strong>{item.dueDate}</strong></div>
          <div><span>Current state</span><StatusBadge value={item.state} /></div>
          <div className="obligation-wide"><span>Reason</span><strong>{item.reason}</strong></div>
        </article>
      ))}
    </div>
  );
}

function EvidenceGrid({ scenario }: { scenario: Scenario }) {
  return (
    <div className="evidence-grid">
      {scenario.evidence.map((item) => (
        <article key={`${item.type}-${item.label}`} className="evidence-card">
          <span className="document-icon" aria-hidden="true">▤</span>
          <div><Badge tone="neutral">{item.type}</Badge><h3>{item.label}</h3><p>{item.summary}</p><code>{item.fingerprint}</code></div>
        </article>
      ))}
      <div className="privacy-note"><span aria-hidden="true">◉</span><p><strong>Public metadata only.</strong> Source documents remain private; reviewer mode exposes normalized conclusions and content fingerprints.</p></div>
    </div>
  );
}

function CheckRow({ check }: { check: WitnessCheck }) {
  return (
    <article className={`check-row check-row--${check.status.toLowerCase()}`}>
      <span className="check-id">{check.id}</span>
      <div className="check-main"><h3>{check.name}</h3><p>{check.evidence.join(" · ")}</p>
        {check.expected ? <div className="comparison"><span><small>Expected</small>{check.expected}</span><span><small>Observed</small>{check.observed}</span></div> : null}
      </div>
      <div className="check-result"><StatusBadge value={check.status} />{check.reason ? <code>{check.reason}</code> : null}</div>
    </article>
  );
}

function DecisionPanel({ scenario }: { scenario: Scenario }) {
  const isPrioritization = scenario.slug === "prioritization";
  return (
    <div className="decision-panel">
      {isPrioritization ? (
        <div className="business-state">
          <div><span>Available</span><strong>1,000 USDC</strong></div>
          <div><span>Minimum reserve</span><strong>300 USDC</strong></div>
          <div><span>Expected inflow</span><strong>700 USDC · Oct 7</strong></div>
          <div><span>Projected after PAY_NOW</span><strong>400 USDC</strong></div>
        </div>
      ) : null}
      <div className="decision-list">
        {scenario.obligations.map((item, index) => (
          <div className="decision-row" key={item.id}>
            <span className="decision-rank">#{index + 1}</span>
            <div><strong>{item.vendor}</strong><small>{item.amount} · {item.dueDate}</small></div>
            <StatusBadge value={item.agentAction} />
            <p>{item.reason}</p>
          </div>
        ))}
      </div>
      <blockquote>{scenario.rationale}</blockquote>
      <div className="reason-codes">{scenario.reasonCodes.map((code) => <Badge key={code} tone="neutral">{code}</Badge>)}</div>
      {isPrioritization ? <div className="reserve-bar"><span style={{ width: "40%" }} /><div><strong>400 USDC projected</strong><small>300 reserve protected · 100 headroom</small></div></div> : null}
    </div>
  );
}

function GatePanel({ scenario, type }: { scenario: Scenario; type: "authorization" | "settlement" }) {
  const allowed = scenario.slug === "valid";
  const preview = scenario.slug === "prioritization";
  if (type === "authorization" && allowed) {
    return (
      <div className="gate-panel gate-panel--success">
        <span className="gate-icon">✓</span><div><Badge tone="verified">AUTHORIZED</Badge><h3>Witness-bound, one-time vault call</h3><p>Amount, payee, evidence, decision and versioned chain context are committed before execution.</p></div>
        <HashValue label="Decision commitment" value={ARC_PROOF.decisionCommitment} />
        <HashValue label="Attestation" value={ARC_PROOF.attestationHash} />
      </div>
    );
  }
  if (type === "settlement" && allowed) {
    return (
      <div className="gate-panel gate-panel--success">
        <span className="gate-icon">✓</span><div><Badge tone="verified">RECONCILED</Badge><h3>{ARC_PROOF.settledAmount} settled on Arc Testnet</h3><p>Block {ARC_PROOF.settlementBlock} · deliberate crash/retry produced no second payment.</p></div>
        <HashValue label="Transaction" value={ARC_PROOF.transaction} />
        <a className="button button--secondary" href={ARC_PROOF.transactionExplorer} target="_blank" rel="noreferrer">View Arc proof <ArrowIcon /></a>
      </div>
    );
  }
  return (
    <div className={`gate-panel ${preview ? "gate-panel--preview" : "gate-panel--blocked"}`}>
      <span className="gate-icon">{preview ? "○" : "×"}</span>
      <div>
        <Badge tone={preview ? "hold" : scenario.tone}>{preview ? "DEMO PREVIEW" : "STOPPED BEFORE SIGNING"}</Badge>
        <h3>{preview ? "No transaction requested" : "$0 moved"}</h3>
        <p>{preview ? "This scenario demonstrates decision quality only; it never broadcasts demo payments." : scenario.rationale}</p>
        {scenario.requiredAction ? <p className="required-action"><strong>Human action:</strong> {scenario.requiredAction}</p> : null}
      </div>
    </div>
  );
}

function ScenarioPage({ scenario, focusedId }: { scenario: Scenario; focusedId?: string }) {
  const location = useLocation();
  useEffect(() => {
    if (!location.hash) {
      window.scrollTo({ top: 0, behavior: "smooth" });
      return;
    }
    window.setTimeout(() => document.querySelector(location.hash)?.scrollIntoView({ behavior: "smooth" }), 0);
  }, [location.hash]);

  return (
    <AppShell>
      <section className="detail-hero section-pad">
        <Link className="back-link" to="/demo">← All scenarios</Link>
        <div className="detail-hero-grid">
          <div><span className="scenario-letter">Scenario {scenario.letter}</span><h1>{scenario.title}</h1><p>{scenario.summary}</p></div>
          <div className="detail-verdict"><Badge tone="test">TEST DATA</Badge><strong>{scenario.outcome.replaceAll("_", " ")}</strong><span>{scenario.moved}</span></div>
        </div>
        <ScenarioRunner scenario={scenario} />
      </section>
      <DetailNav />
      <div className="detail-content section-pad">
        <section id="obligation" className="detail-section"><SectionTitle number="01" title="Obligation" description="The business claim presented for evaluation." /><ObligationCards obligations={scenario.obligations} focusedId={focusedId} /></section>
        {scenario.slug === "prioritization" ? <section className="cash-context"><span>Economic context</span><p>The Witness confirms all three obligations independently. It does not rank them or decide when to pay.</p></section> : null}
        <section id="evidence" className="detail-section"><SectionTitle number="02" title="Evidence" description="Redacted public summaries; source documents remain private." /><EvidenceGrid scenario={scenario} /></section>
        <section id="checks" className="detail-section"><SectionTitle number="03" title="Witness checks" description="Deterministic business-truth checks run before the Agent sees an obligation." /><div className="checks-list">{scenario.checks.map((check) => <CheckRow key={check.id} check={check} />)}</div></section>
        <section id="decision" className="detail-section"><SectionTitle number="04" title="Agent decision" description="Economic judgment over Witness-verified inputs; never a payment authorization by itself." /><DecisionPanel scenario={scenario} /></section>
        <section id="authorization" className="detail-section"><SectionTitle number="05" title="Authorization" description="The contract-bound permission boundary." /><GatePanel scenario={scenario} type="authorization" /></section>
        <section id="settlement" className="detail-section"><SectionTitle number="06" title="Settlement" description="Arc and Circle execute only after every preceding gate passes." /><GatePanel scenario={scenario} type="settlement" /></section>
        <section id="receipt" className="detail-section"><SectionTitle number="07" title="Audit receipt" description="A compact account of what happened—and why." />
          <div className="audit-receipt">
            <div><span>Classification</span><Badge tone="test">TEST</Badge></div>
            <div><span>Witness</span><strong>{scenario.obligations[0]?.witnessVerdict}</strong></div>
            <div><span>Agent</span><strong>{scenario.obligations.map((item) => item.agentAction).join(" · ")}</strong></div>
            <div><span>Settlement</span><strong>{scenario.slug === "valid" ? "RECONCILED" : "NO TRANSACTION"}</strong></div>
            {scenario.slug === "valid" ? <HashValue label="Final receipt hash" value={ARC_PROOF.finalReceiptHash} /> : <p className="receipt-note">No onchain receipt is fabricated for a held, rejected, or decision-preview scenario.</p>}
          </div>
        </section>
      </div>
    </AppShell>
  );
}

function ScenarioRoute() {
  const { slug } = useParams();
  const scenario = getScenario(slug);
  return scenario ? <ScenarioPage scenario={scenario} /> : <NotFound />;
}

function ObligationRoute() {
  const { id } = useParams();
  const obligation = OBLIGATIONS.find((item) => item.id === id);
  const scenario = obligation ? getScenario(obligation.scenario) : undefined;
  return scenario ? <ScenarioPage scenario={scenario} focusedId={id} /> : <NotFound />;
}

function MetricsTable({ metrics, real }: { metrics: typeof DEMO_METRICS | typeof REAL_METRICS; real?: boolean }) {
  const rows = [
    ["Invoices / obligations processed", metrics.obligationsProcessed],
    ["Total payment volume", metrics.totalPaymentVolume],
    ["Duplicate obligations caught", metrics.duplicateObligationsCaught],
    ["Obligations settled autonomously", metrics.obligationsSettledAutonomously],
    ["Decisions vs escalations", `${metrics.decisions} / ${metrics.escalations}`],
    ["Human agreement rate", metrics.humanAgreementRate],
    ["HOLD events", metrics.holdEvents],
    ["Payout destination changes caught", metrics.payoutDestinationChangesCaught],
    ["Settlement success rate", metrics.settlementSuccessRate],
  ];
  return (
    <section className={real ? "metrics-panel metrics-panel--real" : "metrics-panel"}>
      <div className="metrics-panel-head">
        <div><Badge tone={real ? "real" : "test"}>{metrics.classification}</Badge><h2>{real ? "Pilot metrics" : "Reviewer fixture metrics"}</h2></div>
        <p>{real ? "No real business pilot has been onboarded yet." : "Synthetic/adversarial TEST cases. Never represented as traction."}</p>
      </div>
      <div className="metrics-rows">{rows.map(([label, value]) => <div key={label}><span>{label}</span><strong>{value}</strong></div>)}</div>
    </section>
  );
}

function MetricsPage() {
  return (
    <AppShell>
      <section className="metrics-hero section-pad">
        <span className="kicker">Tameion reviewer metrics</span>
        <h1>Measured without<br /><em>manufactured traction.</em></h1>
        <p>Every record carries a TEST or REAL classification. Demo exercises prove behavior; only pilot activity will count as adoption.</p>
      </section>
      <div className="metrics-layout section-pad"><MetricsTable metrics={DEMO_METRICS} /><MetricsTable metrics={REAL_METRICS} real /></div>
      <section className="pilot-schema section-pad">
        <div><span className="kicker">Pilot-ready record boundary</span><h2>What a REAL record may surface</h2><p>Reviewer mode stores and displays identifiers and conclusions—not private source documents.</p></div>
        <div className="schema-grid">{["Business", "Vendor", "Obligation", "Amount", "Evidence types", "Witness verdict", "Agent decision", "Settlement result"].map((item) => <span key={item}>✓ {item}</span>)}</div>
      </section>
    </AppShell>
  );
}

function NotFound() {
  return (
    <AppShell><section className="not-found section-pad"><span className="kicker">404</span><h1>This proof path does not exist.</h1><p>The reviewer demo is intact; this URL is not one of its public routes.</p><Link className="button button--primary" to="/demo">Return to reviewer demo</Link></section></AppShell>
  );
}

export function App() {
  return (
    <Routes>
      <Route path="/" element={<Navigate to="/demo" replace />} />
      <Route path="/demo" element={<DemoPage />} />
      <Route path="/demo/:slug" element={<ScenarioRoute />} />
      <Route path="/obligations/:id" element={<ObligationRoute />} />
      <Route path="/metrics" element={<MetricsPage />} />
      <Route path="*" element={<NotFound />} />
    </Routes>
  );
}

interface ErrorBoundaryState { failed: boolean }

export class AppErrorBoundary extends Component<{ children: ReactNode }, ErrorBoundaryState> {
  state: ErrorBoundaryState = { failed: false };

  static getDerivedStateFromError(): ErrorBoundaryState {
    return { failed: true };
  }

  componentDidCatch(error: Error, info: ErrorInfo) {
    console.error("Reviewer app failed safely", error, info.componentStack);
  }

  render() {
    if (this.state.failed) {
      return <main className="fatal-error"><div><span className="kicker">Reviewer app error</span><h1>The public proof could not be rendered.</h1><p>Reload the page. No transaction or signing action was attempted.</p><button className="button button--primary" type="button" onClick={() => window.location.reload()}>Reload</button></div></main>;
    }
    return this.props.children;
  }
}
