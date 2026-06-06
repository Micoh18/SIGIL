/* global React, window */
const { useState: useStateT, useRef: useRefT, useEffect: useEffectT } = React;
const useRevealT = window.useReveal;
const ArrowRightT = window.ArrowRight;

const PRESETS = [
  { label: "Treasury", agent: "atlas-treasury-02", action: "TRANSFER 12,400 CSPR", rationale: "Rebalance to maintain 30% stable reserve after weekly inflow." },
  { label: "Invoice",  agent: "scout-procure-07", action: "APPROVE invoice #4471", rationale: "Vendor verified, amount within budget envelope, SLA met." },
  { label: "Code PR",  agent: "dev-agent-forge",  action: "MERGE pull-request #881", rationale: "All CI checks passed, no security alerts, reviewer approved." },
  { label: "Halt",     agent: "sentinel-risk-03", action: "HALT strategy delta-9", rationale: "Drawdown breached 4.2% guardrail; pausing pending review." },
  { label: "Research", agent: "archivist-9",      action: "PUBLISH summary #2041",  rationale: "Cross-referenced 14 sources; confidence 0.91, no contradictions." },
];

const STEPS = [
  { k: "Policy",    d: "Grimoire spend rule matched" },
  { k: "Challenge", d: "x402 requirement captured" },
  { k: "Anchor",    d: "hash submitted to Casper testnet" },
  { k: "Receipt",   d: "attestation persisted" },
];

async function sha256Hex(text) {
  const buf = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(text));
  return Array.from(new Uint8Array(buf)).map(b => b.toString(16).padStart(2, "0")).join("");
}

function randHex(bytes) {
  const arr = new Uint8Array(bytes);
  crypto.getRandomValues(arr);
  return Array.from(arr).map(b => b.toString(16).padStart(2, "0")).join("");
}

async function simulateSeal(agent, action, rationale) {
  await new Promise(r => setTimeout(r, 320 + 3 * 780 + 400));

  const rationaleHash = await sha256Hex(agent + ":" + action + ":" + rationale);
  const ts            = Date.now();
  const contentHash   = await sha256Hex(rationaleHash + ":" + ts);
  const metadataHash  = await sha256Hex("meta:" + agent + ":" + ts);
  const txHash        = randHex(32);
  const memoryId      = "mem_" + randHex(16);
  const policyId      = "pol_" + agent.replace(/[^a-z0-9]/gi, "_");
  const now           = new Date(ts).toISOString();

  return {
    memory_id:     memoryId,
    agent,
    action,
    content_hash:  contentHash,
    metadata_hash: metadataHash,
    rationale_hash: rationaleHash,
    anchor_tx:     txHash,
    status:        "policy_checked",
    policy:        policyId,
    anchor_status: "pending",
    sealed_at:     now.replace("T", " ").slice(0, 19) + " UTC",
    _ts:           ts,
  };
}

async function simulateVerify(receipt, tamper = false) {
  await new Promise(r => setTimeout(r, 300 + 500));
  let inputHash = receipt.rationale_hash;
  if (tamper) {
    // flip one char to simulate a tampered record
    const idx = 12;
    const chars = "0123456789abcdef";
    const cur = inputHash[idx];
    const next = chars[(chars.indexOf(cur) + 1) % 16];
    inputHash = inputHash.slice(0, idx) + next + inputHash.slice(idx + 1);
  }
  const recomputed = await sha256Hex(inputHash + ":" + receipt._ts);
  const intact = recomputed === receipt.content_hash;
  return {
    memory_id:     receipt.memory_id,
    content_hash:  receipt.content_hash,
    recomputed:    recomputed,
    hash_verified: intact,
    integrity:     intact ? "intact" : "compromised",
    anchor_status: receipt.anchor_status,
    verified_at:   new Date().toISOString().replace("T", " ").slice(0, 19) + " UTC",
  };
}

function CopyBtn({ text, size = 11 }) {
  const [done, setDone] = useStateT(false);
  const copy = () => {
    try { navigator.clipboard.writeText(text); } catch (e) {}
    setDone(true);
    setTimeout(() => setDone(false), 1200);
  };
  return (
    <button onClick={copy} title="Copy"
      className="ml-1 text-parchment/30 hover:text-gold transition-colors duration-200"
      style={{ fontSize: size, fontFamily: "monospace" }}>
      {done ? "✓" : "⧉"}
    </button>
  );
}

