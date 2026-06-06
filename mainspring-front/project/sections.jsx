/* global React, window */
const { useRef: useRefS, useState: useStateS, useEffect: useEffectS } = React;

const useRevealS = window.useReveal;
const ArrowRightS = window.ArrowRight;
const REPO_URL = "https://github.com/Micoh18/Mr-Mainspring";

/* ── shared bits ── */

function Eyebrow({ index, children, dark = false }) {
  return (
    <div className="flex items-center gap-3 font-mono text-[11px] tracking-[0.34em] uppercase"
      style={{ color: dark ? "rgba(21,18,13,0.55)" : "rgba(236,230,214,0.55)" }}>
      <span style={{ color: "#d4af6a" }}>{index}</span>
      <span className="w-8 h-px" style={{ background: dark ? "rgba(21,18,13,0.3)" : "rgba(236,230,214,0.3)" }} />
      <span>{children}</span>
    </div>
  );
}

/* ── [02] THE GAP ── */

function TheGap() {
  const [ref, inView] = useRevealS({ threshold: 0.25 });
  const points = [
    ["No witness", "An agent approves a payment, rebalances a treasury, ships a contract — and the only trace is a log file it could rewrite itself."],
    ["No proof", "When something goes wrong, \u201Ctrust me\u201D is not an answer. There is no record an auditor, a regulator, or a counterparty can independently verify."],
    ["No memory", "Decisions evaporate the moment they\u2019re made. The chain of reasoning that mattered most is the first thing lost."],
  ];
  return (
    <section id="gap" ref={ref} className="bg-obsidian px-6 md:px-12 lg:px-20 py-28 md:py-40 relative">
      <div className="paper-grain absolute inset-0 opacity-[0.04] mix-blend-overlay pointer-events-none" />
      <div className="max-w-[1320px] mx-auto relative">
        <div className={"reveal " + (inView ? "is-in" : "")}>
          <Eyebrow index="02">The Gap</Eyebrow>
        </div>

        <div className="grid grid-cols-12 gap-y-12 md:gap-x-12 mt-10 md:mt-16 items-end">
          <h2 className={"col-span-12 md:col-span-8 reveal " + (inView ? "is-in" : "") + " font-display font-medium text-parchment text-[10vw] md:text-[5.6vw] lg:text-[5rem] leading-[0.95] tracking-[-0.02em]"}
            style={{ animationDelay: "0.08s" }}>
            Agents act<br />in the dark.
          </h2>
          <p className={"col-span-12 md:col-span-4 reveal " + (inView ? "is-in" : "") + " font-serif text-parchment/65 text-lg md:text-xl leading-[1.55]"}
            style={{ animationDelay: "0.18s" }}>
            Autonomous software now makes irreversible decisions at machine speed.
            The infrastructure to answer <span className="italic text-parchment">what it did, and why</span> never came with it.
          </p>
        </div>

        <div className="hairline my-16 md:my-20" />

        <div className="grid grid-cols-1 md:grid-cols-3 gap-px bg-parchment/10 border border-parchment/10">
          {points.map((p, i) => (
            <div key={p[0]}
              className={"bg-obsidian px-7 py-9 md:py-12 reveal " + (inView ? "is-in" : "")}
              style={{ animationDelay: `${0.25 + i * 0.12}s` }}>
              <div className="font-mono text-[11px] tracking-[0.3em] text-gold mb-5">0{i + 1}</div>
              <h3 className="font-display text-xl md:text-2xl text-parchment mb-3">{p[0]}</h3>
              <p className="font-serif text-parchment/60 text-base leading-[1.5]">{p[1]}</p>
            </div>
          ))}
        </div>
      </div>
    </section>
  );
}

/* ── [03] MODULES ── */

