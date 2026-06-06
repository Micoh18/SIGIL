/* global React */
const { useRef, useEffect, useState, useCallback } = React;

/* ───────────────────────── shared helpers ───────────────────────── */

// IntersectionObserver-based reveal for scroll sections
function useReveal(options) {
  const ref = useRef(null);
  const [inView, setInView] = useState(false);
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const io = new IntersectionObserver(
      (entries) => {
        entries.forEach((e) => {
          if (e.isIntersecting) {
            setInView(true);
            io.unobserve(e.target);
          }
        });
      },
      { threshold: options && options.threshold != null ? options.threshold : 0.2 }
    );
    io.observe(el);
    return () => io.disconnect();
  }, []);
  return [ref, inView];
}

function ArrowRight({ size = 16, className = "" }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none"
      stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"
      className={className}>
      <line x1="5" y1="12" x2="19" y2="12" />
      <polyline points="12 5 19 12 12 19" />
    </svg>
  );
}

function CopyIcon({ size = 12, done = false }) {
  if (done) {
    return (
      <svg width={size} height={size} viewBox="0 0 24 24" fill="none"
        stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round">
        <polyline points="20 6 9 17 4 12" />
      </svg>
    );
  }
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none"
      stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <rect x="9" y="9" width="13" height="13" rx="2" ry="2" />
      <path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1" />
    </svg>
  );
}

/* ───────────────────────── typewriter ───────────────────────── */

function Typewriter({ text, start, speed = 26, startDelay = 700 }) {
  const [out, setOut] = useState("");
  const [done, setDone] = useState(false);
  useEffect(() => {
    if (!start) return;
    let i = 0;
    let timer = null;
    const begin = setTimeout(() => {
      timer = setInterval(() => {
        i += 1;
        setOut(text.slice(0, i));
        if (i >= text.length) {
          clearInterval(timer);
          setDone(true);
        }
      }, speed);
    }, startDelay);
    return () => { clearTimeout(begin); if (timer) clearInterval(timer); };
  }, [start, text]);
  return (
    <span>
      {out}
      {!done && (
        <span
          className="inline-block w-[2px] h-[1em] bg-parchment align-middle ml-[2px]"
          style={{ animation: "blink 1s step-end infinite" }}
        />
      )}
    </span>
  );
}

/* ───────────────────────── navbar ───────────────────────── */

const NAV_LINKS = [
  { label: "The Gap", href: "#gap" },
  { label: "Modules", href: "#modules" },
  { label: "The Loop", href: "#loop" },
  { label: "Try It", href: "#try" },
  { label: "The Proof", href: "#proof" },
  { label: "Docs", href: "Documentation.html" },
];

function Navbar() {
  return (
    <nav className="absolute top-0 left-1/2 -translate-x-1/2 z-30 pt-5 md:pt-6">
      <div
        className="flex items-center gap-5 sm:gap-8 md:gap-10 rounded-full px-6 md:px-8 py-2.5 border border-black/80"
        style={{
          background: "rgba(15,12,8,0.42)",
          backdropFilter: "blur(20px) saturate(140%)",
          WebkitBackdropFilter: "blur(20px) saturate(140%)",
          boxShadow: "inset 0 1px 0 rgba(255,255,255,0.06), 0 8px 26px rgba(0,0,0,0.45)",
        }}
      >
        {NAV_LINKS.map((l) => (
          <a key={l.label} href={l.href}
            className="font-mono text-[10px] md:text-[11px] tracking-[0.22em] uppercase text-parchment/90 hover:text-parchment transition-colors duration-200 whitespace-nowrap">
            {l.label}
          </a>
        ))}
      </div>
    </nav>
  );
}

/* ───────────────────────── hero ───────────────────────── */

