"use client";
import { useState } from "react";
import { ApiError, api } from "@/lib/api";
import { useApplyResponse } from "@/lib/session";
import type { Campaign, Catalog, Creative, FeedbackRow, PersonaPick, PublisherScore, ValidationResult } from "@/lib/types";
import { Bar, Icon, Pill, fmt$, fmtImp, letter, scoreCls, useToast } from "@/lib/ui";
import { FeedbackButtons } from "./Feedback";

const fb = (rows: FeedbackRow[] | undefined, kind: string, id: string) => rows?.filter((r) => r.target_kind === kind && r.target_id === id).at(-1);

/* ---------------------------------------------------------------- publisher */
export function PublisherCard({ c, p, i, catalog, feedback }: { c: Campaign; p: PublisherScore; i: number; catalog: Catalog; feedback?: FeedbackRow[] }) {
  const P = catalog.publishers.find((x) => x.id === p.id)!;
  const apply = useApplyResponse();
  const toast = useToast();
  const [busy, setBusy] = useState(false);
  const drop = async () => {
    setBusy(true);
    try { apply.campaign(await api.patch(c.id, { op: "drop_publisher", publisher_id: p.id })); toast(`Dropped ${P.name}; budget re-spread · free`); }
    catch (e) { toast(e instanceof ApiError ? e.message : "Could not drop", "warn"); setBusy(false); }
  };
  return (
    <div className={`card pubcard ${busy ? "dim" : ""}`}>
      <div className={`rank ${i === 0 ? "top" : ""}`}>{i + 1}</div>
      <div>
        <h3>{P.name}<Pill>{P.category.replace(/_/g, " ")}</Pill>{p.llm_delta ? <Pill tone={p.llm_delta > 0 ? "good" : "warn"} title="Model adjustment to the deterministic pre-score">model {p.llm_delta > 0 ? "+" : ""}{p.llm_delta}</Pill> : null}</h3>
        <div className="meta"><span>{fmtImp(P.monthly_impressions)} imp/mo</span><span>AOV {fmt$(P.avg_order_value_usd)}</span><span>{P.audience.age_skew}</span><span>{Math.round((P.audience.gender_split.female || 0) * 100)}% F</span><span>{P.audience.income_tier} income</span><span>{P.audience.top_geos.join(", ")}</span></div>
        <p className="why">{p.why}</p>
        <p className="help" style={{ marginTop: 6 }}><b>Catalog note:</b> {P.notes}</p>
      </div>
      <div className="score">
        <b className="num" style={{ color: `var(--${scoreCls(p.score)})` }}>{p.score}</b><small>fit score · pre {p.prescore}</small>
        <FeedbackButtons campaignId={c.id} kind="publisher" targetId={p.id} existing={fb(feedback, "publisher", p.id)} onBusy={setBusy} />
        <button className="btn ghost sm danger" onClick={drop} disabled={busy}><Icon name="x" /> Drop</button>
      </div>
      <div className="bd">
        {(["category", "persona", "aov", "audience"] as const).map((k) => (
          <div className="b" key={k}><div className="l"><span>{k[0].toUpperCase() + k.slice(1)}</span><b className="num">{p.bd[k]}</b></div><Bar value={p.bd[k]} tone={scoreCls(p.bd[k])} /></div>
        ))}
      </div>
    </div>
  );
}

