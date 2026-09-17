"use client";
import { useQuery } from "@tanstack/react-query";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { Suspense, useState } from "react";
import { ChecksPanel, CreativeCard, Donut, PublisherCard } from "@/components/campaign/Cards";
import { ConfigForm } from "@/components/campaign/ConfigForm";
import { FeedbackButtons } from "@/components/campaign/Feedback";
import { Shell } from "@/components/Shell";
import { ApiError, api } from "@/lib/api";
import { useApplyResponse, useCampaign, useCatalog, useMe, useSession } from "@/lib/session";
import type { Campaign, Catalog, FeedbackRow, ValidationResult } from "@/lib/types";
import { Bar, Icon, Pill, dateS, dateT, fmt$, fmtImp, letter, scoreCls, useToast } from "@/lib/ui";

const TABS = [["overview", "Overview"], ["publishers", "Publishers"], ["creatives", "Creatives"], ["config", "Config"], ["checks", "Checks"], ["export", "Export"]] as const;

export default function CampaignPage() {
  return <Suspense fallback={null}><CampaignInner /></Suspense>;
}

function CampaignInner() {
  const params = useSearchParams();
  const id = params.get("id");
  const tab = params.get("tab") || "overview";
  const router = useRouter();
  const toast = useToast();
  const apply = useApplyResponse();
  const { session } = useSession();
  const { data, isLoading, error } = useCampaign(id);
  const { data: catalog } = useCatalog();
  const { data: act } = useQuery({ queryKey: ["activity", id], queryFn: () => api.activity(id!), enabled: !!session && !!id });
  const [busy, setBusy] = useState(false);

  if (!id) { router.replace("/history/"); return null; }
  if (error) return <Shell crumb="Campaign"><div className="empty"><Icon name="layers" size={36} /><b>Campaign not found</b><Link href="/history/" className="btn sm">Back to history</Link></div></Shell>;
  if (isLoading || !data || !catalog) return <Shell crumb="Campaign"><div className="empty"><span className="typing"><i /><i /><i /></span></div></Shell>;

  const c = data.campaign; const validation = data.validation;
  const errors = validation.filter((v) => !v.passed && v.severity === "error").length;
  const warns = validation.filter((v) => !v.passed && v.severity === "warning").length;
  const feedback = act?.feedback;
  const setStatus = async () => {
    setBusy(true);
    try { apply.campaign(await api.patch(c.id, { op: "set_status", status: c.status === "ready" ? "draft" : "ready" })); toast(c.status === "ready" ? "Back to draft" : "Marked ready to launch"); }
    catch (e) { toast(e instanceof ApiError ? e.message : "Could not update", "warn"); }
    finally { setBusy(false); }
  };
  const rerun = () => { try { sessionStorage.setItem("dcs.draft", c.brief); } catch {} router.push("/new/"); };

  return (
    <Shell crumb={<><Link href="/history/">History</Link><span>/</span>{c.name}</>}>
      <div className="row between wrap">
        <div className="grow">
          <div className="row wrap" style={{ marginBottom: 6 }}>
            <Pill tone={scoreCls(c.clarity.score)}>Clarity {c.clarity.score}</Pill>
            <Pill tone={c.status === "ready" ? "good" : c.status === "needs_review" ? "warn" : ""}>{c.status === "ready" ? "Ready to launch" : c.status === "needs_review" ? "Needs review" : "Draft"}</Pill>
            {errors ? <Pill tone="bad">{errors} check{errors > 1 ? "s" : ""} failing</Pill> : warns ? <Pill tone="warn">{warns} warning{warns > 1 ? "s" : ""}</Pill> : <Pill tone="good"><Icon name="shield" /> All checks pass</Pill>}
            <span className="help num">v{c.version} · {dateS(c.created_at)}</span>
          </div>
          <h1>{c.name}</h1>
          <p className="sub">“{c.brief}”</p>
        </div>
        <div className="row wrap">
          <Link className="btn" href={`/chat/?c=${c.id}`}><Icon name="chat" /> Chat about this</Link>
          <button className="btn" onClick={rerun}><Icon name="refresh" /> Re-run</button>
          <button className="btn primary" onClick={setStatus} disabled={busy || (!!errors && c.status !== "ready")} title={errors && c.status !== "ready" ? "Fix failing checks first" : undefined}>{c.status === "ready" ? <><Icon name="check" /> Ready</> : "Mark ready"}</button>
        </div>
      </div>
      <div className="tabs" role="tablist">
        {TABS.map(([k, l]) => (
          <Link key={k} className={`tab ${tab === k ? "on" : ""}`} role="tab" aria-selected={tab === k} href={`/campaign/?id=${c.id}&tab=${k}`}>
            {l}{k === "checks" && (errors || warns) ? <Pill tone={errors ? "bad" : "warn"} style={{ height: 18, padding: "0 6px", fontSize: 10.5 }}>{errors || warns}</Pill> : null}
          </Link>
        ))}
      </div>
      {tab === "overview" && <Overview c={c} catalog={catalog} validation={validation} feedback={feedback} activity={act?.interactions} />}
      {tab === "publishers" && <Publishers c={c} catalog={catalog} feedback={feedback} />}
      {tab === "creatives" && <Creatives c={c} catalog={catalog} validation={validation} feedback={feedback} />}
      {tab === "config" && c.config && <ConfigForm key={c.version} c={c} catalog={catalog} feedback={feedback} />}
      {tab === "checks" && <ChecksPanel c={c} validation={validation} />}
      {tab === "export" && <ExportTab c={c} catalog={catalog} validation={validation} />}
    </Shell>
  );
}

