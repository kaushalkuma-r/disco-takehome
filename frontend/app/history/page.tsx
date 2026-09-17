"use client";
import { useQuery } from "@tanstack/react-query";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { Shell } from "@/components/Shell";
import { api } from "@/lib/api";
import { useApplyResponse, useCatalog, useSession } from "@/lib/session";
import { Empty, Icon, Pill, dateS, fmt$, scoreCls, useToast } from "@/lib/ui";

export default function HistoryPage() {
  const { session } = useSession();
  const { data: list, refetch } = useQuery({ queryKey: ["campaigns"], queryFn: api.campaigns, enabled: !!session });
  const { data: catalog } = useCatalog();
  const [sel, setSel] = useState<string[]>([]);
  const router = useRouter();
  const toast = useToast();
  const apply = useApplyResponse();
  const items = list || [];
  const toggle = (id: string) => setSel((s) => (s.includes(id) ? s.filter((x) => x !== id) : s.length >= 2 ? (toast("Pick exactly two", "info"), s) : [...s, id]));
  const del = async (id: string, name: string) => {
    if (!confirm(`Delete “${name}”? This can't be undone.`)) return;
    await api.deleteCampaign(id); apply.invalidate(["campaigns"]); apply.invalidate(["me"]); refetch(); toast("Campaign deleted");
  };
  return (
    <Shell crumb="History">
      <div className="row between wrap"><div><h1>Campaign history</h1><p className="sub">Every run is saved and versioned. Select two to compare.</p></div><button className="btn primary" disabled={sel.length !== 2} onClick={() => router.push(`/compare/?a=${sel[0]}&b=${sel[1]}`)}>Compare selected <Icon name="arrow" /></button></div>
      <div className="card tscroll"><table><thead><tr><th><span className="sr-only">Select</span></th><th>Campaign</th><th>Clarity</th><th>Top publisher</th><th>Budget</th><th>Checks</th><th>Status</th><th>Created</th><th><span className="sr-only">Actions</span></th></tr></thead><tbody>
        {items.length ? items.map((c) => (
          <tr key={c.id}>
            <td><label className="check"><input type="checkbox" checked={sel.includes(c.id)} onChange={() => toggle(c.id)} aria-label={`Select ${c.name}`} /></label></td>
            <td><Link href={`/campaign/?id=${c.id}`} style={{ color: "var(--ink)", fontWeight: 600 }}>{c.name}</Link><div className="help" style={{ maxWidth: "36ch", whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>{c.brief}</div></td>
            <td><Pill tone={scoreCls(c.clarity_score)}>{c.clarity_score}</Pill></td>
            <td>{c.top_publisher ? <>{catalog?.publishers.find((p) => p.id === c.top_publisher!.id)?.name} <span className="help num">{c.top_publisher.score}</span></> : "—"}</td>
            <td className="num">{c.budget_total != null ? fmt$(c.budget_total) : "—"}</td>
            <td><Pill tone={c.checks_passing === c.checks_total ? "good" : "warn"}>{c.checks_passing}/{c.checks_total}</Pill></td>
            <td><Pill tone={c.status === "ready" ? "good" : c.status === "needs_review" ? "warn" : ""}>{c.status === "ready" ? "Ready" : c.status === "needs_review" ? "Review" : "Draft"}</Pill></td>
            <td className="help num">{dateS(c.created_at)} · v{c.version}</td>
            <td><button className="btn ghost sm icon danger" onClick={() => del(c.id, c.name)} aria-label={`Delete ${c.name}`}><Icon name="trash" /></button></td>
          </tr>
        )) : <tr><td colSpan={9}><Empty title="No campaigns yet"><Link href="/new/" className="btn primary sm" style={{ marginTop: 6 }}>Build one</Link></Empty></td></tr>}
      </tbody></table></div>
    </Shell>
  );
}