/* ---------------------------------------------------------------- creative */
export function CreativeCard({ c, cr, i, catalog, feedback, compact }: { c: Campaign; cr: Creative; i: number; catalog: Catalog; feedback?: FeedbackRow[]; compact?: boolean }) {
  const P = catalog.personas.find((x) => x.id === cr.persona_id)!;
  const pick: PersonaPick | undefined = c.personas.find((x) => x.id === cr.persona_id);
  const apply = useApplyResponse();
  const toast = useToast();
  const [busy, setBusy] = useState(false);
  const [edit, setEdit] = useState(false);
  const [h, setH] = useState(cr.headline);
  const [b, setB] = useState(cr.body);
  const [cta, setCta] = useState(cr.cta);

  const regen = async () => {
    setBusy(true);
    try { const r = await api.regenerate(c.id, cr.persona_id); apply.campaign(r); toast(`Variant regenerated · ${r.credits.charged} credits`); }
    catch (e) { toast(e instanceof ApiError && e.code === "insufficient_credits" ? "Not enough credits to regenerate." : "Regeneration failed; nothing charged.", "warn"); }
    finally { setBusy(false); }
  };
  const save = async () => {
    setBusy(true);
    try { apply.campaign(await api.patch(c.id, { op: "update_creative", persona_id: cr.persona_id, headline: h.trim() || cr.headline, body: b.trim() || cr.body, cta: cta.trim() || cr.cta })); toast("Creative saved · free"); setEdit(false); }
    catch (e) { toast(e instanceof ApiError ? e.message : "Save failed", "warn"); }
    finally { setBusy(false); }
  };

  return (
    <div className={`card creative ${busy ? "dim" : ""}`} style={compact ? { padding: 0, border: "none" } : undefined}>
      <div className="ph">
        <div className="n"><Icon name="users" />{P.name}{pick && <Pill tone={scoreCls(pick.fit)}>Fit {pick.fit}</Pill>}</div>
        <div className="row" style={{ gap: 4 }}>
          <FeedbackButtons campaignId={c.id} kind="creative" targetId={cr.persona_id} existing={fb(feedback, "creative", cr.persona_id)} onBusy={setBusy} />
          {!compact && <>
            <button className="btn ghost sm icon" title="Edit" aria-label="Edit creative" onClick={() => { setH(cr.headline); setB(cr.body); setCta(cr.cta); setEdit(true); }}><Icon name="edit" /></button>
            <button className="btn ghost sm icon" title="Regenerate (~3 credits)" aria-label="Regenerate creative" onClick={regen} disabled={busy}><Icon name="refresh" /></button>
          </>}
        </div>
      </div>
      <div className="ad">
        <span className="tag">{compact ? "Preview" : `Variant ${letter(i)}`}</span>
        {edit ? (
          <div className="edit">
            <label className="sr-only" htmlFor={`eh-${cr.persona_id}`}>Headline</label>
            <input id={`eh-${cr.persona_id}`} value={h} maxLength={80} onChange={(e) => setH(e.target.value)} />
            <label className="sr-only" htmlFor={`eb-${cr.persona_id}`}>Body</label>
            <textarea id={`eb-${cr.persona_id}`} rows={3} value={b} maxLength={240} onChange={(e) => setB(e.target.value)} />
            <label className="sr-only" htmlFor={`ec-${cr.persona_id}`}>Call to action</label>
            <input id={`ec-${cr.persona_id}`} value={cta} maxLength={24} style={{ maxWidth: 200 }} onChange={(e) => setCta(e.target.value)} />
            <div className="row wrap"><button className="btn primary sm" onClick={save} disabled={busy}>Save · free</button><button className="btn sm" onClick={() => setEdit(false)}>Cancel</button><span className="help num">{h.length}/80 · {b.length}/240</span></div>
          </div>
        ) : (
          <><h4>{cr.headline}</h4><p>{cr.body}</p><span className="cta">{cr.cta}</span></>
        )}
      </div>
      {pick && <p className="why"><b>Why this persona:</b> {pick.why}</p>}
      {cr.rationale && !compact && <p className="why"><b>Angle:</b> {cr.rationale}</p>}
      {(cr.assumptions && cr.assumptions.length > 0) && <div className="banner warn" style={{ padding: "8px 10px", fontSize: 12.5 }}><Icon name="info" /><span><b>Confirm before running:</b> {(cr.assumptions || []).join(" · ")}</span></div>}
      {!compact && <>
        <div className="row wrap" style={{ gap: 6 }}><span className="eyebrow">Speaks to</span>{P.messaging_preferences.slice(0, 3).map((l) => <Pill key={l} tone="purple">{l}</Pill>)}</div>
        <div className="row wrap" style={{ gap: 6 }}><span className="eyebrow">Avoids</span>{P.disinterested_in.slice(0, 2).map((l) => <Pill key={l}>{l}</Pill>)}</div>
      </>}
    </div>
  );
}

/* ---------------------------------------------------------------- donut */
const COLS = ["#7C3AED", "#3B82F6", "#A78BFA", "#60A5FA", "#C4B5FD", "#93C5FD"];
export function Donut({ c, catalog }: { c: Campaign; catalog: Catalog }) {
  if (!c.config) return null;
  const total = c.config.budget.total_usd;
  let acc = 0; const R = 60, r = 40, cx = 75, cy = 75;
  const segs = c.config.allocation.map((a, i) => {
    const s = (acc / 100) * 2 * Math.PI; acc += a.pct; const e = (acc / 100) * 2 * Math.PI;
    const p = (t: number, rad: number) => [cx + rad * Math.cos(t - Math.PI / 2), cy + rad * Math.sin(t - Math.PI / 2)];
    const [x1, y1] = p(s, R), [x2, y2] = p(e, R), [x3, y3] = p(e, r), [x4, y4] = p(s, r); const big = e - s > Math.PI ? 1 : 0;
    return <path key={a.publisher_id} d={`M${x1} ${y1}A${R} ${R} 0 ${big} 1 ${x2} ${y2}L${x3} ${y3}A${r} ${r} 0 ${big} 0 ${x4} ${y4}Z`} fill={COLS[i % COLS.length]}><title>{catalog.publishers.find((x) => x.id === a.publisher_id)?.name} {a.pct}%</title></path>;
  });
  return (
    <div className="donut">
      <svg viewBox="0 0 150 150" role="img" aria-label="Budget split">{segs}<text x="75" y="71" textAnchor="middle" fontSize="18" fontWeight="700" fill="var(--ink)">{fmt$(total)}</text><text x="75" y="88" textAnchor="middle" fontSize="11" fill="var(--muted)">total budget</text></svg>
      <div className="legend">
        {c.config.allocation.map((a, i) => <div key={a.publisher_id}><i style={{ background: COLS[i % COLS.length] }} />{catalog.publishers.find((x) => x.id === a.publisher_id)?.name} <b className="num">{a.pct}%</b> <span className="help num">· {fmt$(Math.round((total * a.pct) / 100))}</span></div>)}
      </div>
    </div>
  );
}