/* ---------------------------------------------------------------- overview */
function Overview({ c, catalog, validation, feedback, activity }: { c: Campaign; catalog: Catalog; validation: ValidationResult[]; feedback?: FeedbackRow[]; activity?: { id: string; kind: string; created_at: string; credits: number; change_note: string | null; input: Record<string, unknown> }[] }) {
  const top = c.publishers[0]; const P = top && catalog.publishers.find((x) => x.id === top.id);
  const lead = c.creatives[0];
  const failing = validation.filter((v) => !v.passed);
  const spent = activity?.reduce((s, a) => s + (a.credits || 0), 0) ?? 0;
  const label = (a: { kind: string; change_note: string | null; input: Record<string, unknown> }) =>
    a.change_note || ({ generate: "Campaign generated (guided mode)", chat: `Chat: “${String(a.input.message || "").slice(0, 60)}”`, feedback: "Feedback repair", regenerate: "Creative regenerated", edit: "Edited" } as Record<string, string>)[a.kind] || a.kind;
  return (
    <div className="stack lg">
      <div className="sumstrip">
        <div className="card stat"><span className="eyebrow">Publishers</span><span className="v num">{c.publishers.length}<small> recommended</small></span><span className="d">{c.excluded.length} excluded with reasons</span></div>
        <div className="card stat"><span className="eyebrow">Top match</span><span className="v">{P?.name || "—"}</span><span className="d">{top ? `Score ${top.score} · ${fmtImp(P!.monthly_impressions)} monthly impressions` : ""}</span></div>
        <div className="card stat"><span className="eyebrow">Creatives</span><span className="v num">{c.creatives.length}</span><span className="d">Lead: {lead ? catalog.personas.find((x) => x.id === lead.persona_id)?.name.replace("The ", "") : "—"}</span></div>
        <div className="card stat"><span className="eyebrow">Budget</span><span className="v num">{fmt$(c.config?.budget.total_usd)}</span><span className="d">{fmt$(c.config?.budget.daily_usd)}/day · {c.config?.bid.strategy.replace(/_/g, " ")}</span></div>
      </div>
      {failing.length > 0 && <div className={`banner ${failing.some((f) => f.severity === "error") ? "bad" : "warn"}`}><Icon name="warn" /><span><b>{failing.length} check{failing.length > 1 ? "s" : ""} need attention.</b> {failing[0].message} <Link href={`/campaign/?id=${c.id}&tab=checks`}>See all checks</Link></span></div>}
      <div className="card pad stack">
        <div className="row between wrap"><h3>How we read the brief</h3><div className="row"><Pill tone={scoreCls(c.clarity.score)}>{c.clarity.label}</Pill><FeedbackButtons campaignId={c.id} kind="clarity" targetId="summary" existing={feedback?.filter((r) => r.target_kind === "clarity").at(-1)} /></div></div>
        <p>{c.clarity.summary}</p>
        {c.clarity.answers.length > 0 && <div className="row wrap" style={{ gap: 6 }}><span className="eyebrow">Your answers</span>{c.clarity.answers.map((a) => <Pill key={a}>{a}</Pill>)}</div>}
        <div className="row wrap" style={{ gap: 6 }}>{c.clarity.signals.map((s) => <Pill key={s} tone={/not stated/i.test(s) ? "bad" : "good"}>{s}</Pill>)}</div>
      </div>
      <div className="grid g2">
        <div className="card pad stack">
          <div className="row between"><h3>Publisher ranking</h3><Link className="help" href={`/campaign/?id=${c.id}&tab=publishers`}>Details</Link></div>
          {c.publishers.map((p, i) => { const pub = catalog.publishers.find((x) => x.id === p.id)!; return (
            <div key={p.id} style={{ display: "grid", gridTemplateColumns: "22px 1fr 44px", gap: 10, alignItems: "center" }}>
              <span className="num help">{i + 1}</span>
              <div><div className="row between"><b>{pub.name}</b><span className="help">{fmtImp(pub.monthly_impressions)} imp · AOV {fmt$(pub.avg_order_value_usd)}</span></div><Bar value={p.score} tone={scoreCls(p.score)} className="" /></div>
              <b className="num" style={{ textAlign: "right" }}>{p.score}</b>
            </div>); })}
        </div>
        <div className="card pad stack">
          <div className="row between"><h3>Budget split</h3><Link className="help" href={`/campaign/?id=${c.id}&tab=config`}>Edit</Link></div>
          <Donut c={c} catalog={catalog} />
        </div>
      </div>
      <div className="grid g2">
        <div className="card pad">
          <div className="row between" style={{ marginBottom: 12 }}><h3>Lead creative</h3><Link className="help" href={`/campaign/?id=${c.id}&tab=creatives`}>All {c.creatives.length} variants</Link></div>
          {lead && <CreativeCard c={c} cr={lead} i={0} catalog={catalog} feedback={feedback} compact />}
        </div>
        <div className="card pad">
          <div className="row between" style={{ marginBottom: 8 }}><h3>Activity</h3><span className="help">{spent} credits on this campaign</span></div>
          <div className="timeline">
            {(activity || []).slice(0, 7).map((a) => <div className="tl" key={a.id}><i className={a.kind === "feedback" ? "fb" : a.kind === "generate" ? "gen" : "edit"} /><div>{label(a)}<div className="d">{dateT(a.created_at)}</div></div><span className="help num">{a.credits ? a.credits + " cr" : "free"}</span></div>)}
            {!activity?.length && <p className="help">No activity yet.</p>}
          </div>
        </div>
      </div>
    </div>
  );
}