function Modules() {
  const [ref, inView] = useRevealS({ threshold: 0.18 });
  const mods = [
    {
      num: "I", part: "The Escapement", title: "Capture",
      body: "A lightweight hook sits beside your agent and meters every decision at the instant it is made — the intent, the inputs it weighed, the action it took.",
      meta: "SDK · 4 lines",
    },
    {
      num: "II", part: "The Barrel", title: "Anchor",
      body: "Each decision is hashed, sealed into an attestation, and written to Casper mainnet. No edits, no deletions — wound tight and held under tension, forever.",
      meta: "On-chain · immutable",
    },
    {
      num: "III", part: "The Balance", title: "Prove",
      body: "Query, replay, and cryptographically verify any past decision. Hand a counterparty a link, not a promise. The record keeps perfect time.",
      meta: "Verifiable · public",
    },
  ];
  return (
    <section id="modules" ref={ref} className="bg-obsidian-soft px-6 md:px-12 lg:px-20 py-28 md:py-40 border-y border-parchment/10">
      <div className="max-w-[1320px] mx-auto">
        <div className="flex flex-col md:flex-row md:items-end md:justify-between gap-8">
          <div className={"reveal " + (inView ? "is-in" : "")}>
            <Eyebrow index="03">Modules</Eyebrow>
            <h2 className="font-display font-medium text-parchment text-[9vw] md:text-[4.4vw] lg:text-[4rem] leading-[0.98] tracking-[-0.02em] mt-7">
              Three movements,<br />one mechanism.
            </h2>
          </div>
          <p className={"font-serif text-parchment/55 text-base md:text-lg max-w-xs leading-[1.55] reveal " + (inView ? "is-in" : "")}
            style={{ animationDelay: "0.15s" }}>
            Mainspring is built like a watch — discrete parts that only mean something when they turn together.
          </p>
        </div>

        <div className="grid grid-cols-1 md:grid-cols-3 gap-6 md:gap-8 mt-16 md:mt-24">
          {mods.map((m, i) => (
            <div key={m.num}
              className={"group relative border border-parchment/15 rounded-[2rem] p-8 md:p-10 bg-obsidian flex flex-col min-h-[420px] transition-colors duration-300 hover:border-gold/50 reveal " + (inView ? "is-in" : "")}
              style={{ animationDelay: `${0.1 + i * 0.14}s` }}>
              <div className="flex items-start justify-between">
                <span className="font-display text-5xl md:text-6xl text-gold/90 leading-none">{m.num}</span>
                <span className="font-mono text-[10px] tracking-[0.25em] uppercase text-parchment/40 mt-2">{m.meta}</span>
              </div>
              <div className="font-mono text-[11px] tracking-[0.3em] uppercase text-parchment/45 mt-10">{m.part}</div>
              <h3 className="font-display text-3xl md:text-4xl text-parchment mt-2">{m.title}</h3>
              <p className="font-serif text-parchment/65 text-base md:text-lg leading-[1.55] mt-5">{m.body}</p>
              <div className="mt-auto pt-8">
                <span className="inline-block w-full h-px bg-gradient-to-r from-gold/40 to-transparent group-hover:from-gold/80 transition-all duration-500" />
              </div>
            </div>
          ))}
        </div>
      </div>
    </section>
  );
}

/* ── [04] THE LOOP (parchment / clockface) ── */

