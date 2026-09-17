"use client";
import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { Suspense, useEffect, useRef, useState, type FormEvent } from "react";
import { Shell } from "@/components/Shell";
import { ApiError, api } from "@/lib/api";
import { useApplyResponse, useMe } from "@/lib/session";
import type { ChatCard, ChatMessage, CreditsInfo, YieldEvent } from "@/lib/types";
import { Icon, Pill, fmt$, scoreCls, useToast } from "@/lib/ui";

type Msg = { role: "user" | "assistant"; text: string; cards?: ChatCard[]; credits?: CreditsInfo; events?: YieldEvent[] };
const EXAMPLES_START = [
  "We sell premium dog food for senior dogs, targeting owners who care about joint health and longevity. Grain-free, vet-formulated, subscription-based.",
  "A sustainable activewear brand for women. Made from recycled ocean plastic. Price point sits between Lululemon and Girlfriend Collective.",
  "We help people feel better.",
];
const EXAMPLES_DONE = ["Why does the top publisher rank first?", "Drop the lowest publisher", "Make variant B punchier", "Never use Swiftcart", "Remember that our AOV is $85", "Export as PDF"];

export default function ChatPage() { return <Suspense fallback={null}><ChatInner /></Suspense>; }

function ChatInner() {
  const params = useSearchParams();
  const initialCampaign = params.get("c");
  const { data: me } = useMe();
  const toast = useToast();
  const apply = useApplyResponse();
  const [threadId, setThreadId] = useState<string | null>(null);
  const [campaignId, setCampaignId] = useState<string | null>(initialCampaign);
  const [msgs, setMsgs] = useState<Msg[]>([]);
  const [input, setInput] = useState("");
  const [busy, setBusy] = useState(false);
  const [live, setLive] = useState<YieldEvent[]>([]);   // progress of the turn in flight, folded by event_id
  const bottom = useRef<HTMLDivElement>(null);

  // Restore the last thread for this campaign (or the most recent thread) from the server.
  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const threads = await api.threads();
        const t = initialCampaign ? threads.find((x) => x.campaign_id === initialCampaign) : threads[0];
        if (t && !cancelled) {
          const th = await api.thread(t.id);
          setThreadId(th.thread_id); setCampaignId(th.campaign_id);
          setMsgs(th.messages.filter((m: ChatMessage) => m.role !== "tool").map((m: ChatMessage) => ({ role: m.role as "user" | "assistant", text: m.content.text || "", cards: m.cards })));
        }
      } catch {}
    })();
    return () => { cancelled = true; };
  }, [initialCampaign]);
  useEffect(() => { bottom.current?.scrollIntoView({ block: "end" }); }, [msgs, busy]);

  async function send(text: string) {
    text = text.trim(); if (!text || busy) return;
    setMsgs((m) => [...m, { role: "user", text }]); setInput(""); setBusy(true); setLive([]);
    let events: YieldEvent[] = [];
    try {
      const r = await api.chatStream({ message: text, thread_id: threadId, campaign_id: threadId ? undefined : campaignId }, (ev) => {
        events = fold(events, ev); setLive(events);
      });
      setThreadId(r.thread_id); if (r.campaign_id) setCampaignId(r.campaign_id);
      apply.credits(r.credits); apply.invalidate(["campaigns"]); if (r.campaign_id) apply.invalidate(["campaign", r.campaign_id]);
      setMsgs((m) => [...m, { role: "assistant", text: r.reply, cards: r.cards, credits: r.credits, events: events.filter((e) => e.kind === "tool_card" || e.kind === "tool_event") }]);
    } catch (e) {
      const msg = e instanceof ApiError ? (e.code === "insufficient_credits" ? `Not enough credits — free edits still work. ${e.message}` : e.message) : "Something went wrong; nothing was charged.";
      setMsgs((m) => [...m, { role: "assistant", text: msg }]);
      toast(msg, "warn");
    } finally { setBusy(false); setLive([]); }
  }
  const reset = () => { setThreadId(null); setCampaignId(null); setMsgs([]); };
  const first = (me?.user.name || "there").split(" ")[0];
  const suggestions = campaignId ? EXAMPLES_DONE : EXAMPLES_START;

  return (
    <Shell crumb={<>Chat{campaignId && <span>· campaign thread</span>}</>}>
      <div className="chat">
        <div className="msgs" role="log" aria-live="polite">
          {!msgs.length && (
            <div className="msg ai"><span className="ai-ic"><Icon name="spark" /></span><div className="b">
              Hi {first} — tell me what you sell and who buys it, and I&apos;ll build the campaign here. Clarity checks are free; generating costs ~12 credits.
              <div className="card minicard">
                <div className="r"><b>What I can do</b><Pill tone="purple">same tools as the wizard</Pill></div>
                <div className="r"><span>Build a campaign from a one-line brief</span><span className="help num">~12 cr</span></div>
                <div className="r"><span>Ask clarifying questions when the brief is vague</span><span className="help">free</span></div>
                <div className="r"><span>Drop publishers, change budget, export a brief</span><span className="help">free</span></div>
                <div className="r"><span>Rewrite a creative from your note</span><span className="help num">~3 cr</span></div>
                <div className="r"><span>Remember preferences (“never use Swiftcart”)</span><span className="help">free</span></div>
              </div>
            </div></div>
          )}
          {msgs.map((m, i) => (
            <div key={i} className={`msg ${m.role === "user" ? "me" : "ai"}`}>
              {m.role === "assistant" && <span className="ai-ic"><Icon name="spark" /></span>}
              <div className="b">
                {m.events && m.events.length > 0 && <Progress events={m.events} done />}
                {m.text}
                {m.cards?.map((c, j) => <Card key={j} card={c} onAnswer={(a) => send(a)} />)}
                {m.credits && <span className="cost">{m.credits.charged ? `${m.credits.charged} credits` : "no billable model call · free"} · {m.credits.balance} left</span>}
              </div>
            </div>
          ))}
          {busy && <div className="msg ai"><span className="ai-ic"><Icon name="spark" /></span><div className="b">{live.length ? <Progress events={live} /> : <span className="typing"><i /><i /><i /></span>}</div></div>}
          <div ref={bottom} />
        </div>
        <div>
          <div className="suggest">
            {suggestions.map((s) => <button type="button" key={s} className="chip" onClick={() => send(s)} disabled={busy}>{s.length > 44 ? s.slice(0, 42) + "…" : s}</button>)}
            {msgs.length > 0 && <button type="button" className="chip" onClick={reset}>New thread</button>}
          </div>
          <form className="composer" onSubmit={(e: FormEvent) => { e.preventDefault(); send(input); }}>
            <label className="sr-only" htmlFor="ci">Message</label>
            <input className="input" id="ci" placeholder="Describe your business, or tell me what to change…" autoComplete="off" value={input} onChange={(e) => setInput(e.target.value)} disabled={busy} />
            <button className="btn primary" type="submit" aria-label="Send" disabled={busy}><Icon name="send" /></button>
          </form>
        </div>
      </div>
    </Shell>
  );
}

