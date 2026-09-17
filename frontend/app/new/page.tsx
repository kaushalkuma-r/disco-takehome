"use client";
import { useQuery } from "@tanstack/react-query";
import { useRouter } from "next/navigation";
import { useEffect, useMemo, useRef, useState } from "react";
import { Examples } from "@/components/Examples";
import { Shell } from "@/components/Shell";
import { ApiError, api } from "@/lib/api";
import { useApplyResponse, useSession } from "@/lib/session";
import type { ClarityResult, StageEvent } from "@/lib/types";
import { Icon, Pill, scoreCls, useToast } from "@/lib/ui";

const STEPS = ["Describe", "Clarify", "Generate", "Review"];
const STAGES = [
  ["Parsing brief", "extract product, buyer, price tier, model"], ["Scoring 20 publishers", "category · persona overlap · AOV · audience"],
  ["Selecting personas", "3–5 of 10, with fit scores"], ["Writing creative", "headline + body per persona"],
  ["Assembling config", "bid strategy, budget split, targeting"], ["Running checks", "11 validators + bounded repair"],
];

function Steps({ s }: { s: number }) {
  return (
    <div className="steps" aria-label="Progress">
      {STEPS.map((l, i) => (
        <span key={l} style={{ display: "contents" }}>
          <div className={`step ${s === i + 1 ? "on" : s > i + 1 ? "done" : ""}`}><b>{s > i + 1 ? <Icon name="check" size={12} /> : i + 1}</b>{l}</div>
          {i < 3 && <span className="sep" />}
        </span>
      ))}
    </div>
  );
}

