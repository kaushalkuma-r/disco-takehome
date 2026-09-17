"use client";
import { useMemo, useState } from "react";
import { ApiError, api } from "@/lib/api";
import { useApplyResponse } from "@/lib/session";
import type { Allocation, Campaign, Catalog, FeedbackRow } from "@/lib/types";
import { Icon, Pill, fmt$, useToast } from "@/lib/ui";
import { FeedbackButtons } from "./Feedback";

const OBJECTIVES = ["purchase", "subscription_signup", "trial_start", "lead", "traffic"];
const STRATEGIES = ["target_cpa", "max_conversions_with_cpa_cap", "manual_cpm", "manual_cpc", "max_clicks"];

/** Editable config with a live JSON panel (the same object POST /export.json returns). Saving is free. */
export function ConfigForm({ c, catalog, feedback }: { c: Campaign; catalog: Catalog; feedback?: FeedbackRow[] }) {
  const k = c.config!;
  const apply = useApplyResponse();
  const toast = useToast();
  const [f, setF] = useState({
    objective: k.objective, primary_kpi: k.primary_kpi, bid_strategy: k.bid.strategy, cpm: k.bid.cpm_range_usd, cpc: k.bid.cpc_range_usd,
    daily: k.budget.daily_usd, total: k.budget.total_usd, start: k.flight.start, end: k.flight.end, age: k.targeting.age_range, gender: k.targeting.gender,
    income: k.targeting.income_tiers.join(", "),
  });
  const [alloc, setAlloc] = useState<Allocation[]>(k.allocation.map((a) => ({ ...a })));
  const [busy, setBusy] = useState(false);
  const sum = alloc.reduce((s, a) => s + a.pct, 0);
  const name = (id: string) => catalog.publishers.find((p) => p.id === id)?.name || id;

  const json = useMemo(() => JSON.stringify({
    campaign_id: c.id, name: c.name, version: c.version, objective: f.objective, primary_kpi: f.primary_kpi,
    bid: { strategy: f.bid_strategy, cpm_range_usd: f.cpm, cpc_range_usd: f.cpc },
    budget: { daily_usd: Number(f.daily), total_usd: Number(f.total), currency: "USD", pacing: "even" }, flight: { start: f.start, end: f.end },
    targeting: { age_range: f.age, gender: f.gender, income_tiers: f.income.split(",").map((s) => s.trim()).filter(Boolean), geos: k.targeting.geos, interests: k.targeting.interests, exclude_contexts: k.targeting.exclude_contexts, personas: c.personas.map((p) => p.id) },
    placements: alloc.map((a) => ({ publisher_id: a.publisher_id, allocation_pct: a.pct, budget_usd: Math.round((Number(f.total) * a.pct) / 100), creative_ids: c.creatives.map((_, i) => `${c.id}_cr_${String.fromCharCode(65 + i)}`) })),
    creatives: c.creatives.map((x, i) => ({ id: `${c.id}_cr_${String.fromCharCode(65 + i)}`, persona_id: x.persona_id, headline: x.headline, body: x.body, cta: x.cta })),
    frequency_cap: k.frequency_cap, attribution: k.attribution,
  }, null, 2), [f, alloc, c, k]);

  const save = async () => {
    if (sum !== 100) { toast(`Allocation must total 100% (currently ${sum}%)`, "warn"); return; }
    setBusy(true);
    try {
      apply.campaign(await api.patch(c.id, { op: "set_config", config: {
        objective: f.objective, primary_kpi: f.primary_kpi, bid: { strategy: f.bid_strategy, cpm_range_usd: f.cpm, cpc_range_usd: f.cpc },
        budget: { daily_usd: Number(f.daily), total_usd: Number(f.total) }, flight: { start: f.start, end: f.end },
        targeting: { age_range: f.age, gender: f.gender, income_tiers: f.income.split(",").map((s) => s.trim()).filter(Boolean) }, allocation: alloc } }));
      toast("Config saved · free");
    } catch (e) { toast(e instanceof ApiError ? e.message : "Save failed", "warn"); }
    finally { setBusy(false); }
  };
  const copy = async () => { try { await navigator.clipboard.writeText(json); toast("Config JSON copied"); } catch { toast("Copy blocked by browser — select the JSON to copy", "info"); } };
  const set = (key: keyof typeof f) => (e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement>) => setF((x) => ({ ...x, [key]: e.target.value }));

  return (
    <div className="stack lg">
      <div className="row between wrap">
        <div><h3>Campaign config</h3><p className="help">Everything a downstream ad server needs. Fields are editable; the JSON updates live and is what <span className="kbd">PATCH /api/campaigns/:id</span> stores. Saving is free.</p></div>
        <div className="row"><button className="btn" onClick={copy}><Icon name="copy" /> Copy JSON</button><button className="btn primary" onClick={save} disabled={busy}>Save changes</button></div>
      </div>
      <div className="cfg">
        <div className="stack lg">
          <div className="card pad stack"><span className="eyebrow">Objective & bidding</span>
            <div className="kv">
              <label className="k" htmlFor="f_obj">Objective</label><span className="v"><select id="f_obj" value={f.objective} onChange={set("objective")}>{OBJECTIVES.map((o) => <option key={o}>{o}</option>)}</select></span>
              <label className="k" htmlFor="f_kpi">Primary KPI</label><span className="v full"><input id="f_kpi" value={f.primary_kpi} onChange={set("primary_kpi")} /></span>
              <label className="k" htmlFor="f_bid">Bid strategy</label><span className="v"><select id="f_bid" value={f.bid_strategy} onChange={set("bid_strategy")}>{STRATEGIES.map((o) => <option key={o}>{o}</option>)}</select></span>
              <label className="k" htmlFor="f_cpm">CPM range</label><span className="v"><input id="f_cpm" value={f.cpm} onChange={set("cpm")} /></span>
              <label className="k" htmlFor="f_cpc">CPC range</label><span className="v"><input id="f_cpc" value={f.cpc} onChange={set("cpc")} /></span>
            </div>
            <p className="help"><b>Why:</b> {k.bid.rationale}</p>
            <div className="row between"><span className="help">Was this bidding rationale useful?</span><FeedbackButtons campaignId={c.id} kind="config" targetId="bid" existing={feedback?.filter((r) => r.target_kind === "config").at(-1)} /></div>
          </div>
          <div className="card pad stack"><span className="eyebrow">Budget & flight</span>
            <div className="kv">
              <label className="k" htmlFor="f_daily">Daily budget</label><span className="v"><input id="f_daily" type="number" className="num" value={f.daily} onChange={set("daily")} /></span>
              <label className="k" htmlFor="f_total">Total budget</label><span className="v"><input id="f_total" type="number" className="num" value={f.total} onChange={set("total")} /></span>
              <span className="k">Flight</span><span className="v row wrap"><label className="sr-only" htmlFor="f_start">Start</label><input id="f_start" type="date" value={f.start} onChange={set("start")} /><span className="help">to</span><label className="sr-only" htmlFor="f_end">End</label><input id="f_end" type="date" value={f.end} onChange={set("end")} /></span>
            </div>
          </div>
          <div className="card pad stack"><span className="eyebrow">Targeting</span>
            <div className="kv">
              <label className="k" htmlFor="f_age">Age</label><span className="v"><input id="f_age" value={f.age} onChange={set("age")} /></span>
              <label className="k" htmlFor="f_gender">Gender</label><span className="v"><input id="f_gender" value={f.gender} onChange={set("gender")} /></span>
              <label className="k" htmlFor="f_inc">Income tiers</label><span className="v"><input id="f_inc" value={f.income} onChange={set("income")} /></span>
              <span className="k">Geos</span><span className="v row wrap" style={{ gap: 6 }}>{k.targeting.geos.map((g) => <Pill key={g} tone="blue">{g}</Pill>)}</span>
              <span className="k">Interests</span><span className="v row wrap" style={{ gap: 6 }}>{k.targeting.interests.map((g) => <Pill key={g} tone="purple">{g}</Pill>)}</span>
              <span className="k">Exclude</span><span className="v row wrap" style={{ gap: 6 }}>{k.targeting.exclude_contexts.map((g) => <Pill key={g} tone="bad">{g}</Pill>)}</span>
            </div>
          </div>
          <div className="card pad stack">
            <div className="row between"><span className="eyebrow">Publisher allocation</span><span className="help num" style={{ color: sum === 100 ? "var(--good)" : "var(--bad)" }}>{sum}%</span></div>
            <div className="alloc">
              {alloc.map((a, i) => (
                <div className="a" key={a.publisher_id}>
                  <label htmlFor={`ar${i}`}><b>{name(a.publisher_id)}</b></label>
                  <input id={`ar${i}`} type="range" min={0} max={100} value={a.pct} onChange={(e) => setAlloc((x) => x.map((y, j) => (j === i ? { ...y, pct: Number(e.target.value) } : y)))} />
                  <span className="num">{a.pct}%</span><span className="help num">{fmt$(Math.round((Number(f.total) * a.pct) / 100))}</span>
                </div>
              ))}
            </div>
            <p className="help">Split follows fit score × reach, then capped so no single publisher exceeds 45% — a new campaign needs signal from more than one placement.</p>
          </div>
        </div>
        <div className="card pad stack json-card"><div className="row between"><span className="eyebrow">campaign_config.json</span><Pill>schema v1</Pill></div><pre className="code mono">{json}</pre></div>
      </div>
    </div>
  );
}
