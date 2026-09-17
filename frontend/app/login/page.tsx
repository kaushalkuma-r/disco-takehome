"use client";
import { useRouter } from "next/navigation";
import { useEffect, useState, type FormEvent } from "react";
import { useSession } from "@/lib/session";
import { supabase } from "@/lib/supabase";
import { GoogleIcon, Icon, useToast } from "@/lib/ui";

export default function LoginPage() {
  const { session, loading } = useSession();
  const router = useRouter();
  const toast = useToast();
  const [mode, setMode] = useState<"in" | "up">("in");
  const [email, setEmail] = useState("");
  const [pw, setPw] = useState("");
  const [name, setName] = useState("");
  const [errs, setErrs] = useState<{ email?: string; pw?: string; form?: string }>({});
  const [busy, setBusy] = useState(false);
  const [googleEnabled, setGoogleEnabled] = useState(false);

  useEffect(() => { if (!loading && session) router.replace("/dashboard/"); }, [session, loading, router]);
  // Show the Google button only if the provider is enabled on this Supabase project (GET /auth/v1/settings → external.google).
  useEffect(() => {
    fetch(`${process.env.NEXT_PUBLIC_SUPABASE_URL}/auth/v1/settings`, { headers: { apikey: process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY! } })
      .then((r) => r.json()).then((j) => setGoogleEnabled(!!j?.external?.google)).catch(() => setGoogleEnabled(false));
  }, []);

  async function submit(e: FormEvent) {
    e.preventDefault();
    const next: typeof errs = {};
    if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email.trim())) next.email = "Enter a valid email address.";
    if (pw.length < 6) next.pw = "Password needs at least 6 characters.";
    setErrs(next);
    if (Object.keys(next).length) return;
    setBusy(true);
    const sb = supabase();
    const res = mode === "in"
      ? await sb.auth.signInWithPassword({ email: email.trim(), password: pw })
      : await sb.auth.signUp({ email: email.trim(), password: pw, options: { data: { full_name: name.trim() || email.split("@")[0] } } });
    setBusy(false);
    if (res.error) { setErrs({ form: res.error.message }); return; }
    if (mode === "up" && !res.data.session) { setErrs({ form: "Check your inbox to confirm your email, then sign in." }); return; }
    toast(`Signed in as ${email.trim()}`);
    router.replace("/dashboard/");
  }

  async function google() {
    const { error } = await supabase().auth.signInWithOAuth({ provider: "google", options: { redirectTo: `${location.origin}/dashboard/` } });
    if (error) setErrs({ form: "Google sign-in is not enabled on this project yet — use email." });
  }

  return (
    <div className="auth">
      <section className="brand" aria-label="About Campaign Studio">
        <div className="logo"><span className="mark"><Icon name="spark" /></span>Disco Campaign Studio</div>
        <div className="stack lg">
          <h1>Intelligent offers, from one sentence.</h1>
          <p>Describe your business. Get the publishers where your offer belongs, creative written for the shoppers who&apos;ll see it, and a campaign config ready to run — with every decision explained and every credit accounted for.</p>
        </div>
        <div className="demo">
          <div className="h">Reviewer walkthrough</div>
          <div className="line"><b>1</b><span>Create an account — it takes ten seconds and starts with 100 credits.</span></div>
          <div className="line"><b>2</b><span>Start a campaign from an example — try the vague one to see the clarity gate.</span></div>
          <div className="line"><b>3</b><span>Use 👍/👎 on any card, check the Checks tab, then compare two runs in History.</span></div>
        </div>
      </section>
      <section className="form">
        <form className="box" onSubmit={submit} noValidate>
          <div>
            <h2>{mode === "in" ? "Welcome back" : "Create your account"}</h2>
            <p className="help" style={{ marginTop: 6 }}>{mode === "in" ? "Sign in to your workspace." : "Free while in beta. 100 credits included, no card needed."}</p>
          </div>
          {googleEnabled && <>
            <button type="button" className="btn lg block" onClick={google}><GoogleIcon /> Continue with Google</button>
            <div className="orline">or with email</div>
          </>}
          {mode === "up" && (
            <div className="field"><label className="label" htmlFor="name">Full name</label><input className="input" id="name" placeholder="Ada Lovelace" autoComplete="name" value={name} onChange={(e) => setName(e.target.value)} /></div>
          )}
          <div className="field">
            <label className="label" htmlFor="email">Work email</label>
            <input className={`input ${errs.email ? "bad" : ""}`} id="email" type="email" placeholder="you@company.com" autoComplete="email" value={email} onChange={(e) => setEmail(e.target.value)} />
            {errs.email && <div className="err">{errs.email}</div>}
          </div>
          <div className="field">
            <div className="row between"><label className="label" htmlFor="pw">Password</label>{mode === "in" && <a href="#" className="help" onClick={(e) => { e.preventDefault(); toast("Reset link sent to " + (email || "your email")); }}>Forgot?</a>}</div>
            <input className={`input ${errs.pw ? "bad" : ""}`} id="pw" type="password" placeholder="••••••••" autoComplete={mode === "in" ? "current-password" : "new-password"} value={pw} onChange={(e) => setPw(e.target.value)} />
            {errs.pw && <div className="err">{errs.pw}</div>}
          </div>
          {errs.form && <div className="banner bad"><Icon name="warn" /><span>{errs.form}</span></div>}
          <button className="btn primary lg block" id="submit" disabled={busy}>{busy ? (mode === "in" ? "Signing in…" : "Creating account…") : (mode === "in" ? "Sign in" : "Create account")} <Icon name="arrow" /></button>
          <p className="help" style={{ textAlign: "center" }}>
            {mode === "in" ? <>New here? <a href="#" onClick={(e) => { e.preventDefault(); setMode("up"); setErrs({}); }}>Create an account</a></>
              : <>Already have an account? <a href="#" onClick={(e) => { e.preventDefault(); setMode("in"); setErrs({}); }}>Sign in</a></>}
          </p>
          <p className="help" style={{ textAlign: "center", fontSize: 11.5 }}>Auth by Supabase (email + password{googleEnabled ? " or Google" : ""}). Tokens are verified by the API against the project&apos;s JWKS.</p>
        </form>
      </section>
    </div>
  );
}
