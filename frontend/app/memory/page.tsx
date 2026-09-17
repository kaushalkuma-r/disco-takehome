"use client";
import { useQuery } from "@tanstack/react-query";
import { useEffect, useState } from "react";
import { Shell } from "@/components/Shell";
import { api } from "@/lib/api";
import { useApplyResponse, useCatalog, useSession } from "@/lib/session";
import { Empty, Icon, Pill, dateS, dateT, useToast } from "@/lib/ui";

const STRATEGIES = ["target_cpa", "max_conversions_with_cpa_cap", "manual_cpm", "manual_cpc", "max_clicks"];

export default function MemoryPage() {
  const { session } = useSession();
  const { data: m, refetch } = useQuery({ queryKey: ["memory"], queryFn: api.memory, enabled: !!session });
  const { data: catalog } = useCatalog();
  const toast = useToast();
  const apply = useApplyResponse();
  const [voice, setVoice] = useState(""); const [banned, setBanned] = useState<string[]>([]); const [daily, setDaily] = useState(""); const [bid, setBid] = useState(""); const [words, setWords] = useState("");
  const [fact, setFact] = useState("");
  useEffect(() => {
    if (!m) return;
    const p = m.preferences as Record<string, unknown>;
    setVoice(String(p.brand_voice || "")); setBanned((p.banned_publishers as string[]) || []); setDaily(p.default_daily_budget ? String(p.default_daily_budget) : ""); setBid(String(p.bid_strategy_default || "")); setWords(((p.banned_words as string[]) || []).join(", "));
  }, [m]);
  const src = (k: string) => (m?.sources[k] ? `${m.sources[k].source} · ${dateS(m.sources[k].at)}` : "manual");
  const save = async () => {
    await Promise.all([
      api.putPreference("brand_voice", voice.trim() || null), api.putPreference("banned_publishers", banned), api.putPreference("default_daily_budget", daily ? Number(daily) : null),
      api.putPreference("bid_strategy_default", bid || null), api.putPreference("banned_words", words.split(",").map((s) => s.trim()).filter(Boolean)),
    ]);
    apply.invalidate(["me"]); refetch(); toast("Preferences saved — applied to the next generation and to checks");
  };
  const addFact = async () => { const t = fact.trim(); if (!t) return; await api.addFact(t); setFact(""); refetch(); toast("Fact remembered"); };
  const rm = async (id: string) => { await api.deleteFact(id); refetch(); };
  const n = Object.keys(m?.preferences || {}).length;
  return (
    <Shell crumb="Memory">
      <div><h1>Memory</h1><p className="sub">What the system believes about your brand. Preferences are hard constraints in every prompt and check; facts are context. Everything here is visible and deletable.</p></div>
      <div className="grid g2">
        <div className="card pad stack">
          <div className="row between"><h3>Preferences</h3><Pill tone="purple">{n} set</Pill></div>
          <div className="field"><label className="label" htmlFor="p_voice">Brand voice</label><textarea className="textarea" id="p_voice" style={{ minHeight: 72 }} placeholder="e.g. Understated, no exclamation marks, never say 'game-changing'" value={voice} onChange={(e) => setVoice(e.target.value)} /></div>
          <div className="field"><label className="label" htmlFor="p_ban">Banned publishers</label>
            <select className="input" id="p_ban" multiple size={5} value={banned} onChange={(e) => setBanned([...e.target.selectedOptions].map((o) => o.value))} style={{ height: "auto" }}>
              {catalog?.publishers.map((p) => <option key={p.id} value={p.id}>{p.name} · {p.category.replace(/_/g, " ")}</option>)}
            </select><span className="help">Hold Ctrl/⌘ to select several. Enforced by the <span className="kbd">banned_publishers</span> check.</span></div>
          <div className="field"><label className="label" htmlFor="p_words">Banned words</label><input className="input" id="p_words" placeholder="e.g. cheap, game-changing" value={words} onChange={(e) => setWords(e.target.value)} /></div>
          <div className="grid g2">
            <div className="field"><label className="label" htmlFor="p_daily">Default daily budget ($)</label><input className="input num" id="p_daily" type="number" placeholder="300" value={daily} onChange={(e) => setDaily(e.target.value)} /></div>
            <div className="field"><label className="label" htmlFor="p_bid">Default bid strategy</label><select className="input" id="p_bid" value={bid} onChange={(e) => setBid(e.target.value)}><option value="">Let the model decide</option>{STRATEGIES.map((o) => <option key={o}>{o}</option>)}</select></div>
          </div>
          <div className="row between wrap"><span className="help">Sources: {Object.keys(m?.preferences || {}).map((k) => `${k} (${src(k)})`).join(", ") || "none yet"}</span><button className="btn primary" onClick={save}>Save preferences</button></div>
        </div>
        <div className="card pad stack">
          <div className="row between"><h3>Facts</h3><Pill tone="purple">{m?.facts.length ?? 0}</Pill></div>
          <div className="row"><label className="sr-only" htmlFor="factText">New fact</label><input className="input" id="factText" placeholder="e.g. Our AOV is $85 · We can't ship to Canada" value={fact} onChange={(e) => setFact(e.target.value)} onKeyDown={(e) => e.key === "Enter" && addFact()} /><button className="btn" onClick={addFact}><Icon name="plus" /> Add</button></div>
          <div>{m?.facts.length ? m.facts.map((f) => <div className="memrow" key={f.id}><div><div className="k">{f.text}</div><div className="s">{f.source}{f.created_at ? ` · ${dateT(f.created_at)}` : ""}{f.campaign_id ? " · campaign-scoped" : ""}</div></div><button className="btn ghost sm icon" onClick={() => rm(f.id)} aria-label="Delete fact"><Icon name="trash" /></button></div>) : <Empty icon="brain" title="No facts yet"><span>Say “remember that…” in chat, or add one here.</span></Empty>}</div>
          <div className="banner purple"><Icon name="info" /><span>Memory is rendered into a ≤600-token block at the top of every prompt: preferences as constraints first, then the 10 most recent facts.</span></div>
        </div>
      </div>
    </Shell>
  );
}
