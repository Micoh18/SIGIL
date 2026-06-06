/* global React, window */
const { useState: useStateT, useRef: useRefT, useEffect: useEffectT } = React;
const useRevealT = window.useReveal;
const ArrowRightT = window.ArrowRight;

/* deterministic pseudo-hash → hex string */
const PRESETS = [
  { agent: "atlas-treasury-02", action: "TRANSFER 12,400 CSPR", rationale: "Rebalance to maintain 30% stable reserve after weekly inflow." },
  { agent: "scout-procure-07", action: "APPROVE invoice #4471", rationale: "Vendor verified, amount within budget envelope, SLA met." },
  { agent: "vault-keeper-01", action: "MINT 500 wTLS", rationale: "Collateral ratio 184% > 150% threshold; mint authorized." },
  { agent: "sentinel-risk-03", action: "HALT strategy delta-9", rationale: "Drawdown breached 4.2% guardrail; pausing pending review." },
];

const STEPS = [
  { k: "Policy", d: "Grimoire spend rule matched" },
  { k: "Challenge", d: "x402 requirement captured" },
  { k: "Settlement", d: "Casper transaction submitted" },
  { k: "Receipt", d: "payment proof persisted" },
];

const DEMO_API_URL = getDemoApiUrl();

function getDemoApiUrl() {
  const configured =
    window.MAINSPRING_DEMO_API_URL ||
    (window.MAINSPRING_CONFIG && window.MAINSPRING_CONFIG.demoApiUrl);
  if (typeof configured === "string" && configured.trim()) {
    return configured.trim().replace(/\/+$/, "");
  }

  const hostName = window.location.hostname;
  if (!hostName || hostName === "localhost" || hostName === "127.0.0.1") {
    return "http://127.0.0.1:4180";
  }

  return window.location.origin.replace(/\/+$/, "") + "/api";
}