function Hero() {
  const videoRef = useRef(null);
  const [mounted, setMounted] = useState(false);
  const [copied, setCopied] = useState(false);

  const copyEmail = () => {
    try { navigator.clipboard.writeText("hello@tellus.coop"); } catch (e) {}
    setCopied(true);
    setTimeout(() => setCopied(false), 500);
  };

  useEffect(() => {
    const t = setTimeout(() => setMounted(true), 60);
    return () => clearTimeout(t);
  }, []);

  // video plays continuously in the background, looping
  useEffect(() => {
    const v = videoRef.current;
    if (!v) return;

    const reduce = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    if (reduce) return; // poster only, no motion

    v.loop = true;
    v.muted = true;
    v.volume = 0;
    const tryPlay = () => { const p = v.play(); if (p && p.catch) p.catch(() => {}); };
    if (v.readyState >= 2) tryPlay();
    else v.addEventListener("canplay", tryPlay, { once: true });

    return () => v.removeEventListener("canplay", tryPlay);
  }, []);

  const ease = "cubic-bezier(0.16,1,0.3,1)";
  const headingClass =
    "font-display font-bold text-[13vw] sm:text-[12vw] md:text-[10vw] lg:text-[8.5vw] xl:text-[8rem] leading-[0.82] tracking-[-0.045em] block";
  const headingFront = {
    color: "rgba(236,230,214,0.94)",
    textShadow: "0 1px 0 rgba(0,0,0,0.35), 0 6px 12px rgba(0,0,0,0.55), 0 26px 60px rgba(0,0,0,0.7)",
  };

  return (
    <section id="top" className="h-screen p-4 md:p-6 bg-obsidian">
      <div className="relative w-full h-full rounded-2xl md:rounded-[2rem] overflow-hidden">

        {/* video background */}
        <video
          ref={(el) => { videoRef.current = el; if (el) { el.muted = true; el.defaultMuted = true; el.volume = 0; } }}
          src="assets/mainspring-hero.mp4"
          poster="assets/mainspring-frame-1.png"
          muted
          loop
          autoPlay
          playsInline
          preload="auto"
          className="absolute inset-0 w-full h-full object-cover object-[70%_center]"
          style={{ zIndex: 0 }}
        />

        {/* noise overlay */}
        <div className="noise-overlay absolute inset-0 opacity-[0.65] mix-blend-overlay pointer-events-none" style={{ zIndex: 1 }} />

        {/* gradient scrim */}
        <div className="absolute inset-0 bg-gradient-to-b from-black/45 via-transparent to-black/65 pointer-events-none" style={{ zIndex: 1 }} />

        <Navbar />

        {/* hero content */}
        <div className="absolute inset-0 z-20 flex flex-col justify-between">

          {/* top-left — intro line, blurred with mirror reflection */}
          <div
            className={"reveal " + (mounted ? "is-in " : "") + "pt-24 md:pt-28 pl-5 md:pl-8 pr-5 max-w-[34rem]"}
            style={{ animationDelay: "0.5s" }}
          >
            <div
              className="font-mono text-parchment text-sm sm:text-base md:text-lg leading-[1.4] inline-block"
              style={{
                minHeight: 56,
                WebkitBoxReflect: "below 0.14em linear-gradient(to bottom, rgba(255,255,255,0.55) 0%, rgba(255,255,255,0.12) 48%, transparent 80%)",
              }}
            >
              <Typewriter
                start={mounted}
                text={"Every transaction has its moment. Every decision, its mark. What's your agent building?"}
              />
            </div>
          </div>

          {/* bottom-left — wordmark, set back with depth shadow */}
          <div className="pl-5 md:pl-8 pb-7 md:pb-12 select-none">
            <span className={"pull-line " + (mounted ? "is-in" : "")}>
              <span className={headingClass} style={Object.assign({ animationDelay: "0.1s" }, headingFront)}>AGENT</span>
            </span>
            <span className={"pull-line " + (mounted ? "is-in" : "")}>
              <span className={headingClass} style={Object.assign({ animationDelay: "0.2s" }, headingFront)}>WITNESS</span>
            </span>
          </div>
        </div>
      </div>
    </section>
  );
}

Object.assign(window, { Hero, useReveal, ArrowRight, CopyIcon, Typewriter });
