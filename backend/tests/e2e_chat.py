"""Chat end-to-end against a live server (not collected by pytest):

    .venv/bin/python tests/e2e_chat.py [http://localhost:8000]

Covers: streamed yield events (thought → tool_card running/completed → turn_end), vague brief → questions
(with multi flag) → answers → campaign in the same thread, in-scope explain (must actually explain, no tools charged),
out-of-scope question (no tools, free, says so), edits (drop / budget / regenerate by letter), memory
("never use X", "remember that"), and conversation history persisted + restored by thread.
"""
from __future__ import annotations

import json
import re
import sys
import uuid

import httpx

from app.config import get_settings

BASE = sys.argv[1] if len(sys.argv) > 1 else "http://localhost:8000"
S = get_settings()
fails: list[str] = []


def check(cond: bool, msg: str) -> None:
    print(("  ok  " if cond else "  FAIL") + " " + msg)
    if not cond:
        fails.append(msg)


def stream_chat(c: httpx.Client, body: dict) -> tuple[list[dict], dict | None, dict | None]:
    events, done, err = [], None, None
    with c.stream("POST", "/api/chat", json=body, headers={"Accept": "text/event-stream"}) as r:
        ev = None
        for line in r.iter_lines():
            if line.startswith("event:"):
                ev = line.split(":", 1)[1].strip()
            elif line.startswith("data:"):
                d = json.loads(line.split(":", 1)[1].strip())
                if ev == "yield":
                    events.append(d)
                elif ev == "done":
                    done = d
                elif ev == "error":
                    err = d
    return events, done, err


