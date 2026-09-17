"use client";
import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from "react";

/* ---------- icons (inline SVG; same set as the prototype) ---------- */
const P: Record<string, string> = {
  spark: '<path d="M12 3l1.8 5.2L19 10l-5.2 1.8L12 17l-1.8-5.2L5 10l5.2-1.8z"/><path d="M19 17l.7 2.3L22 20l-2.3.7L19 23l-.7-2.3L16 20l2.3-.7z"/>',
  home: '<path d="M3 11l9-8 9 8v9a2 2 0 0 1-2 2h-4v-6H9v6H5a2 2 0 0 1-2-2z"/>',
  plus: '<path d="M12 5v14M5 12h14"/>',
  chat: '<path d="M21 12a8 8 0 0 1-8 8H7l-4 3V12a8 8 0 0 1 8-8h2a8 8 0 0 1 8 8z"/>',
  hist: '<path d="M3 12a9 9 0 1 0 3-6.7L3 8"/><path d="M3 3v5h5"/><path d="M12 7v5l3 2"/>',
  brain: '<path d="M9 3a3 3 0 0 0-3 3v1a3 3 0 0 0-2 5 3 3 0 0 0 2 5v1a3 3 0 0 0 6 0V6a3 3 0 0 0-3-3z"/><path d="M15 3a3 3 0 0 1 3 3v1a3 3 0 0 1 2 5 3 3 0 0 1-2 5v1a3 3 0 0 1-6 0V6a3 3 0 0 1 3-3z"/>',
  coin: '<circle cx="12" cy="12" r="9"/><path d="M12 7v10M9.5 9.5h3.75a1.75 1.75 0 0 1 0 3.5H9.5h4.25a1.75 1.75 0 0 1 0 3.5H9.5"/>',
  check: '<path d="M5 12l5 5L20 7"/>',
  x: '<path d="M6 6l12 12M18 6L6 18"/>',
  arrow: '<path d="M5 12h14M13 5l7 7-7 7"/>',
  back: '<path d="M19 12H5M11 19l-7-7 7-7"/>',
  dl: '<path d="M12 3v12M6 11l6 6 6-6"/><path d="M4 21h16"/>',
  copy: '<rect x="9" y="9" width="12" height="12" rx="2"/><path d="M5 15V5a2 2 0 0 1 2-2h10"/>',
  edit: '<path d="M12 20h9"/><path d="M16.5 3.5a2.1 2.1 0 0 1 3 3L7 19l-4 1 1-4z"/>',
  refresh: '<path d="M21 12a9 9 0 1 1-2.6-6.4"/><path d="M21 3v6h-6"/>',
  undo: '<path d="M3 7v6h6"/><path d="M21 17a9 9 0 0 0-15-6.7L3 13"/>',
  out: '<path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4"/><path d="M16 17l5-5-5-5M21 12H9"/>',
  sun: '<circle cx="12" cy="12" r="4"/><path d="M12 2v2M12 20v2M2 12h2M20 12h2M4.9 4.9l1.4 1.4M17.7 17.7l1.4 1.4M4.9 19.1l1.4-1.4M17.7 6.3l1.4-1.4"/>',
  send: '<path d="M22 2L11 13"/><path d="M22 2L15 22l-4-9-9-4z"/>',
  users: '<circle cx="9" cy="8" r="4"/><path d="M2 21a7 7 0 0 1 14 0"/><path d="M16 4a4 4 0 0 1 0 8M22 21a7 7 0 0 0-5-6.7"/>',
  layers: '<path d="M12 3l9 5-9 5-9-5z"/><path d="M3 13l9 5 9-5"/><path d="M3 17l9 5 9-5"/>',
  info: '<circle cx="12" cy="12" r="9"/><path d="M12 11v5M12 8h.01"/>',
  warn: '<path d="M12 3l10 18H2z"/><path d="M12 10v4M12 18h.01"/>',
  shield: '<path d="M12 2l8 3v6c0 5-3.5 9-8 11-4.5-2-8-6-8-11V5z"/><path d="M9 12l2 2 4-4"/>',
  up: '<path d="M7 10v11H4V10z"/><path d="M7 10l4-7c1.5 0 2.5 1 2.5 2.5V9h5a2 2 0 0 1 2 2.3l-1.3 7A2 2 0 0 1 17.2 20H7"/>',
  down: '<path d="M17 14V3h3v11z"/><path d="M17 14l-4 7c-1.5 0-2.5-1-2.5-2.5V15h-5a2 2 0 0 1-2-2.3l1.3-7A2 2 0 0 1 6.8 4H17"/>',
  trash: '<path d="M3 6h18M8 6V4h8v2M6 6l1 14h10l1-14"/>',
};