function TryIt() {
  const [ref, inView] = useRevealT({ threshold: 0.15 });
  const [preset, setPreset] = useStateT(0);
  const [agent, setAgent] = useStateT(PRESETS[0].agent);
  const [action, setAction] = useStateT(PRESETS[0].action);
  const [rationale, setRationale] = useStateT(PRESETS[0].rationale);
  const [phase, setPhase] = useStateT("idle");    // idle | sealing | done | failed
  const [verifyPhase, setVerifyPhase] = useStateT("idle"); // idle | verifying | done
  const [step, setStep] = useStateT(-1);
  const [receipt, setReceipt] = useStateT(null);
  const [verifyResult, setVerifyResult] = useStateT(null);
  const [error, setError] = useStateT("");
  const [count, setCount] = useStateT(0);
  const timers = useRefT([]);

  useEffectT(() => () => timers.current.forEach(clearTimeout), []);

  const usePreset = (i) => {
    if (phase === "sealing") return;
    const p = PRESETS[i];
    setPreset(i); setAgent(p.agent); setAction(p.action); setRationale(p.rationale);
    setPhase("idle"); setReceipt(null); setVerifyResult(null); setVerifyPhase("idle"); setError(""); setStep(-1);
  };

  const seal = async () => {
    if (phase === "sealing") return;
    timers.current.forEach(clearTimeout); timers.current = [];
    setPhase("sealing"); setReceipt(null); setVerifyResult(null); setVerifyPhase("idle"); setError(""); setStep(-1);
    STEPS.forEach((_, i) => {
      timers.current.push(setTimeout(() => setStep(i), 320 + i * 780));
    });
    try {
      const data = await simulateSeal(agent, action, rationale);
      timers.current.forEach(clearTimeout); timers.current = [];
      setStep(STEPS.length - 1);
      setReceipt(data);
      setPhase("done");
      setCount(c => c + 1);
    } catch (err) {
      timers.current.forEach(clearTimeout); timers.current = [];
      setStep(-1);
      setError(err && err.message ? err.message : "simulation_failed");
      setPhase("failed");
    }
  };

  const verify = async (tamper = false) => {
    if (verifyPhase === "verifying" || !receipt) return;
    setVerifyPhase("verifying"); setVerifyResult(null);
    try {
      const vr = await simulateVerify(receipt, tamper);
      setVerifyResult({ ...vr, tampered: tamper });
      setVerifyPhase("done");
    } catch {
      setVerifyPhase("idle");
    }
  };

  const fieldBase = "w-full bg-ink/70 border border-parchment/15 rounded-lg px-4 py-3 font-mono text-sm text-parchment placeholder-parchment/30 focus:outline-none focus:border-gold/60 transition-colors";
  const hashShort = (h) => h ? h.slice(0, 8) + "…" + h.slice(-6) : "";

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
            Seal a decision. Verify the hash. Simulate a tamper — watch integrity fail. Real SHA-256, real attestation format.
          </p>
        </div>

        <div className="grid grid-cols-1 lg:grid-cols-2 gap-6 lg:gap-8 mt-14 md:mt-20 items-stretch">

          {/* composer */}
          <div className={"rounded-[2rem] border border-parchment/15 bg-obsidian p-6 md:p-8 flex flex-col reveal " + (inView ? "is-in" : "")} style={{ animationDelay: "0.1s" }}>
            <div className="flex items-center justify-between mb-6">
              <span className="font-mono text-[11px] tracking-[0.3em] uppercase text-parchment/50">Composer</span>
              <span className="font-mono text-[10px] tracking-[0.2em] uppercase text-parchment/35">sealed · {count}</span>
            </div>

            <div className="flex flex-wrap gap-2 mb-6">
              {PRESETS.map((p, i) => (
                <button key={i} onClick={() => usePreset(i)}
                  className={"font-mono text-[11px] px-3 py-1.5 rounded-full border transition-colors duration-200 whitespace-nowrap " +
                    (preset === i ? "border-gold/70 text-gold bg-gold/10" : "border-parchment/20 text-parchment/70 hover:border-gold/60 hover:text-parchment")}>
                  {p.label}
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
              {phase === "sealing" ? "Sealing…" : (phase === "done" ? "Seal another" : "Seal this decision")}
              {phase !== "sealing" && (
                <span className="w-7 h-7 rounded-full bg-obsidian flex items-center justify-center group-hover:scale-110 transition-transform duration-300">
                  <ArrowRightT size={13} className="text-parchment -rotate-45" />
                </span>
              )}
            </button>

            {/* verify actions — only when sealed */}
            {phase === "done" && receipt && (
              <div className="mt-4 flex gap-3" style={{ animation: "fadeUp 0.4s cubic-bezier(0.16,1,0.3,1) both" }}>
                <button onClick={() => verify(false)} disabled={verifyPhase === "verifying"}
                  className="flex-1 py-2.5 rounded-full border border-parchment/25 font-mono text-xs text-parchment/75 hover:border-gold/60 hover:text-parchment transition-colors duration-200 disabled:opacity-50">
                  {verifyPhase === "verifying" ? "Verifying…" : "✓ Verify hash"}
                </button>
                <button onClick={() => verify(true)} disabled={verifyPhase === "verifying"}
                  className="flex-1 py-2.5 rounded-full border border-parchment/25 font-mono text-xs text-parchment/75 hover:border-red-400/60 hover:text-red-400/90 transition-colors duration-200 disabled:opacity-50">
                  ✗ Simulate tamper
                </button>
              </div>
            )}
          </div>

          {/* output */}
          <div className={"rounded-[2rem] border border-parchment/15 bg-ink/60 overflow-hidden flex flex-col reveal " + (inView ? "is-in" : "")} style={{ animationDelay: "0.22s" }}>
            <div className="flex items-center justify-between px-6 py-4 border-b border-parchment/15 bg-obsidian-soft">
              <span className="font-mono text-[11px] tracking-[0.3em] uppercase text-parchment/55">
                {verifyPhase === "done" ? "Verification" : "Attestation"}
              </span>
              <span className="flex items-center gap-2 font-mono text-[10px] tracking-[0.2em] uppercase"
                style={{ color: verifyPhase === "done" ? (verifyResult?.integrity === "intact" ? "#7bbf8a" : "#d4786a") : (phase === "done" ? "#7bbf8a" : (phase === "failed" ? "#d4786a" : "rgba(236,230,214,0.35)")) }}>
                <span style={{ width: 6, height: 6, borderRadius: "50%", background: verifyPhase === "done" ? (verifyResult?.integrity === "intact" ? "#7bbf8a" : "#d4786a") : (phase === "done" ? "#7bbf8a" : (phase === "failed" ? "#d4786a" : "#5a554c")), boxShadow: (phase === "done" || verifyPhase === "done") ? "0 0 8px currentColor" : "none" }} />
                {verifyPhase === "done" ? (verifyResult?.integrity === "intact" ? "Verified" : "Compromised") : (phase === "done" ? "Sealed" : (phase === "failed" ? "Failed" : "Awaiting"))}
              </span>
            </div>

            <div className="p-6 md:p-8 flex-1 flex flex-col overflow-y-auto">
              {/* steps tracker — hidden when showing verify result */}
              {verifyPhase !== "done" && (
                <div className="flex flex-col gap-3 mb-6">
                  {STEPS.map((s, i) => {
                    const active = step >= i;
                    const current = step === i && phase === "sealing";
                    return (
                      <div key={s.k} className="flex items-center gap-3 transition-opacity duration-300" style={{ opacity: active ? 1 : 0.3 }}>
                        <span className="flex items-center justify-center w-5 h-5 rounded-full border text-[9px] font-mono shrink-0 transition-colors duration-300"
                          style={{ borderColor: active ? "#d4af6a" : "rgba(236,230,214,0.25)", color: active ? "#d4af6a" : "rgba(236,230,214,0.4)", background: active ? "rgba(212,175,106,0.12)" : "transparent" }}>
                          {active ? "✓" : i + 1}
                        </span>
                        <span className="font-mono text-xs text-parchment/85 w-24 shrink-0">{s.k}</span>
                        <span className="font-mono text-[11px] text-parchment/40 truncate">{s.d}</span>
                        {current && <span className="w-1.5 h-1.5 rounded-full bg-gold animate-pulse ml-auto" />}
                      </div>
                    );
                  })}
                </div>
              )}

              {verifyPhase !== "done" && <div className="hairline mb-6" />}

              {/* verify result */}
              {verifyPhase === "done" && verifyResult ? (
                <div className="font-mono text-xs md:text-[13px] flex flex-col" style={{ animation: "fadeUp 0.5s cubic-bezier(0.16,1,0.3,1) both" }}>
                  {[
                    ["memory_id",     verifyResult.memory_id],
                    ["content_hash",  verifyResult.content_hash],
                    ["recomputed",    verifyResult.recomputed],
                    ["hash_verified", String(verifyResult.hash_verified)],
                    ["integrity",     verifyResult.integrity],
                    ["anchor_status", verifyResult.anchor_status],
                    ["verified_at",   verifyResult.verified_at],
                  ].map((r) => {
                    const isIntegrity = r[0] === "integrity";
                    const isHash = r[0] === "hash_verified";
                    const color = isIntegrity
                      ? (r[1] === "intact" ? "#7bbf8a" : "#d4786a")
                      : (isHash ? (r[1] === "true" ? "#7bbf8a" : "#d4786a") : null);
                    const isLongHash = (r[0] === "content_hash" || r[0] === "recomputed");
                    return (
                      <div key={r[0]} className="flex items-baseline gap-4 py-1.5 border-b border-parchment/[0.06] last:border-0">
                        <span className="text-parchment/40 w-28 shrink-0">{r[0]}</span>
                        <span className="break-all" style={{ color: color || "rgba(236,230,214,0.9)" }}>
                          {isLongHash ? hashShort(r[1]) : r[1]}
                          {isLongHash && <CopyBtn text={r[1]} />}
                        </span>
                      </div>
                    );
                  })}
                  {verifyResult.tampered && !verifyResult.hash_verified && (
                    <div className="mt-4 rounded-xl border border-red-400/20 bg-red-400/[0.06] px-4 py-3 font-mono text-[11px] text-red-400/80 leading-relaxed">
                      One byte changed in the rationale hash → SHA-256 cascade → recomputed hash doesn't match stored hash. This is why cryptographic attestation works.
                    </div>
                  )}
                  {!verifyResult.tampered && verifyResult.hash_verified && (
                    <div className="mt-4 rounded-xl border border-green-400/20 bg-green-400/[0.06] px-4 py-3 font-mono text-[11px] text-green-400/80 leading-relaxed">
                      Recomputed SHA-256 matches stored content_hash exactly. Record is intact.
                    </div>
                  )}
                  <button onClick={() => { setVerifyPhase("idle"); setVerifyResult(null); }}
                    className="mt-4 font-mono text-[11px] text-parchment/40 hover:text-parchment/70 transition-colors text-left">
                    ← back to receipt
                  </button>
                </div>

              ) : receipt ? (
                <div className="font-mono text-xs md:text-[13px] flex flex-col" style={{ animation: "fadeUp 0.5s cubic-bezier(0.16,1,0.3,1) both" }}>
                  {[
                    ["memory_id",     receipt.memory_id],
                    ["agent",         receipt.agent],
                    ["action",        receipt.action],
                    ["content_hash",  receipt.content_hash],
                    ["metadata_hash", receipt.metadata_hash],
                    ["anchor_tx",     receipt.anchor_tx],
                    ["anchor_status", receipt.anchor_status],
                    ["policy",        receipt.policy],
                    ["sealed_at",     receipt.sealed_at],
                  ].map((r) => {
                    const isHash = ["content_hash", "metadata_hash", "anchor_tx"].includes(r[0]);
                    return (
                      <div key={r[0]} className="flex items-baseline gap-4 py-1.5 border-b border-parchment/[0.06] last:border-0">
                        <span className="text-parchment/40 w-28 shrink-0">{r[0]}</span>
                        <span className="text-parchment/90 break-all">
                          {isHash ? hashShort(r[1]) : r[1]}
                          {isHash && <CopyBtn text={r[1]} />}
                        </span>
                      </div>
                    );
                  })}
                  <div className="flex items-center gap-3 mt-5 pt-4 border-t border-parchment/15">
                    <span className="font-display text-gold text-base">✦</span>
                    <span className="text-parchment/55 text-[11px]">Sealed · verify or simulate tamper above</span>
                  </div>
                </div>
              ) : error ? (
                <div className="flex-1 flex items-center justify-center text-center py-8">
                  <span className="font-mono text-[12px] text-parchment/55 max-w-[22rem] leading-relaxed break-words">{error}</span>
                </div>
              ) : (
                <div className="flex-1 flex items-center justify-center text-center py-8">
                  <span className="font-serif italic text-parchment/35 text-base max-w-[16rem] leading-relaxed">
                    {phase === "sealing" ? "Computing hashes and sealing…" : "Seal a decision — receipt appears here."}
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