function TheLoop() {
  const [ref, inView] = useRevealS({ threshold: 0.2 });
  // 4 stations at 12 / 3 / 6 / 9
  const stations = [
    { pos: "top", n: "I", label: "Act", desc: "Your agent decides." },
    { pos: "right", n: "II", label: "Witness", desc: "Mainspring meters it." },
    { pos: "bottom", n: "III", label: "Anchor", desc: "Sealed to Casper." },
    { pos: "left", n: "IV", label: "Prove", desc: "Anyone can verify." },
  ];
  const place = {
    top: { top: "-2%", left: "50%", transform: "translate(-50%,-50%)", align: "center" },
    right: { top: "50%", left: "100%", transform: "translate(-50%,-50%)", align: "left" },
    bottom: { top: "102%", left: "50%", transform: "translate(-50%,-50%)", align: "center" },
    left: { top: "50%", left: "0%", transform: "translate(-50%,-50%)", align: "right" },
  };
  return (
    <section id="loop" ref={ref} className="bg-parchment text-obsidian px-6 md:px-12 lg:px-20 py-28 md:py-40 relative overflow-hidden">
      <div className="paper-grain absolute inset-0 opacity-[0.5] mix-blend-multiply pointer-events-none" />
      <div className="max-w-[1320px] mx-auto relative">
        <div className="flex flex-col items-center text-center">
          <div className={"reveal " + (inView ? "is-in" : "")}>
            <Eyebrow index="04" dark>The Loop</Eyebrow>
          </div>
          <h2 className={"font-display font-medium text-[10vw] md:text-[4.6vw] lg:text-[4.25rem] leading-[1] tracking-[-0.02em] mt-7 max-w-3xl reveal " + (inView ? "is-in" : "")}
            style={{ animationDelay: "0.08s" }}>
            Every decision runs the same clock.
          </h2>
          <p className={"font-serif text-obsidian/65 text-lg md:text-xl max-w-xl leading-[1.55] mt-6 reveal " + (inView ? "is-in" : "")}
            style={{ animationDelay: "0.16s" }}>
            Four movements, turning continuously — from the moment an agent acts to the moment a stranger can prove it.
          </p>
        </div>

        {/* clockface diagram */}
        <div className="mx-auto mt-28 md:mt-32 mb-16 relative"
          style={{ width: "min(78vw, 460px)", height: "min(78vw, 460px)" }}>
          {/* ring */}
          <div className="absolute inset-0 rounded-full border border-obsidian/25" />
          <div className="absolute inset-[8%] rounded-full border border-obsidian/15" />
          {/* tick marks */}
          {Array.from({ length: 12 }).map((_, i) => (
            <span key={i}
              className="absolute left-1/2 top-1/2 origin-bottom"
              style={{
                width: 1, height: "50%",
                background: i % 3 === 0 ? "rgba(21,18,13,0.45)" : "rgba(21,18,13,0.18)",
                transform: `translate(-50%,-100%) rotate(${i * 30}deg)`,
                transformOrigin: "bottom center",
              }}
            >
              <span className="block" style={{ height: i % 3 === 0 ? 14 : 8, width: "100%", background: "inherit" }} />
            </span>
          ))}
          {/* center watch */}
          <div className="absolute left-1/2 top-1/2 -translate-x-1/2 -translate-y-1/2 flex flex-col items-center">
            <img src="assets/clock-icon.png" alt="" className="w-28 md:w-36 mix-blend-multiply select-none pointer-events-none" />
            <span className="font-mono text-[10px] tracking-[0.34em] uppercase text-obsidian/50 mt-1">The Loop</span>
          </div>
          {/* stations */}
          {stations.map((s) => {
            const p = place[s.pos];
            return (
              <div key={s.n} className="absolute" style={{ top: p.top, left: p.left, transform: p.transform }}>
                <div className="flex flex-col"
                  style={{ alignItems: p.align === "center" ? "center" : (p.align === "left" ? "flex-start" : "flex-end"), textAlign: p.align }}>
                  <div className="flex items-center justify-center w-11 h-11 rounded-full bg-obsidian text-parchment font-display text-base">{s.n}</div>
                  <div className="font-display text-xl md:text-2xl mt-2 whitespace-nowrap">{s.label}</div>
                  <div className="font-mono text-[11px] text-obsidian/55 mt-0.5 whitespace-nowrap">{s.desc}</div>
                </div>
              </div>
            );
          })}
        </div>

        <p className="text-center font-mono text-[11px] tracking-[0.28em] uppercase text-obsidian/45 mt-24 md:mt-12">
          ↻ continuous · tamper-evident · always-on
        </p>
      </div>
    </section>
  );
}

/* ── [05] THE PROOF ── */

