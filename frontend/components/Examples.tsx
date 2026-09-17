"use client";
import { useMe } from "@/lib/session";

/** Example brief chips from the data pack (served by /api/me). */
export function Examples({ onPick }: { onPick: (text: string) => void }) {
  const { data: me } = useMe();
  const items = (me?.examples || []).filter((_, i) => [0, 1, 4, 14].includes(i));
  return (
    <div className="examples">
      {items.map((e) => (
        <button type="button" key={e} className="chip" onClick={() => onPick(e)}>{e.length > 38 ? e.slice(0, 36) + "…" : e}</button>
      ))}
    </div>
  );
}
