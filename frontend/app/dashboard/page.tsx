"use client";
import { useQuery } from "@tanstack/react-query";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { Examples } from "@/components/Examples";
import { Shell } from "@/components/Shell";
import { api } from "@/lib/api";
import { useMe, useSession } from "@/lib/session";
import { Empty, Icon, Pill, dateS, scoreCls, useToast } from "@/lib/ui";

const HOW = [
  ["1", "Parse & score clarity", "The model extracts product, buyer, price tier, model. Vague input triggers up to 3 targeted questions. Free."],
  ["2", "Rank publishers", "Deterministic pre-score (category, persona overlap, AOV, audience) + bounded LLM adjustment with a written reason — including exclusions."],
  ["3", "Pick personas, write creative", "3–5 personas with fit scores; one headline + body each, tuned to their preferences and disinterests."],
  ["4", "Check, charge, save", "11 validators run; failures are repaired once. Credits are charged from real token usage and shown on the ledger."],
];

export default function Dashboard() {
  const { session } = useSession();
  const { data: me } = useMe();
  const { data: list } = useQuery({ queryKey: ["campaigns"], queryFn: api.campaigns, enabled: !!session });
  const [desc, setDesc] = useState("");
  const router = useRouter();
  const toast = useToast();
  const items = list || [];
  const first = (me?.user.name || "there").split(" ")[0];
  const spent = 100 - (me?.credit_balance ?? 100);
  const avgClar = items.length ? Math.round(items.reduce((s, c) => s + c.clarity_score, 0) / items.length) : 0;
  const publishers = new Set(items.map((c) => c.top_publisher?.id).filter(Boolean)).size;

  const go = () => {
    const v = desc.trim();
    if (!v) { toast("Describe your business first", "info"); return; }
    try { sessionStorage.setItem("dcs.draft", v); } catch {}
    router.push("/new/");
  };

  return (
    <Shell crumb="Dashboard">
      <div>
        <h1>Good to see you, {first}.</h1>
        <p className="sub">Describe a business and get a ranked media plan, persona-tuned creative, and a runnable config.</p>
      </div>
      <div className="hero-input">
        <label className="eyebrow" htmlFor="desc">Describe your business</label>
        <textarea className="textarea" id="desc" value={desc} onChange={(e) => setDesc(e.target.value)}
          placeholder="e.g. Refillable, concentrated cleaning products. Skip the single-use plastic bottles. We want to show up where people who already care about sustainability are checking out." />
        <div className="row between wrap">
          <Examples onPick={setDesc} />
          <button className="btn grad" id="go" onClick={go}><Icon name="spark" /> Build campaign <span className="cost">· ~12 credits</span></button>
        </div>
      </div>
      <div className="grid g4">
        <div className="card stat"><span className="eyebrow">Campaigns</span><span className="v num">{items.length}</span><span className="d">{items.filter((c) => c.status === "ready").length} marked ready</span></div>
        <div className="card stat"><span className="eyebrow">Top publishers used</span><span className="v num">{publishers}<small> / 20</small></span><span className="d">distinct #1 picks</span></div>
        <div className="card stat"><span className="eyebrow">Creatives written</span><span className="v num">{items.reduce((s, c) => s + c.creatives, 0)}</span><span className="d">persona-tuned variants</span></div>
        <div className="card stat"><span className="eyebrow">Credits used</span><span className="v num">{spent}<small> / 100</small></span><span className="d">{me?.credit_balance ?? "…"} left{items.length ? ` · avg clarity ${avgClar}` : ""}</span></div>
      </div>
      <div className="grid g-main">
        <div className="card pad">
          <div className="row between" style={{ marginBottom: 8 }}><h3>Recent campaigns</h3><Link href="/history/" className="help">View all</Link></div>
          <div>
            {items.length ? items.slice(0, 5).map((c) => (
              <Link key={c.id} href={`/campaign/?id=${c.id}`} className="crow" style={{ color: "inherit" }}>
                <div className="grow"><div className="t">{c.name}</div><div className="s">{c.brief}</div></div>
                <Pill tone={scoreCls(c.clarity_score)} className="hide-sm">Clarity {c.clarity_score}</Pill>
                <span className="help num">{dateS(c.created_at)}</span>
              </Link>
            )) : <Empty title="No campaigns yet"><span>Describe a business above to build your first one.</span></Empty>}
          </div>
        </div>
        <div className="card pad stack">
          <h3>How the brain works</h3>
          {HOW.map(([n, t, d]) => <div key={n} className="howto"><b>{n}</b><div><div style={{ fontWeight: 600 }}>{t}</div><div className="help">{d}</div></div></div>)}
        </div>
      </div>
    </Shell>
  );
}
