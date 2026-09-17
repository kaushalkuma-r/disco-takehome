"use client";
import { useQuery } from "@tanstack/react-query";
import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { Suspense } from "react";
import { Shell } from "@/components/Shell";
import { api } from "@/lib/api";
import { useCatalog, useSession } from "@/lib/session";
import type { Campaign } from "@/lib/types";
import { Pill, fmt$, scoreCls } from "@/lib/ui";

export default function ComparePage() { return <Suspense fallback={null}><CompareInner /></Suspense>; }

function CompareInner() {
  const p = useSearchParams(); const a = p.get("a"); const b = p.get("b");
  const { session } = useSession();
  const { data: catalog } = useCatalog();
  const { data } = useQuery({ queryKey: ["compare", a, b], queryFn: () => api.compare(a!, b!), enabled: !!session && !!a && !!b });
  const pname = (id: string) => catalog?.personas.find((x) => x.id === id)?.name;
  const col = (c: Campaign, l: string) => (
    <div className="card pad stack">
      <div className="row between"><span className="eyebrow">{l}</span><Pill tone={scoreCls(c.clarity.score)}>Clarity {c.clarity.score}</Pill></div>
      <h3><Link href={`/campaign/?id=${c.id}`} style={{ color: "var(--ink)" }}>{c.name}</Link></h3>
      <p className="help">“{c.brief}”</p>
      <div className="divider" />
      <div className="kv"><span className="k">Budget</span><span className="num">{fmt$(c.config?.budget.total_usd)}</span><span className="k">Bid</span><span>{c.config?.bid.strategy.replace(/_/g, " ")}</span><span className="k">Lead persona</span><span>{c.personas[0] ? pname(c.personas[0].id) : "—"}</span><span className="k">Lead headline</span><span>“{c.creatives[0]?.headline}”</span><span className="k">Version</span><span className="num">v{c.version}</span></div>
    </div>
  );
  return (
    <Shell crumb={<><Link href="/history/">History</Link><span>/</span>Compare</>}>
      <div><h1>Compare runs</h1><p className="sub">Side-by-side publisher scores and headline decisions.</p></div>
      {data && <>
        <div className="cmp">{col(data.a, "A")}{col(data.b, "B")}</div>
        <div className="card tscroll"><table><thead><tr><th>Publisher</th><th>A score</th><th>B score</th><th>Δ</th></tr></thead><tbody>
          {data.publishers.map((r) => <tr key={r.publisher_id}><td><b>{r.name}</b></td><td className="num">{r.a ?? "—"}</td><td className="num">{r.b ?? "—"}</td><td>{r.delta == null ? <span className="delta new">{r.a != null ? "only in A" : "only in B"}</span> : r.delta === 0 ? <span className="delta">=</span> : <span className={`delta ${r.delta > 0 ? "up" : "dn"}`}>{r.delta > 0 ? "+" : ""}{r.delta}</span>}</td></tr>)}
        </tbody></table></div>
        {data.creatives.length > 0 && <div className="card tscroll"><table><thead><tr><th>Persona</th><th>A headline</th><th>B headline</th></tr></thead><tbody>
          {data.creatives.map((r) => <tr key={r.persona_id}><td><b>{pname(r.persona_id)}</b></td><td>{r.a || "—"}</td><td>{r.b}</td></tr>)}
        </tbody></table></div>}
      </>}
    </Shell>
  );
}