/* ---------------------------------------------------------------- publishers */
function Publishers({ c, catalog, feedback }: { c: Campaign; catalog: Catalog; feedback?: FeedbackRow[] }) {
  return (
    <div className="stack lg">
      <div className="row between wrap">
        <div><h3>Recommended ({c.publishers.length})</h3><p className="help">Score = deterministic pre-score (category, persona overlap, AOV, audience) plus a model adjustment of at most ±15 that must cite the publisher&apos;s catalog note.</p></div>
        <div className="row wrap"><Pill>Category 35%</Pill><Pill>Persona 30%</Pill><Pill>AOV 15%</Pill><Pill>Audience 20%</Pill></div>
      </div>
      {c.publishers.map((p, i) => <PublisherCard key={p.id} c={c} p={p} i={i} catalog={catalog} feedback={feedback} />)}
      <div className="card pad">
        <h3>Excluded, and why</h3>
        <p className="help" style={{ marginBottom: 8 }}>Everything else in the catalog scored below 40. Showing the most instructive exclusions.</p>
        {c.excluded.map((e) => { const P = catalog.publishers.find((x) => x.id === e.id)!; return (
          <div className="excl" key={e.id}><div className="n">{P.name}<small>{P.category.replace(/_/g, " ")} · {P.audience.age_skew} · AOV {fmt$(P.avg_order_value_usd)}{e.score ? ` · scored ${e.score}` : ""}</small></div><div>{e.why}</div></div>); })}
      </div>
    </div>
  );
}

/* ---------------------------------------------------------------- creatives */
function Creatives({ c, catalog, validation, feedback }: { c: Campaign; catalog: Catalog; validation: ValidationResult[]; feedback?: FeedbackRow[] }) {
  const apply = useApplyResponse();
  const toast = useToast();
  const used = new Set(c.personas.map((p) => p.id));
  const next = catalog.personas.find((p) => !used.has(p.id));
  const problems = validation.filter((v) => !v.passed && v.repair_tool === "regenerate_creative");
  const add = async () => { if (!next) return; try { apply.campaign(await api.patch(c.id, { op: "add_persona", persona_id: next.id })); toast(`Added ${next.name} · free (regenerate to write real copy)`); } catch (e) { toast(e instanceof ApiError ? e.message : "Failed", "warn"); } };
  return (
    <div className="stack lg">
      <div className="row between wrap">
        <div><h3>{c.creatives.length} variants, one per persona</h3><p className="help">Each is written against the persona&apos;s messaging preferences and away from their disinterests. Edit inline (free) or regenerate (~3 credits).</p></div>
        <button className="btn" onClick={add} disabled={!next}><Icon name="plus" /> Add a persona</button>
      </div>
      {problems.length > 0 && <div className="banner warn"><Icon name="warn" /><span>{problems.map((p) => p.message).join(" ")}</span></div>}
      <div className="grid g2">{c.creatives.map((cr, i) => <CreativeCard key={cr.persona_id} c={c} cr={cr} i={i} catalog={catalog} feedback={feedback} />)}</div>
      {c.skipped_personas.length > 0 && (
        <div className="card pad"><h3>Personas we skipped</h3>{c.skipped_personas.map((s) => { const P = catalog.personas.find((x) => x.id === s.id)!; return <div className="excl" key={s.id}><div className="n">{P.name}<small>{P.age_range} · price sensitivity {P.price_sensitivity}</small></div><div>{s.why}</div></div>; })}</div>
      )}
    </div>
  );
}