def main() -> int:
    email = f"e2e-chat-{uuid.uuid4().hex[:6]}@example.com"
    r = httpx.post(f"{S.supabase_url}/auth/v1/signup", headers={"apikey": S.supabase_anon_key}, json={"email": email, "password": "disco-demo-123"}, timeout=30).json()
    tok, uid = r["access_token"], r["user"]["id"]
    c = httpx.Client(base_url=BASE, headers={"Authorization": f"Bearer {tok}"}, timeout=240)
    try:
        # ---- 1. out-of-scope with no campaign: no tools, free, says so
        ev, d, err = stream_chat(c, {"message": "Why did our sales drop last quarter?"})
        check(err is None and d is not None, "out-of-scope turn completes")
        kinds = [e["kind"] for e in ev]
        check("thought" in kinds and kinds[-1] == "turn_end", f"yield stream has thought…turn_end ({kinds})")
        check(not [e for e in ev if e["kind"] == "tool_card"], "out-of-scope: no tool cards")
        check(d["credits"]["charged"] == 0, "out-of-scope: free")
        low = d["reply"].lower().replace("\u2019", "'")
        check(any(w in low for w in ("can't", "cannot", "outside", "not able", "isn't something", "not something", "don't have", "only")), f"out-of-scope reply declines: {d['reply'][:120]!r}")
        thread = d["thread_id"]

        # ---- 2. vague brief → questions card (free), then answers in the same thread → campaign
        ev, d, err = stream_chat(c, {"thread_id": thread, "message": "A new kind of thing for moms."})
        cards = [x["type"] for x in d["cards"]]
        check("questions" in cards, f"vague brief → questions card ({cards})")
        q = next(x for x in d["cards"] if x["type"] == "questions")
        check(1 <= len(q["questions"]) <= 3 and all("multi" in qq for qq in q["questions"]), f"{len(q['questions'])} questions carry a multi flag: {[qq['multi'] for qq in q['questions']]}")
        check(d["credits"]["charged"] == 0, "clarification turn is free")
        answers = "; ".join(f"{qq['q']} → {qq['opts'][0]}" for qq in q["questions"])
        ev, d, err = stream_chat(c, {"thread_id": thread, "message": answers})
        cards = [x["type"] for x in d["cards"]]
        gen_cards = [e for e in ev if e["kind"] == "tool_card" and e.get("tool") == "generate_campaign"]
        check("campaign_summary" in cards and d["campaign_id"], f"answers → campaign built in-thread ({cards})")
        check(any(e.get("status") == "completed" for e in gen_cards), "generate_campaign tool card folded to completed")
        stage_rows = [e for e in ev if e["kind"] == "tool_event"]
        check(len({e["title"] for e in stage_rows}) >= 5, f"generation stages streamed as tool_event rows ({len({e['title'] for e in stage_rows})} distinct)")
        check(d["credits"]["charged"] >= 10, f"generation charged {d['credits']['charged']}")
        cid = d["campaign_id"]

        # ---- 3. in-scope explain: must explain, using get_campaign, free
        ev, d, err = stream_chat(c, {"thread_id": thread, "message": "Why does the top publisher rank first?"})
        camp = c.get(f"/api/campaigns/{cid}").json()["campaign"]
        top_name = [p["name"] for p in c.get("/api/catalog").json()["publishers"] if p["id"] == camp["publishers"][0]["id"]][0]
        check(top_name.split()[0].lower() in d["reply"].lower(), f"explain names the top publisher ({top_name}): {d['reply'][:140]!r}")
        check(not re.search(r"i can explain|let me know if|would you like", d["reply"], re.I), "explain does not stall with 'I can explain…'")
        check(d["credits"]["charged"] == 0, "explain is free")

        # ---- 4. out-of-scope with a campaign present
        ev, d, err = stream_chat(c, {"thread_id": thread, "message": "Can you also run this on Google Ads and make banner images?"})
        check(not [e for e in ev if e["kind"] == "tool_card"] and d["credits"]["charged"] == 0, "out-of-scope (other platform/images): no tools, free")

        # ---- 5. edits
        ev, d, err = stream_chat(c, {"thread_id": thread, "message": "Drop the lowest-ranked publisher"})
        n = len(c.get(f"/api/campaigns/{cid}").json()["campaign"]["publishers"])
        check(n == len(camp["publishers"]) - 1 and d["credits"]["charged"] == 0, f"drop via chat applied ({len(camp['publishers'])}→{n}) and free")
        ev, d, err = stream_chat(c, {"thread_id": thread, "message": "Raise the total budget to $20k"})
        check(c.get(f"/api/campaigns/{cid}").json()["campaign"]["config"]["budget"]["total_usd"] == 20000, "budget via chat applied")
        before = c.get(f"/api/campaigns/{cid}").json()["campaign"]["creatives"][1]["headline"]
        ev, d, err = stream_chat(c, {"thread_id": thread, "message": "Make variant B punchier"})
        after = c.get(f"/api/campaigns/{cid}").json()["campaign"]["creatives"][1]["headline"]
        check(after != before and d["credits"]["charged"] >= 1, f"variant B rewritten via chat, charged {d['credits']['charged']}")
        check(any(x["type"] == "creative" for x in d["cards"]), "creative card returned")

        # ---- 6. memory
        ev, d, err = stream_chat(c, {"thread_id": thread, "message": "Never use Swiftcart"})
        mem = c.get("/api/memory").json()
        check("pub_001" in (mem["preferences"].get("banned_publishers") or []), "chat banned Swiftcart")
        ev, d, err = stream_chat(c, {"thread_id": thread, "message": "Remember that our AOV is $85"})
        mem = c.get("/api/memory").json()
        check(any("85" in f["text"] for f in mem["facts"]), "chat remembered the fact")

        # ---- 7. history persisted and restorable
        th = c.get(f"/api/chat/{thread}").json()
        roles = [m["role"] for m in th["messages"]]
        check(roles.count("user") >= 9 and roles.count("assistant") >= 9 and th["campaign_id"] == cid, f"thread restored with {len(roles)} messages linked to the campaign")
        check(any(m["cards"] for m in th["messages"] if m["role"] == "assistant"), "cards persisted with messages")
        threads = c.get("/api/chat").json()
        check(any(t["id"] == thread for t in threads), "thread listed for the user")
        # a second thread starts clean (no campaign)
        ev, d, err = stream_chat(c, {"message": "Why does the top publisher rank first?"})
        check(d["campaign_id"] is None and not [e for e in ev if e["kind"] == "tool_card" and e.get("tool") not in ("get_campaign",)] , "fresh thread has no campaign context; no mutating tools")

        # ---- 8. non-stream path still works
        d2 = c.post("/api/chat", json={"thread_id": thread, "message": "Export as PDF"}).json()
        check(any(x["type"] == "export_link" for x in d2["cards"]), "plain JSON chat path returns export link")
    finally:
        httpx.delete(f"{S.supabase_url}/auth/v1/admin/users/{uid}", headers={"apikey": S.supabase_service_role_key, "Authorization": f"Bearer {S.supabase_service_role_key}"}, timeout=30)
    print("\nRESULT:", "FAILED" if fails else "ALL GOOD", fails)
    return 1 if fails else 0


if __name__ == "__main__":
    sys.exit(main())