/** Fold-by-id: a later event with the same event_id replaces the earlier one (Sentinel yield-events semantics). */
function fold(list: YieldEvent[], ev: YieldEvent): YieldEvent[] {
  const i = list.findIndex((x) => x.event_id === ev.event_id);
  if (i >= 0) { const next = list.slice(); next[i] = { ...list[i], ...ev }; return next; }
  return [...list, ev];
}

/** Live progress tree: thoughts as muted lines, tool cards with status, tool events nested under their card. */
function Progress({ events, done }: { events: YieldEvent[]; done?: boolean }) {
  const roots = events.filter((e) => e.kind !== "tool_event" && e.kind !== "turn_end");
  const children = (id: string) => events.filter((e) => e.kind === "tool_event" && e.parent_id === id);
  const last = roots[roots.length - 1];
  return (
    <div className="yields" style={done ? { opacity: 0.8 } : undefined}>
      {roots.map((e) => {
        if (e.kind === "thought") return (!done && e === last) ? <div key={e.event_id} className="yrow thought"><span className="typing"><i /><i /><i /></span>{e.title}</div> : null;
        if (e.kind === "head_text") return <div key={e.event_id} className="yrow text">{e.title}</div>;
        const st = e.status || "running";
        return (
          <div key={e.event_id} className={`ycard ${st}`}>
            <div className="yrow"><span className="yic">{st === "completed" ? <Icon name="check" size={11} /> : st === "failed" ? <Icon name="x" size={11} /> : null}</span><b>{e.title}</b>{e.detail && <span className="help"> · {e.detail}</span>}</div>
            {children(e.event_id).map((c) => <div key={c.event_id} className={`yrow sub ${c.status}`}><span className="yic">{c.status === "completed" ? <Icon name="check" size={10} /> : null}</span>{c.title}{c.detail && <span className="help"> · {c.detail}</span>}</div>)}
          </div>
        );
      })}
    </div>
  );
}