function TheProof() {
  const [ref, inView] = useRevealS({ threshold: 0.18 });
  const rows = [
    ["decision_id", "0x9f3c\u20264a71e"],
    ["agent", "atlas-treasury-02"],
    ["action", "TRANSFER 12,400 CSPR"],
    ["rationale", "sha256:b8e1\u202609d2 (sealed)"],
    ["block", "#4,182,907"],
    ["sealed_at", "2026-06-05 09:14:22 UTC"],
  ];
  return (
    <section id="proof" ref={ref} className="bg-obsidian px-6 md:px-12 lg:px-20 py-28 md:py-40">
      <div className="max-w-[1320px] mx-auto">
        <div className={"reveal " + (inView ? "is-in" : "")}>
          <Eyebrow index="06">The Proof</Eyebrow>
        </div>

        <div className="grid grid-cols-12 gap-10 md:gap-16 mt-12 md:mt-16 items-start">
          {/* engraving on parchment panel */}
          <div className={"col-span-12 md:col-span-5 reveal " + (inView ? "is-in" : "")} style={{ animationDelay: "0.1s" }}>
            <div className="relative rounded-[2.5rem] overflow-hidden border border-parchment/15 aspect-[4/5]" style={{ background: "#c7bb9d" }}>
              <img src="assets/mr-mainspring-illus.png" alt="Mr. Mainspring, the on-chain witness"
                className="absolute inset-0 w-full h-full object-cover object-top mix-blend-multiply select-none"
                style={{ filter: "sepia(0.22) contrast(1.03) brightness(0.98)" }} />
              <div className="paper-grain absolute inset-0 opacity-30 mix-blend-multiply pointer-events-none z-10" />
              <div className="absolute inset-0 z-10 pointer-events-none" style={{ boxShadow: "inset 0 0 120px 26px rgba(20,17,11,0.5)" }} />
              <div className="absolute inset-x-0 bottom-0 h-32 z-10 pointer-events-none" style={{ background: "linear-gradient(to top, rgba(18,15,10,0.92), rgba(18,15,10,0.4) 40%, transparent)" }} />
              <div className="absolute bottom-5 left-7 font-mono text-[10px] tracking-[0.3em] uppercase text-parchment/70 z-20">
                Exhibit A — the witness
              </div>
            </div>
          </div>

          {/* claim + receipt */}
          <div className="col-span-12 md:col-span-7">
            <h2 className={"font-display font-medium text-parchment text-[9vw] md:text-[4vw] lg:text-[3.75rem] leading-[1] tracking-[-0.02em] reveal " + (inView ? "is-in" : "")}
              style={{ animationDelay: "0.14s" }}>
              “Trust me” becomes<br />a receipt.
            </h2>
            <p className={"font-serif text-parchment/65 text-lg leading-[1.55] mt-6 max-w-lg reveal " + (inView ? "is-in" : "")}
              style={{ animationDelay: "0.22s" }}>
              Every decision your agent makes resolves into a permanent, queryable, independently verifiable record on Casper mainnet. Here is one.
            </p>

            <div className={"mt-10 rounded-[2rem] border border-parchment/20 bg-ink/60 overflow-hidden reveal " + (inView ? "is-in" : "")}
              style={{ animationDelay: "0.3s" }}>
              <div className="flex items-center justify-between px-5 py-3 border-b border-parchment/15 bg-obsidian-soft">
                <span className="font-mono text-[10px] tracking-[0.3em] uppercase text-parchment/55">Attestation · Casper Mainnet</span>
                <span className="flex items-center gap-2 font-mono text-[10px] tracking-[0.2em] uppercase" style={{ color: "#7bbf8a" }}>
                  <span style={{ width: 6, height: 6, borderRadius: "50%", background: "#7bbf8a", boxShadow: "0 0 8px #7bbf8a" }} />
                  Immutable
                </span>
              </div>
              <div className="p-5 md:p-6 font-mono text-xs md:text-[13px]">
                {rows.map((r) => (
                  <div key={r[0]} className="flex items-baseline gap-4 py-1.5 border-b border-parchment/[0.06] last:border-0">
                    <span className="text-parchment/40 w-28 shrink-0">{r[0]}</span>
                    <span className="text-parchment/90 break-all">{r[1]}</span>
                  </div>
                ))}
                <div className="flex items-center gap-3 mt-5 pt-4 border-t border-parchment/15">
                  <span className="font-display text-gold text-lg">✦</span>
                  <span className="text-parchment/55">Sealed by Mr. Mainspring · verify at <span className="text-gold">cspr.live</span></span>
                </div>
              </div>
            </div>
          </div>
        </div>
      </div>
    </section>
  );
}

/* ── [06] REPO / CTA ── */