/* ---------------------------------------------------------------- checks */
const CHECK_LABEL: Record<string, string> = {
  alloc_sums_100: "Allocation totals 100%", alloc_cap_45: "No publisher over the single-publisher cap", no_excluded_in_alloc: "Budget only on recommended publishers",
  min_publishers: "At least 3 publishers recommended", reason_present: "Every publisher has a written reason", creative_lengths: "Headline ≤ 80, body 60–240, CTA ≤ 24 characters",
  creative_avoids_disinterest: "Creatives avoid each persona's disinterests", creative_uses_preference: "Creatives follow your brand-voice preference",
  persona_fit_floor: "Every persona fit ≥ 40", budget_sanity: "Daily × flight days ≈ total budget", banned_publishers: "No banned publishers recommended",
};
export function ChecksPanel({ c, validation }: { c: Campaign; validation: ValidationResult[] }) {
  const apply = useApplyResponse();
  const toast = useToast();
  const [busy, setBusy] = useState<string | null>(null);
  const order = { error: 0, warning: 1 };
  const rows = [...validation].sort((a, b) => Number(a.passed) - Number(b.passed) || order[a.severity] - order[b.severity]);
  const fix = async (r: ValidationResult) => {
    setBusy(r.check);
    try {
      if (r.repair_tool === "regenerate_creative" && r.target.persona_id) { const x = await api.regenerate(c.id, r.target.persona_id, r.message); apply.campaign(x); toast(`Repaired · ${x.credits.charged} credits`); }
      else if (r.repair_tool === "drop_publisher" && r.target.publisher_id) { apply.campaign(await api.patch(c.id, { op: "drop_publisher", publisher_id: r.target.publisher_id, reason: r.message })); toast("Publisher dropped · free"); }
      else if (r.repair_tool === "set_budget") { apply.campaign(await api.patch(c.id, { op: "set_budget", daily_usd: c.config?.budget.daily_usd })); toast("Budget re-aligned · free"); }
      else if (r.repair_tool === "build_config" && c.config) {
        const rec = new Set(c.publishers.map((p) => p.id));
        const keep = c.config.allocation.filter((a) => rec.has(a.publisher_id));
        const tot = keep.reduce((s, a) => s + a.pct, 0) || 1;
        const alloc = keep.map((a) => ({ publisher_id: a.publisher_id, pct: Math.round((a.pct / tot) * 100) }));
        if (alloc.length) alloc[0].pct += 100 - alloc.reduce((s, a) => s + a.pct, 0);
        apply.campaign(await api.patch(c.id, { op: "set_config", config: { allocation: alloc } })); toast("Allocation re-normalised · free");
      } else {
        const kind = r.target.persona_id ? "persona" : r.target.publisher_id ? "publisher" : "config";
        const res = await api.feedback({ campaign_id: c.id, target_kind: kind, target_id: r.target.persona_id || r.target.publisher_id || "bid", vote: "down", comment: r.message });
        if (res.repair) { apply.campaign(res.repair); toast(`Repaired · ${res.repair.credits.charged} credits`); }
      }
    } catch (e) { toast(e instanceof ApiError && e.code === "insufficient_credits" ? "Not enough credits." : "Repair failed; nothing charged.", "warn"); }
    finally { setBusy(null); }
  };
  const errs = rows.some((r) => !r.passed && r.severity === "error");
  return (
    <div className="stack lg">
      <div className="row between wrap">
        <div><h3>Checks</h3><p className="help">Deterministic validators run after every change (backend <span className="kbd">agent/validators</span>). Failing checks name the tool that can fix them; “Fix” re-runs only that tool.</p></div>
        <Pill tone={errs ? "bad" : rows.some((r) => !r.passed) ? "warn" : "good"}>{rows.filter((r) => r.passed).length}/{rows.length} passing</Pill>
      </div>
      <div className="checks">
        {rows.map((r) => (
          <div key={r.check} className={`checkrow ${r.passed ? "pass" : r.severity}`}>
            <Icon name={r.passed ? "check" : r.severity === "error" ? "x" : "warn"} />
            <div><div><b>{r.passed ? CHECK_LABEL[r.check] || r.check : r.message}</b></div><div className="id">{r.check} · {r.severity} · repair: {r.repair_tool}</div></div>
            {!r.passed && <button className={`btn sm ${r.severity === "error" ? "primary" : ""}`} disabled={busy === r.check} onClick={() => fix(r)}><Icon name="spark" /> {busy === r.check ? "Fixing…" : "Fix"}{["regenerate_creative", "rank_publishers", "pick_personas"].includes(r.repair_tool || "") && <span className="cost">· ~2</span>}</button>}
          </div>
        ))}
      </div>
    </div>
  );
}