function QuestionsCard({ c, onAnswer }: { c: Record<string, any>; onAnswer: (a: string) => void }) { // eslint-disable-line @typescript-eslint/no-explicit-any
  const qs = c.questions as { q: string; opts: string[]; multi?: boolean }[];
  const [sel, setSel] = useState<string[][]>(qs.map(() => []));
  const [sent, setSent] = useState(false);
  const all = sel.every((s) => s.length > 0);
  const toggle = (i: number, o: string, multi: boolean) => setSel((x) => x.map((s, j) => (j !== i ? s : multi ? (s.includes(o) ? s.filter((v) => v !== o) : [...s, o]) : [o])));
  return (
    <div className="card minicard">
      <div className="r"><b>Clarity {c.score}/100 — a few questions first</b><span className="help">free</span></div>
      {qs.map((q, i) => (
        <div key={q.q}>
          <div style={{ fontWeight: 600, marginTop: 6 }}>{i + 1}. {q.q} {q.multi && <span className="help">(choose all that apply)</span>}</div>
          <div className="opts" style={{ marginTop: 6 }}>{q.opts.map((o) => <button type="button" key={o} className={`chip ${sel[i].includes(o) ? "on" : ""}`} disabled={sent} onClick={() => toggle(i, o, !!q.multi)}>{o}</button>)}</div>
        </div>
      ))}
      <div className="row between" style={{ marginTop: 8 }}>
        <span className="help">{all ? "All answered" : `Answer all ${qs.length} to continue`}</span>
        <button type="button" className="btn primary sm" disabled={!all || sent} onClick={() => { setSent(true); onAnswer(qs.map((q, i) => `${q.q} → ${sel[i].join(", ")}`).join("; ")); }}>Send answers</button>
      </div>
    </div>
  );
}

function Card({ card, onAnswer }: { card: ChatCard; onAnswer: (a: string) => void }) {
  const c = card as Record<string, any>; // eslint-disable-line @typescript-eslint/no-explicit-any
  switch (card.type) {
    case "campaign_summary":
      return (
        <div className="card minicard">
          <div className="r"><b>{c.name}</b><Pill tone={scoreCls(c.clarity)}>Clarity {c.clarity}</Pill></div>
          {(c.publishers as { id: string; name: string; score: number }[]).slice(0, 3).map((p, i) => <div className="r" key={p.id}><span>{i + 1}. {p.name}</span><b className="num">{p.score}</b></div>)}
          <div className="r"><span className="help">{c.creatives} creatives · {fmt$(c.budget_total)} · {String(c.bid_strategy || "").replace(/_/g, " ")} · v{c.version} · checks {c.checks_passing}/{c.checks_total}</span></div>
          <div className="row" style={{ marginTop: 6 }}><Link className="btn primary sm" href={`/campaign/?id=${c.campaign_id}`}>Open campaign <Icon name="arrow" /></Link><Link className="btn sm" href={`/campaign/?id=${c.campaign_id}&tab=checks`}>Checks</Link></div>
        </div>
      );
    case "questions":
      return <QuestionsCard c={c} onAnswer={onAnswer} />;
    case "creative":
      return <div className="card minicard"><div className="r"><b>{c.persona}</b><Pill tone="purple">rewritten</Pill></div><b>{c.headline}</b><span>{c.body}</span><span className="help">CTA: {c.cta}</span></div>;
    case "memory_saved":
      return <div className="card minicard"><div className="r"><b>Saved to memory</b><Link href="/memory/" className="help">Manage</Link></div><span>{c.kind === "fact" ? `Fact: ${c.text}` : `${c.key}: ${Array.isArray(c.value) ? c.value.join(", ") : String(c.value)}`}</span></div>;
    case "export_link":
      return <div className="row" style={{ marginTop: 8 }}><Link className="btn sm" href={`/campaign/?id=${c.campaign_id}&tab=export`}><Icon name="dl" /> Preview & download</Link></div>;
    case "error":
      return <div className="banner bad" style={{ marginTop: 8 }}><Icon name="warn" /><span>{c.message}</span></div>;
    default:
      return null;
  }
}
