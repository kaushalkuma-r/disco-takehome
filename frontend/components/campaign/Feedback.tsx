"use client";
import { useEffect, useRef, useState } from "react";
import { ApiError, api } from "@/lib/api";
import { useApplyResponse } from "@/lib/session";
import type { FeedbackRow } from "@/lib/types";
import { Icon, useToast } from "@/lib/ui";

type Props = { campaignId: string; kind: "publisher" | "creative" | "persona" | "config" | "clarity"; targetId: string; existing?: FeedbackRow; onBusy?: (b: boolean) => void };

/** 👍 / 👎 on any unit. 👎 opens a comment popover; comment → targeted repair (charged ~2 credits). */
export function FeedbackButtons({ campaignId, kind, targetId, existing, onBusy }: Props) {
  const [open, setOpen] = useState(false);
  const [text, setText] = useState("");
  const [vote, setVote] = useState<"up" | "down" | null>(existing?.vote ?? null);
  const toast = useToast();
  const apply = useApplyResponse();
  const ref = useRef<HTMLSpanElement>(null);

  useEffect(() => { setVote(existing?.vote ?? null); }, [existing?.vote]);
  useEffect(() => {
    if (!open) return;
    const h = (e: MouseEvent) => { if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false); };
    document.addEventListener("click", h);
    return () => document.removeEventListener("click", h);
  }, [open]);

  async function send(v: "up" | "down", comment?: string) {
    setOpen(false);
    setVote(v);
    onBusy?.(true);
    try {
      const res = await api.feedback({ campaign_id: campaignId, target_kind: kind, target_id: targetId, vote: v, comment });
      if (res.repair) { apply.campaign(res.repair); toast(`Repaired from your note · ${res.repair.credits.charged} credits`); }
      else { apply.invalidate(["activity", campaignId]); toast(v === "up" ? "Thanks — noted as a good example." : "Noted. Add a comment next time and I can fix it."); }
    } catch (e) {
      toast(e instanceof ApiError && e.code === "insufficient_credits" ? "Not enough credits for an AI fix — note saved." : "Feedback failed; nothing charged.", "warn");
    } finally { onBusy?.(false); }
  }

  return (
    <span className="fb" ref={ref} style={{ position: "relative" }}>
      <button type="button" className={vote === "up" ? "on-up" : ""} aria-label={`Good ${kind}`} title="Good" onClick={() => send("up")}><Icon name="up" /></button>
      <button type="button" className={vote === "down" ? "on-down" : ""} aria-label="Needs work — leave a note" title="Needs work" onClick={() => setOpen((o) => !o)}><Icon name="down" /></button>
      {open && (
        <div className="popover" style={{ top: 34, right: 0 }} onClick={(e) => e.stopPropagation()}>
          <b>What should change?</b>
          <textarea className="textarea" autoFocus value={text} onChange={(e) => setText(e.target.value)}
            placeholder={kind === "creative" ? "e.g. too clinical, make it warmer" : kind === "publisher" ? "e.g. audience skews too young for us" : "Tell me what is off"} />
          <div className="row between">
            <span className="help">{kind === "clarity" ? "Saved as a note" : "Fix with AI · ~2 credits"}</span>
            <div className="row">
              <button className="btn sm" onClick={() => setOpen(false)}>Cancel</button>
              <button className="btn primary sm" onClick={() => send("down", text.trim() || undefined)}>{text.trim() && kind !== "clarity" ? "Send & fix" : "Send"}</button>
            </div>
          </div>
        </div>
      )}
    </span>
  );
}