/* ---------------------------------------------------------------- export */
function ExportTab({ c, catalog, validation }: { c: Campaign; catalog: Catalog; validation: ValidationResult[] }) {
  const { data: me } = useMe();
  const toast = useToast();
  const [busy, setBusy] = useState(false);
  const slug = c.name.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");
  const pdf = async () => { setBusy(true); try { await api.download(`/api/campaigns/${c.id}/export.pdf`, `${slug}-brief-v${c.version}.pdf`); toast("PDF downloaded"); } catch { toast("Export failed", "warn"); } finally { setBusy(false); } };
  const json = async () => { try { const j = await api.exportJson(c.id); await navigator.clipboard.writeText(JSON.stringify(j, null, 2)); toast("Config JSON copied"); } catch { toast("Copy blocked — use the Config tab", "info"); } };
  const pname = (id: string) => catalog.publishers.find((x) => x.id === id)?.name;
  return (
    <div className="stack lg">
      <div className="row between wrap"><div><h3>Export</h3><p className="help">A one-page campaign brief for stakeholders, or the raw config for an ad server. Exports are free.</p></div><div className="row wrap"><button className="btn" onClick={json}><Icon name="copy" /> Copy JSON</button><button className="btn primary" onClick={pdf} disabled={busy}><Icon name="dl" /> {busy ? "Rendering…" : "Download PDF"}</button></div></div>
      <div className="tscroll"><div className="brief">
        <div className="top"><div><div style={{ fontSize: 10.5, letterSpacing: ".1em", textTransform: "uppercase", color: "#6b7280" }}>Campaign brief · Disco Campaign Studio</div><h2>{c.name}</h2><div style={{ color: "#4b5563", marginTop: 4 }}>“{c.brief}”</div></div><div style={{ textAlign: "right", fontSize: 11, color: "#6b7280", whiteSpace: "nowrap" }}>{me?.user.name}<br />{new Date().toLocaleDateString()}<br />v{c.version}</div></div>
        <h3>Interpretation</h3><p>{c.clarity.summary}</p>
        <h3>Recommended publishers</h3>
        <table><thead><tr><th>#</th><th>Publisher</th><th>Score</th><th>Budget</th><th>Why</th></tr></thead><tbody>
          {c.publishers.map((p, i) => { const a = c.config?.allocation.find((x) => x.publisher_id === p.id); return <tr key={p.id}><td>{i + 1}</td><td><b>{pname(p.id)}</b></td><td className="num">{p.score}</td><td className="num">{a ? a.pct + "%" : "—"}</td><td>{p.why}</td></tr>; })}
        </tbody></table>
        <h3>Creative variants</h3>
        {c.creatives.map((cr, i) => { const pk = c.personas.find((x) => x.id === cr.persona_id); return <div className="bx" key={cr.persona_id}><b>{letter(i)} · {catalog.personas.find((x) => x.id === cr.persona_id)?.name}{pk ? ` (fit ${pk.fit})` : ""}</b><span style={{ fontWeight: 600 }}>{cr.headline}</span> — {cr.body}</div>; })}
        {c.config && <><h3>Config</h3>
          <table><tbody><tr><td>Objective</td><td>{c.config.objective} · {c.config.primary_kpi}</td></tr><tr><td>Bid</td><td>{c.config.bid.strategy} · CPM {c.config.bid.cpm_range_usd} · CPC {c.config.bid.cpc_range_usd}</td></tr><tr><td>Budget</td><td>{fmt$(c.config.budget.total_usd)} total · {fmt$(c.config.budget.daily_usd)}/day · {c.config.flight.start} → {c.config.flight.end}</td></tr><tr><td>Targeting</td><td>{c.config.targeting.age_range} · {c.config.targeting.gender} · {c.config.targeting.geos.join(", ")} · {c.config.targeting.income_tiers.join(", ")}</td></tr></tbody></table></>}
        <h3>Excluded publishers</h3>
        {c.excluded.slice(0, 4).map((e) => <div key={e.id} style={{ marginBottom: 4 }}><b>{pname(e.id)}</b> — {e.why}</div>)}
        <div className="foot">{c.id} · v{c.version} · checks {validation.filter((v) => v.passed).length}/{validation.length} passing</div>
      </div></div>
    </div>
  );
}
