"use client";
import { useQuery } from "@tanstack/react-query";
import Link from "next/link";
import { Shell } from "@/components/Shell";
import { api } from "@/lib/api";
import { useSession } from "@/lib/session";
import { Icon, creditCls, dateT, useToast } from "@/lib/ui";

const LABEL: Record<string, string> = { signup_grant: "Signup grant", reserve: "Reserved (base fee)", usage: "Usage (tokens)", refund: "Refund", grant: "Grant" };
const KIND: Record<string, string> = { generate: "Campaign generation", regenerate: "Regenerate creative", feedback: "Fix from feedback", chat: "Chat (model tool)", edit: "Edit" };

export default function CreditsPage() {
  const { session } = useSession();
  const { data } = useQuery({ queryKey: ["credits"], queryFn: api.credits, enabled: !!session });
  const toast = useToast();
  const rows = data?.ledger || [];
  const bal = data?.balance ?? 0;
  const spent = rows.filter((r) => r.delta < 0).reduce((s, r) => s - r.delta, 0);
  const gens = rows.filter((r) => r.interaction_kind === "generate");
  const byDay: Record<string, number> = {};
  rows.forEach((r) => { if (r.delta < 0) { const d = r.created_at.slice(0, 10); byDay[d] = (byDay[d] || 0) - r.delta; } });
  const days = [...Array(14)].map((_, i) => { const d = new Date(Date.now() - (13 - i) * 864e5).toISOString().slice(0, 10); return [d, byDay[d] || 0] as const; });
  const max = Math.max(1, ...days.map((d) => d[1]));
  return (
    <Shell crumb="Credits">
      <div className="row between wrap"><div><h1>Credits</h1><p className="sub">Every model-touching action is charged from real token usage: a base fee per action plus 1 credit per {data?.pricing.tokens_per_credit.toLocaleString() ?? "4,000"} weighted tokens (gpt-4.1 counts 2×). Deterministic edits, exports and compare are free.</p></div><button className="btn primary" onClick={() => toast("Top-ups are not enabled in the beta — email hello@disconetwork.com and we'll grant more.", "info")}><Icon name="coin" /> Get more credits</button></div>
      <div className="grid g4">
        <div className="card stat"><span className="eyebrow">Balance</span><span className="v num" style={{ color: `var(--${creditCls(bal) || "ink"})` }}>{data ? bal : "…"}</span><span className="d">of {data?.grant ?? 100} granted{data && !data.consistent ? " · ledger mismatch!" : ""}</span></div>
        <div className="card stat"><span className="eyebrow">Spent</span><span className="v num">{spent}</span><span className="d">{rows.filter((r) => r.delta < 0).length} charges</span></div>
        <div className="card stat"><span className="eyebrow">Avg per generation</span><span className="v num">{gens.length ? Math.round(gens.reduce((s, r) => s - r.delta, 0) / new Set(gens.map((r) => r.campaign_id)).size) : "—"}</span><span className="d">10 base + usage</span></div>
        <div className="card stat"><span className="eyebrow">Runway</span><span className="v num">~{Math.max(0, Math.floor(bal / 12))}<small> generations</small></span><span className="d">at ~12 credits each</span></div>
      </div>
      <div className="card pad stack"><div className="row between"><h3>Last 14 days</h3><span className="help">credits per day</span></div><div className="spark" role="img" aria-label="Daily credit spend">{days.map(([d, v]) => <i key={d} className={v ? "on" : ""} style={{ height: `${Math.max(4, (v / max) * 100)}%` }} title={`${d}: ${v}`} />)}</div></div>
      <div className="card tscroll ledger"><table><thead><tr><th>When</th><th>Entry</th><th>Action</th><th>Campaign</th><th>Usage</th><th>Δ</th><th>Balance</th></tr></thead><tbody>
        {rows.map((r) => <tr key={r.id}><td className="help num" style={{ whiteSpace: "nowrap" }}>{dateT(r.created_at)}</td><td><b>{LABEL[r.reason] || r.reason}</b></td><td>{r.interaction_kind ? KIND[r.interaction_kind] || r.interaction_kind : "—"}</td><td>{r.campaign_id ? (r.campaign_name ? <Link href={`/campaign/?id=${r.campaign_id}`}>{r.campaign_name}</Link> : <span className="help">deleted</span>) : "—"}</td><td className="num help">{r.usage ? `${r.usage.total_tokens.toLocaleString()} tok · ${r.usage.mix}` : "—"}</td><td className={`num ${r.delta < 0 ? "neg" : "pos"}`}>{r.delta > 0 ? "+" : ""}{r.delta}</td><td className="num">{r.balance_after}</td></tr>)}
      </tbody></table></div>
    </Shell>
  );
}