function TryIt() {
  const [ref, inView] = useRevealT({ threshold: 0.15 });
  const [agent, setAgent] = useStateT(PRESETS[0].agent);
  const [action, setAction] = useStateT(PRESETS[0].action);
  const [rationale, setRationale] = useStateT(PRESETS[0].rationale);
  const [phase, setPhase] = useStateT("idle"); // idle | sealing | done | failed
  const [step, setStep] = useStateT(-1);
  const [receipt, setReceipt] = useStateT(null);
  const [error, setError] = useStateT("");
  const [count, setCount] = useStateT(0);
  const timers = useRefT([]);

  useEffectT(() => () => timers.current.forEach(clearTimeout), []);

  const usePreset = (p) => {
    if (phase === "sealing") return;
    setAgent(p.agent); setAction(p.action); setRationale(p.rationale);
    setPhase("idle"); setReceipt(null); setError(""); setStep(-1);
  };

  const seal = async () => {
    if (phase === "sealing") return;
    timers.current.forEach(clearTimeout);
    timers.current = [];
    setPhase("sealing"); setReceipt(null); setError(""); setStep(-1);

    STEPS.forEach((_, i) => {
      timers.current.push(setTimeout(() => setStep(i), 320 + i * 780));
    });

    try {
      const response = await fetch(DEMO_API_URL + "/demo/x402/payment-fetch", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ agent, action, rationale })
      });
      const body = await response.json().catch(() => ({}));
      if (!response.ok || !body.ok) {
        throw new Error(body.settlement_blocker || body.message || body.error || "settlement_failed");
      }

      timers.current.forEach(clearTimeout);
      timers.current = [];
      setStep(STEPS.length - 1);
      setReceipt({
        payment_id: body.payment_id,
        agent: body.decision.agent,
        action: body.decision.action,
        rationale: body.decision.rationale_hash,
        tx: body.receipt && body.receipt.casper_transaction_hash,
        status: body.receipt && body.receipt.settlement_status,
        policy: body.policy_id,
        spend: body.spend.after_settlement,
        spend_before: body.spend.before,
        sealed_at: body.settled_at.replace("T", " ").slice(0, 19) + " UTC",
        events: (body.audit_events || []).map((event) => event.event_type).join(", "),
      });
      setPhase("done");
      setCount((c) => c + 1);
    } catch (err) {
      timers.current.forEach(clearTimeout);
      timers.current = [];
      setStep(-1);
      setError(err && err.message ? err.message : "demo_api_unavailable");
      setPhase("failed");
    }
  };

  const fieldBase = "w-full bg-ink/70 border border-parchment/15 rounded-lg px-4 py-3 font-mono text-sm text-parchment placeholder-parchment/30 focus:outline-none focus:border-gold/60 transition-colors";

  return (
    <section id="try" ref={ref} className="bg-obsidian-soft px-6 md:px-12 lg:px-20 py-28 md:py-40 border-y border-parchment/10 relative overflow-hidden">
      <div className="paper-grain absolute inset-0 opacity-[0.04] mix-blend-overlay pointer-events-none" />
      <div className="max-w-[1320px] mx-auto relative">

        <div className="flex flex-col md:flex-row md:items-end md:justify-between gap-8">
          <div className={"reveal " + (inView ? "is-in" : "")}>
            <div className="flex items-center gap-3 font-mono text-[11px] tracking-[0.34em] uppercase" style={{ color: "rgba(236,230,214,0.55)" }}>
              <span style={{ color: "#d4af6a" }}>05</span>
              <span className="w-8 h-px" style={{ background: "rgba(236,230,214,0.3)" }} />
              <span>Try It</span>
            </div>
            <h2 className="font-display font-medium text-parchment text-[9vw] md:text-[4.4vw] lg:text-[4rem] leading-[0.98] tracking-[-0.02em] mt-7">
              Witness a decision,<br />right here.
            </h2>
          </div>
          <p className={"font-serif text-parchment/55 text-base md:text-lg max-w-xs leading-[1.55] reveal " + (inView ? "is-in" : "")} style={{ animationDelay: "0.15s" }}>
            Compose an agent decision and seal it. This is a live sandbox — nothing here touches mainnet, but the mechanism is the real one.
          </p>
        </div>

        <div className="grid grid-cols-1 lg:grid-cols-2 gap-6 lg:gap-8 mt-14 md:mt-20 items-stretch">

          {/* composer */}
          <div className={"rounded-[2rem] border border-parchment/15 bg-obsidian p-6 md:p-8 flex flex-col reveal " + (inView ? "is-in" : "")} style={{ animationDelay: "0.1s" }}>
            <div className="flex items-center justify-between mb-6">
              <span className="font-mono text-[11px] tracking-[0.3em] uppercase text-parchment/50">Composer</span>
              <span className="font-mono text-[10px] tracking-[0.2em] uppercase text-parchment/35">sealed this session · {count}</span>
            </div>

            {/* presets */}
            <div className="flex flex-wrap gap-2 mb-6">
              {PRESETS.map((p, i) => (
                <button key={i} onClick={() => usePreset(p)}
                  className="font-mono text-[11px] px-3 py-1.5 rounded-full border border-parchment/20 text-parchment/70 hover:border-gold/60 hover:text-parchment transition-colors duration-200 whitespace-nowrap">
                  {p.action.split(" ").slice(0, 2).join(" ")}
                </button>
              ))}
            </div>

            <div className="flex flex-col gap-4">
              <label className="flex flex-col gap-1.5">
                <span className="font-mono text-[10px] tracking-[0.25em] uppercase text-parchment/40">Agent</span>
                <input className={fieldBase} value={agent} onChange={(e) => setAgent(e.target.value)} spellCheck={false} />
              </label>
              <label className="flex flex-col gap-1.5">
                <span className="font-mono text-[10px] tracking-[0.25em] uppercase text-parchment/40">Action</span>
                <input className={fieldBase} value={action} onChange={(e) => setAction(e.target.value)} spellCheck={false} />
              </label>
              <label className="flex flex-col gap-1.5">
                <span className="font-mono text-[10px] tracking-[0.25em] uppercase text-parchment/40">Rationale</span>
                <textarea className={fieldBase + " resize-none leading-[1.5]"} rows={2} value={rationale} onChange={(e) => setRationale(e.target.value)} spellCheck={false} />
              </label>
            </div>

            <button onClick={seal} disabled={phase === "sealing"}
              className="mt-7 flex items-center justify-center gap-3 bg-parchment text-obsidian rounded-full py-3.5 font-mono text-sm font-medium hover:bg-gold transition-colors duration-300 disabled:opacity-60 disabled:cursor-wait group">
              {phase === "sealing" ? "Settling..." : (phase === "done" ? "Run another settlement" : "Run real x402 settlement")}
              {phase !== "sealing" && (
                <span className="w-7 h-7 rounded-full bg-obsidian flex items-center justify-center group-hover:scale-110 transition-transform duration-300">
                  <ArrowRightT size={13} className="text-parchment -rotate-45" />
                </span>
              )}
            </button>
          </div>

          {/* output */}
          <div className={"rounded-[2rem] border border-parchment/15 bg-ink/60 overflow-hidden flex flex-col reveal " + (inView ? "is-in" : "")} style={{ animationDelay: "0.22s" }}>
            <div className="flex items-center justify-between px-6 py-4 border-b border-parchment/15 bg-obsidian-soft">
              <span className="font-mono text-[11px] tracking-[0.3em] uppercase text-parchment/55">Attestation</span>
              <span className="flex items-center gap-2 font-mono text-[10px] tracking-[0.2em] uppercase"
                style={{ color: phase === "done" ? "#7bbf8a" : (phase === "failed" ? "#d4786a" : "rgba(236,230,214,0.35)") }}>
                <span style={{ width: 6, height: 6, borderRadius: "50%", background: phase === "done" ? "#7bbf8a" : (phase === "failed" ? "#d4786a" : "#5a554c"), boxShadow: phase === "done" ? "0 0 8px #7bbf8a" : (phase === "failed" ? "0 0 8px #d4786a" : "none") }} />
                {phase === "done" ? "Settled" : (phase === "failed" ? "Failed" : "Awaiting")}
              </span>
            </div>

            <div className="p-6 md:p-8 flex-1 flex flex-col">
              {/* steps tracker */}
              <div className="flex flex-col gap-3 mb-6">
                {STEPS.map((s, i) => {
                  const active = step >= i;
                  const current = step === i && phase === "sealing";
                  return (
                    <div key={s.k} className="flex items-center gap-3 transition-opacity duration-300" style={{ opacity: active ? 1 : 0.3 }}>
                      <span className="flex items-center justify-center w-5 h-5 rounded-full border text-[9px] font-mono shrink-0 transition-colors duration-300"
                        style={{ borderColor: active ? "#d4af6a" : "rgba(236,230,214,0.25)", color: active ? "#d4af6a" : "rgba(236,230,214,0.4)", background: active ? "rgba(212,175,106,0.12)" : "transparent" }}>
                        {active ? "\u2713" : i + 1}
                      </span>
                      <span className="font-mono text-xs text-parchment/85 w-24 shrink-0">{s.k}</span>
                      <span className="font-mono text-[11px] text-parchment/40 truncate">{s.d}</span>
                      {current && <span className="w-1.5 h-1.5 rounded-full bg-gold animate-pulse ml-auto" />}
                    </div>
                  );
                })}
              </div>

              <div className="hairline mb-6" />

              {/* receipt */}
              {receipt ? (
                <div className="font-mono text-xs md:text-[13px] flex flex-col" style={{ animation: "fadeUp 0.5s cubic-bezier(0.16,1,0.3,1) both" }}>
                  {[["payment_id", receipt.payment_id], ["agent", receipt.agent], ["action", receipt.action], ["rationale", receipt.rationale], ["settlement", receipt.status], ["tx_hash", receipt.tx], ["policy", receipt.policy], ["spend", receipt.spend_before + " -> " + receipt.spend], ["audit", receipt.events], ["settled_at", receipt.sealed_at]].map((r) => (
                    <div key={r[0]} className="flex items-baseline gap-4 py-1.5 border-b border-parchment/[0.06] last:border-0">
                      <span className="text-parchment/40 w-24 shrink-0">{r[0]}</span>
                      <span className="text-parchment/90 break-all">{r[1]}</span>
                    </div>
                  ))}
                  <div className="flex items-center gap-3 mt-5 pt-4 border-t border-parchment/15">
                    <span className="font-display text-gold text-base">✦</span>
                    <span className="text-parchment/55">Settled by Mr. Mainspring · verify at <span className="text-gold">cspr.live</span></span>
                  </div>
                </div>
              ) : error ? (
                <div className="flex-1 flex items-center justify-center text-center py-8">
                  <span className="font-mono text-[12px] text-parchment/55 max-w-[22rem] leading-relaxed break-words">
                    {error}
                  </span>
                </div>
              ) : (
                <div className="flex-1 flex items-center justify-center text-center py-8">
                  <span className="font-serif italic text-parchment/35 text-base max-w-[16rem] leading-relaxed">
                    {phase === "sealing" ? "Waiting for the x402 settlement path..." : "Your Casper x402 receipt will appear here."}
                  </span>
                </div>
              )}
            </div>
          </div>
        </div>
      </div>
    </section>
  );
}

Object.assign(window, { TryIt });
