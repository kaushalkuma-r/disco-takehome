"use client";
import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { useEffect, useRef, useState, type ReactNode } from "react";
import { useMe, useSession } from "@/lib/session";
import { supabase } from "@/lib/supabase";
import { Icon, creditCls, useTheme } from "@/lib/ui";

const NAV = [
  ["/dashboard/", "Dashboard", "home"], ["/new/", "New campaign", "plus"], ["/chat/", "Chat", "chat"], ["/history/", "History", "hist"],
] as const;
const NAV2 = [["/memory/", "Memory", "brain"], ["/credits/", "Credits", "coin"]] as const;

/** Auth guard + sidebar + topbar + mobile nav. Wraps every signed-in page. */
export function Shell({ crumb, children }: { crumb: ReactNode; children: ReactNode }) {
  const { session, loading } = useSession();
  const router = useRouter();
  const path = usePathname();
  const { data: me } = useMe();
  const { toggle } = useTheme();
  const [menu, setMenu] = useState(false);
  const menuRef = useRef<HTMLDivElement>(null);

  useEffect(() => { if (!loading && !session) router.replace("/login/"); }, [loading, session, router]);
  useEffect(() => {
    if (!menu) return;
    const h = (e: MouseEvent) => { if (menuRef.current && !menuRef.current.contains(e.target as Node)) setMenu(false); };
    document.addEventListener("click", h);
    return () => document.removeEventListener("click", h);
  }, [menu]);

  if (loading || !session) return null;
  const bal = me?.credit_balance ?? 0;
  const cls = creditCls(bal);
  const name = me?.user.name || session.user.email?.split("@")[0] || "?";
  const init = name.split(" ").map((s) => s[0]).join("").slice(0, 2).toUpperCase();
  const active = (href: string) => (path?.startsWith(href.replace(/\/$/, "")) ? "on" : "");
  const signOut = async () => { await supabase().auth.signOut(); router.replace("/login/"); };

  return (
    <div className="shell">
      <aside className="side">
        <Link href="/dashboard/" className="logo"><span className="mark"><Icon name="spark" /></span>Campaign Studio</Link>
        <nav className="nav" aria-label="Primary">
          {NAV.map(([href, label, icon]) => <Link key={href} href={href} className={active(href)}><Icon name={icon} />{label}</Link>)}
          <div className="sec">Workspace</div>
          {NAV2.map(([href, label, icon]) => <Link key={href} href={href} className={active(href)}><Icon name={icon} />{label}</Link>)}
        </nav>
        <div className="foot">
          <Link href="/credits/" className="card credit-card" aria-label={`Credits: ${bal} remaining`}>
            <div className="row between"><span className="eyebrow">Credits</span><span className={`pill ${cls || "purple"}`}>{bal < 10 ? "Low" : bal < 20 ? "Running low" : "Beta plan"}</span></div>
            <div className="v num">{me ? bal : "…"} <small>of 100</small></div>
            <div className={`bar ${cls}`}><i style={{ width: `${Math.max(2, Math.min(100, bal))}%` }} /></div>
            <span className="help">Generation ≈ 12 · regenerate ≈ 3 · edits free</span>
          </Link>
          <button className="btn ghost sm" onClick={toggle} style={{ justifyContent: "flex-start" }}><Icon name="sun" /> Toggle theme</button>
        </div>
      </aside>
      <div className="main">
        <header className="topbar">
          <div className="crumb">{crumb}</div>
          <div className="row" style={{ position: "relative" }} ref={menuRef}>
            <Link href="/credits/" className={`credit-pill ${cls}`} title="Credits remaining"><Icon name="coin" /><span className="num">{me ? bal : "…"}</span></Link>
            <Link href="/new/" className="btn primary sm hide-sm"><Icon name="plus" /> New campaign</Link>
            <button className="avatar" aria-label="Account menu" aria-haspopup="menu" onClick={() => setMenu((m) => !m)}>{init}</button>
            {menu && (
              <div className="menu" role="menu">
                <div className="who"><b>{name}</b>{session.user.email}</div>
                <button role="menuitem" onClick={() => { toggle(); setMenu(false); }}><Icon name="sun" /> Toggle theme</button>
                <button role="menuitem" onClick={signOut} style={{ color: "var(--bad)" }}><Icon name="out" /> Sign out</button>
              </div>
            )}
          </div>
        </header>
        <main className="page">{children}</main>
        <nav className="mobnav" aria-label="Primary (mobile)">
          {[...NAV, NAV2[1]].map(([href, label, icon]) => <Link key={href} href={href} className={active(href)}><Icon name={icon} />{label.split(" ")[0]}</Link>)}
        </nav>
      </div>
    </div>
  );
}