function Repo() {
  const [ref, inView] = useRevealS({ threshold: 0.2 });
  const [copied, setCopied] = useStateS(false);
  const cmd = "npm i @micoh/mainspring";
  const copy = () => {
    try { navigator.clipboard.writeText(cmd); } catch (e) {}
    setCopied(true); setTimeout(() => setCopied(false), 900);
  };
  return (
    <section id="repo" ref={ref} className="bg-obsidian-soft px-6 md:px-12 lg:px-20 py-28 md:py-44 border-t border-parchment/10 relative overflow-hidden">
      <div className="max-w-[1100px] mx-auto text-center relative">
        <div className={"reveal " + (inView ? "is-in" : "")}>
          <Eyebrow index="07">Repo</Eyebrow>
        </div>
        <h2 className={"font-display font-bold text-parchment text-[13vw] md:text-[8vw] lg:text-[7.5rem] leading-[0.9] tracking-[-0.04em] mt-8 reveal " + (inView ? "is-in" : "")}
          style={{ animationDelay: "0.08s" }}>
          Wind it up.
        </h2>
        <p className={"font-serif text-parchment/65 text-lg md:text-xl leading-[1.55] max-w-xl mx-auto mt-7 reveal " + (inView ? "is-in" : "")}
          style={{ animationDelay: "0.16s" }}>
          Four lines to give your agent a witness. Open source, Casper-native, free to verify forever.
        </p>

        <div className={"flex flex-col sm:flex-row items-center justify-center gap-4 mt-12 reveal " + (inView ? "is-in" : "")}
          style={{ animationDelay: "0.24s" }}>
          <a href={REPO_URL} target="_blank" rel="noreferrer"
            className="flex items-center gap-2 bg-parchment rounded-full pl-6 pr-1 py-1 group hover:gap-3 transition-all duration-300 w-fit">
            <span className="font-mono text-sm font-medium text-obsidian whitespace-nowrap">View the repo</span>
            <span className="bg-obsidian rounded-full w-10 h-10 flex items-center justify-center group-hover:scale-110 transition-transform duration-300">
              <ArrowRightS size={16} className="text-parchment -rotate-45" />
            </span>
          </a>
          <button onClick={copy}
            className="flex items-center gap-3 rounded-full border border-parchment/30 px-6 py-3 font-mono text-sm text-parchment/85 hover:border-parchment/60 transition-colors duration-200">
            <span className="text-parchment/40">$</span>
            {cmd}
            <span className="text-gold ml-1">{copied ? "copied ✓" : "⧉"}</span>
          </button>
        </div>

        <div className={"flex items-center justify-center gap-2 mt-16 reveal " + (inView ? "is-in" : "")} style={{ animationDelay: "0.32s" }}>
          <span style={{ width: 7, height: 7, borderRadius: "50%", background: "#ff4d4d", boxShadow: "0 0 8px #ff4d4d", animation: "pulse 2.4s infinite alternate" }} />
          <span className="font-mono text-[11px] tracking-widest" style={{ color: "#8a8398" }}>LIVE ON CASPER TESTNET</span>
        </div>
      </div>
    </section>
  );
}

/* ── FOOTER ── */

function Footer() {
  const cols = [
    ["Product", [["The Gap", "#top"], ["Modules", "#top"], ["The Loop", "#top"], ["The Proof", "#top"]]],
    ["Develop", [["Documentation", "#top"], ["SDK reference", "#top"], ["Repository", REPO_URL], ["Changelog", "#top"]]],
    ["Network", [["Casper Testnet", "#top"], ["Block explorer", "#top"], ["Status", "#top"], ["Verify a record", "#top"]]],
  ];
  return (
    <footer className="bg-obsidian px-6 md:px-12 lg:px-20 pt-20 pb-10 border-t border-parchment/10">
      <div className="max-w-[1320px] mx-auto">
        <div className="grid grid-cols-2 md:grid-cols-12 gap-y-12 gap-x-8">
          <div className="col-span-2 md:col-span-5">
            <div className="font-display" style={{ letterSpacing: "0.34em", fontSize: 18, color: "#ece6d6" }}>MAINSPRING</div>
            <p className="font-serif text-parchment/55 text-base leading-[1.55] mt-5 max-w-xs">
              An on-chain witness to every agent decision — capturing the moment, the action, and the reason it happened.
            </p>
          </div>
          {cols.map((c) => (
            <div key={c[0]} className="col-span-1 md:col-span-2 md:col-start-auto">
              <div className="font-mono text-[11px] tracking-[0.28em] uppercase text-parchment/40 mb-4">{c[0]}</div>
              <ul className="flex flex-col gap-2.5">
                {c[1].map(([label, href]) => (
                  <li key={label}>
                    <a
                      href={href}
                      target={href === REPO_URL ? "_blank" : undefined}
                      rel={href === REPO_URL ? "noreferrer" : undefined}
                      className="font-serif text-parchment/70 hover:text-parchment transition-colors"
                    >
                      {label}
                    </a>
                  </li>
                ))}
              </ul>
            </div>
          ))}
        </div>
        <div className="hairline my-10" />
        <div className="flex flex-col sm:flex-row items-center justify-between gap-4 font-mono text-[11px] tracking-wide text-parchment/40">
          <span>© 2026 Mainspring · Wound tight, kept honest.</span>
          <span className="flex items-center gap-2">
            <span style={{ width: 6, height: 6, borderRadius: "50%", background: "#ff4d4d", boxShadow: "0 0 8px #ff4d4d" }} />
            CASPER TESTNET
          </span>
        </div>
      </div>
    </footer>
  );
}

Object.assign(window, { TheGap, Modules, TheLoop, TheProof, Repo, Footer });