export default function NewCampaign() {
  const { session } = useSession();
  const router = useRouter();
  const toast = useToast();
  const apply = useApplyResponse();
  const [step, setStep] = useState<1 | 2 | 3>(1);
  const [text, setText] = useState("");
  const [clar, setClar] = useState<ClarityResult | null>(null);
  const [answers, setAnswers] = useState<(string | null)[]>([]);      // final answer per question (chips joined, or free text)
  const [picked, setPicked] = useState<string[][]>([]);               // selected chips per question (multi-select aware)
  const [free, setFree] = useState<string[]>([]);
  const [checking, setChecking] = useState(false);
  const [stages, setStages] = useState<Record<string, StageEvent>>({});
  const [repairNote, setRepairNote] = useState("");
  const { data: est } = useQuery({ queryKey: ["estimate", "generate_campaign"], queryFn: () => api.estimate("generate_campaign"), enabled: !!session });
  const started = useRef(false);

  // A draft from the dashboard hero jumps straight to the clarity check.
  useEffect(() => {
    if (started.current) return;
    started.current = true;
    try {
      const d = sessionStorage.getItem("dcs.draft");
      if (d) { sessionStorage.removeItem("dcs.draft"); setText(d); void clarify(d); }
    } catch {}
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  async function clarify(t: string, ans: string[] = []) {
    setChecking(true);
    try {
      const r = await api.clarity(t, ans);
      setClar(r);
      setAnswers(new Array(r.questions.length).fill(null));
      setPicked(r.questions.map(() => []));
      setFree(new Array(r.questions.length).fill(""));
      setStep(2);
    } catch (e) {
      toast(e instanceof ApiError ? e.message : "Could not score the brief", "warn");
    } finally { setChecking(false); }
  }

  const vague = !!clar && clar.score < 60;
  const nQ = clar?.questions.length ?? 0;
  const nAnswered = answers.filter((a) => a && a.trim()).length;
  // Every question needs an answer (chip or typed) before generation is allowed — an empty answers array never counts as "all answered".
  const allAnswered = useMemo(() => !vague || (nQ > 0 && answers.length === nQ && nAnswered === nQ), [vague, nQ, answers, nAnswered]);
  const canAfford = (est?.balance ?? 0) >= (est?.base ?? 10);

  async function generate() {
    if (!clar) return;
    setStep(3);
    setStages({});
    setRepairNote("");
    try {
      const resp = await api.generate({ brief: text, answers: (answers.filter(Boolean) as string[]) }, (ev) => {
        setStages((s) => ({ ...s, [ev.stage]: ev }));
        if (ev.detail.startsWith("repairing")) setRepairNote(ev.detail);
      });
      apply.campaign(resp);
      toast(`Campaign built · ${resp.credits.charged} credits (${resp.credits.base} base + ${resp.credits.usage} usage)`);
      router.push(`/campaign/?id=${resp.campaign.id}`);
    } catch (e) {
      const err = e instanceof ApiError ? e : null;
      if (err?.code === "clarity_too_low" && err.payload) {
        const r = err.payload as ClarityResult;
        setClar(r); setAnswers(new Array(r.questions.length).fill(null)); setPicked(r.questions.map(() => [])); setFree(new Array(r.questions.length).fill("")); setStep(2);
        toast("The brief still needs more detail — please answer the questions.", "info"); return;
      }
      toast(err?.code === "insufficient_credits" ? "Not enough credits to generate." : `Generation failed — nothing was charged. ${err?.message || ""}`, "warn");
      setStep(2);
    }
  }

  return (
    <Shell crumb="New campaign">
      <div className="stack lg">
        <Steps s={step} />
        {step === 1 && (
          <div className="stack lg" style={{ maxWidth: 760 }}>
            <div><h1>What do you sell, and to whom?</h1><p className="sub">One or two sentences. Price point, business model and the buyer you have in mind all help.</p></div>
            <div className="hero-input">
              <label className="sr-only" htmlFor="desc">Business description</label>
              <textarea className="textarea" id="desc" placeholder="We sell…" value={text} onChange={(e) => setText(e.target.value)} />
              <div className="row between wrap">
                <Examples onPick={setText} />
                <button className="btn primary" id="next" disabled={checking || !text.trim()} onClick={() => clarify(text.trim())}>{checking ? "Checking…" : "Check clarity"} <Icon name="arrow" /></button>
              </div>
            </div>
            <div className="banner"><Icon name="info" /><span>Clarity checks are free. Vague or off-topic input is fine — the next step asks for what it needs before any credits are spent.</span></div>
          </div>
        )}

        {step === 2 && clar && (
          <div className="stack lg" style={{ maxWidth: 820 }}>
            <div><h1>{vague ? "We need a little more to match well." : "Got it. Here's what we understood."}</h1><p className="sub">Input clarity is scored before anything is generated, so a vague brief never produces a confident-looking wrong plan.</p></div>
            <div className="card pad" style={{ display: "flex", gap: 22, alignItems: "center", flexWrap: "wrap" }}>
              <Meter score={clar.score} label={clar.label} />
              <div className="grow stack" style={{ minWidth: 240 }}>
                <span className="eyebrow">Your input</span>
                <p style={{ fontSize: 15 }}>“{text}”</p>
                <div className="divider" />
                <div className="row wrap" style={{ gap: 6 }}>
                  {clar.signals.map((s) => <Pill key={s} tone={/not stated/i.test(s) ? "bad" : "good"}><Icon name={/not stated/i.test(s) ? "x" : "check"} /> {s}</Pill>)}
                </div>
                {!vague && <p className="help"><b style={{ color: "var(--ink)" }}>Interpretation:</b> {clar.summary}</p>}
              </div>
            </div>
            {vague && (
              <div className="stack">
                {clar.questions.map((q, i) => (
                  <div className="q" key={q.q} style={answers[i] ? { borderColor: "var(--good)" } : undefined}>
                    <div className="qt row between"><span>{i + 1}. {q.q} {q.multi && <span className="help" style={{ fontWeight: 500 }}>(choose all that apply)</span>}</span>{answers[i] ? <Pill tone="good"><Icon name="check" /> answered</Pill> : <Pill tone="warn">required</Pill>}</div>
                    <div className="opts">
                      {q.opts.map((o) => <button type="button" key={o} className={`chip ${(picked[i] || []).includes(o) ? "on" : ""}`} onClick={() => {
                        const cur = picked[i] || [];
                        const next = q.multi ? (cur.includes(o) ? cur.filter((v) => v !== o) : [...cur, o]) : [o];
                        setPicked((p) => p.map((x, j) => (j === i ? next : x)));
                        setAnswers((a) => a.map((x, j) => (j === i ? (next.length ? next.join(", ") : null) : x)));
                        setFree((f) => f.map((x, j) => (j === i ? "" : x)));
                      }}>{o}</button>)}
                      <label className="sr-only" htmlFor={`free${i}`}>Other answer</label>
                      <input className="input" id={`free${i}`} style={{ height: 32, maxWidth: 220 }} placeholder="Or type your own…" value={free[i] || ""}
                        onChange={(e) => { const v = e.target.value; setFree((f) => f.map((x, j) => (j === i ? v : x))); setPicked((p) => p.map((x, j) => (j === i ? [] : x))); setAnswers((a) => a.map((x, j) => (j === i ? (v.trim() || null) : x))); }} />
                    </div>
                  </div>
                ))}
              </div>
            )}
            {!canAfford && est && <div className="banner bad"><Icon name="warn" /><span>You have {est.balance} credits; generating needs at least {est.base}. Edits, exports and compare still work.</span></div>}
            <div className="row between wrap">
              <button className="btn ghost" onClick={() => setStep(1)}><Icon name="back" /> Edit description</button>
              <div className="row wrap">
                <span className="help">{vague ? (allAnswered ? `All ${nQ} answered · ${est?.balance ?? ""} credits available` : `Answer all ${nQ} to continue (${nAnswered} of ${nQ})`) : ""}</span>
                <button className="btn primary" id="gen" disabled={!allAnswered || !canAfford || checking} onClick={generate} title={!allAnswered ? "Answer every question first" : undefined}><Icon name="spark" /> Generate campaign <span className="cost">· ~{est?.total ?? 12} credits</span></button>
              </div>
            </div>
          </div>
        )}

        {step === 3 && (
          <div className="stack lg" style={{ maxWidth: 640 }}>
            <div><h1>Building your campaign</h1><p className="sub">{vague ? "Using your answers: " + answers.filter(Boolean).join(" · ") : "Stages stream live from the server as each tool finishes. Credits are reserved now and settled from actual usage."}</p></div>
            <div className="progress" aria-live="polite">
              {STAGES.map(([t, d]) => {
                const ev = stages[t];
                const st = ev?.status === "done" ? "done" : ev ? "run" : "";
                return (
                  <div key={t} className={`pstep ${st}`}>
                    <span className="ic">{st === "done" && <Icon name="check" size={12} />}</span>
                    <span><b>{t}</b> <span className="help">— {ev?.status === "done" && ev.detail ? ev.detail : d}</span></span>
                    <span className="d">{ev?.status === "done" && ev.ms ? (ev.ms / 1000).toFixed(1) + "s" : ""}</span>
                  </div>
                );
              })}
            </div>
            {repairNote && <div className="banner purple"><Icon name="shield" /><span>{repairNote}</span></div>}
          </div>
        )}
      </div>
    </Shell>
  );
}

function Meter({ score, label }: { score: number; label: string }) {
  const r = 52, c = 2 * Math.PI * r;
  return (
    <div className="meter" role="img" aria-label={`Clarity ${score} of 100`}>
      <svg viewBox="0 0 120 120">
        <circle cx="60" cy="60" r={r} fill="none" stroke="var(--line-2)" strokeWidth="10" />
        <circle cx="60" cy="60" r={r} fill="none" stroke={`var(--${scoreCls(score)})`} strokeWidth="10" strokeLinecap="round" strokeDasharray={c} strokeDashoffset={c * (1 - score / 100)} />
      </svg>
      <div className="c"><div><b className="num">{score}</b><small>{label}</small></div></div>
    </div>
  );
}