export function Icon({ name, size, className, style }: { name: keyof typeof P | string; size?: number; className?: string; style?: React.CSSProperties }) {
  const sw = name === "check" ? 3 : name === "plus" || name === "x" || name === "arrow" || name === "back" || name === "send" ? 2.2 : 2;
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={sw} strokeLinecap="round" strokeLinejoin="round" className={className}
      style={size ? { width: size, height: size, ...style } : style} aria-hidden="true" dangerouslySetInnerHTML={{ __html: P[name] || "" }} />
  );
}

export function GoogleIcon() {
  return (
    <svg viewBox="0 0 24 24" style={{ width: 16, height: 16 }} aria-hidden="true">
      <path fill="#4285F4" d="M23.5 12.3c0-.8-.1-1.6-.2-2.3H12v4.5h6.5a5.6 5.6 0 0 1-2.4 3.6v3h3.9c2.3-2.1 3.5-5.2 3.5-8.8z" />
      <path fill="#34A853" d="M12 24c3.2 0 6-1.1 8-2.9l-3.9-3a7.2 7.2 0 0 1-10.8-3.8H1.3v3.1A12 12 0 0 0 12 24z" />
      <path fill="#FBBC05" d="M5.3 14.3a7.2 7.2 0 0 1 0-4.6V6.6H1.3a12 12 0 0 0 0 10.8l4-3.1z" />
      <path fill="#EA4335" d="M12 4.8c1.8 0 3.4.6 4.6 1.8l3.4-3.4A12 12 0 0 0 1.3 6.6l4 3.1A7.2 7.2 0 0 1 12 4.8z" />
    </svg>
  );
}

/* ---------- formatting ---------- */
export const fmtImp = (n: number) => (n >= 1e6 ? (n / 1e6).toFixed(n % 1e6 ? 1 : 0) + "M" : String(n));
export const fmt$ = (n: number | null | undefined) => "$" + Number(n ?? 0).toLocaleString();
export const dateS = (iso: string) => new Date(iso).toLocaleDateString(undefined, { month: "short", day: "numeric" });
export const dateT = (iso: string) => new Date(iso).toLocaleString(undefined, { month: "short", day: "numeric", hour: "numeric", minute: "2-digit" });
export const scoreCls = (s: number) => (s >= 75 ? "good" : s >= 50 ? "warn" : "bad");
export const creditCls = (b: number) => (b < 10 ? "bad" : b < 20 ? "warn" : "");
export const letter = (i: number) => String.fromCharCode(65 + i);

/* ---------- toasts ---------- */
type Toast = { id: number; msg: string; icon: string };
const ToastCtx = createContext<(msg: string, icon?: string) => void>(() => {});
export function ToastProvider({ children }: { children: ReactNode }) {
  const [items, setItems] = useState<Toast[]>([]);
  const push = useCallback((msg: string, icon = "check") => {
    const id = Date.now() + Math.random();
    setItems((x) => [...x, { id, msg, icon }]);
    setTimeout(() => setItems((x) => x.filter((t) => t.id !== id)), 3200);
  }, []);
  return (
    <ToastCtx.Provider value={push}>
      {children}
      <div className="toast-wrap">
        {items.map((t) => (
          <div key={t.id} className="toast" role="status"><Icon name={t.icon} size={16} />{t.msg}</div>
        ))}
      </div>
    </ToastCtx.Provider>
  );
}
export const useToast = () => useContext(ToastCtx);

/* ---------- theme ---------- */
export function useTheme() {
  const [theme, setTheme] = useState<string | null>(null);
  useEffect(() => {
    try { const t = localStorage.getItem("dcs.theme"); if (t) { document.documentElement.setAttribute("data-theme", t); setTheme(t); } } catch {}
  }, []);
  const toggle = useCallback(() => {
    const r = document.documentElement;
    const cur = r.getAttribute("data-theme") || (matchMedia("(prefers-color-scheme: dark)").matches ? "dark" : "light");
    const next = cur === "dark" ? "light" : "dark";
    r.setAttribute("data-theme", next); setTheme(next);
    try { localStorage.setItem("dcs.theme", next); } catch {}
  }, []);
  return useMemo(() => ({ theme, toggle }), [theme, toggle]);
}

/* ---------- small primitives ---------- */
export function Pill({ tone, children, className, style, title }: { tone?: string; children: ReactNode; className?: string; style?: React.CSSProperties; title?: string }) {
  return <span className={`pill ${tone || ""} ${className || ""}`} style={style} title={title}>{children}</span>;
}
export function Bar({ value, tone, className }: { value: number; tone?: string; className?: string }) {
  return <div className={`bar ${tone || ""} ${className || ""}`}><i style={{ width: `${Math.max(0, Math.min(100, value))}%` }} /></div>;
}
export function Empty({ icon = "layers", title, children }: { icon?: string; title: string; children?: ReactNode }) {
  return <div className="empty"><Icon name={icon} size={36} /><b>{title}</b>{children}</div>;
}
export function Spinner() {
  return <span className="typing" aria-label="Loading"><i /><i /><i /></span>;
}
