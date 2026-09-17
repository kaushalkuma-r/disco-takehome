"""End-to-end API run against a live server + real Supabase + real OpenAI (not collected by pytest).

    .venv/bin/python tests/e2e_api.py [http://localhost:8000]

Creates a throwaway Supabase user, exercises every touchpoint, asserts the credit/ledger invariants, deletes the user.
"""
from __future__ import annotations

import json
import sys
import time
import uuid

import httpx

from app.config import get_settings

BASE = sys.argv[1] if len(sys.argv) > 1 else "http://localhost:8000"
s = get_settings()
fails: list[str] = []


def check(cond: bool, msg: str) -> None:
    print(("  ok  " if cond else "  FAIL") + " " + msg)
    if not cond:
        fails.append(msg)


def main() -> int:
    email = f"e2e-{uuid.uuid4().hex[:6]}@example.com"
    r = httpx.post(f"{s.supabase_url}/auth/v1/signup", headers={"apikey": s.supabase_anon_key}, json={"email": email, "password": "disco-demo-123"}, timeout=30)
    tok = r.json()["access_token"]
    uid = r.json()["user"]["id"]
    H = {"Authorization": f"Bearer {tok}"}
    c = httpx.Client(base_url=BASE, headers=H, timeout=180)
    try:
        me = c.get("/api/me").json()
        check(me["credit_balance"] == 100, f"signup grant: balance {me['credit_balance']}")
        check(c.get("/api/me").json()["credit_balance"] == 100, "second /me does not re-grant")

        # clarity gate (free)
        cl = c.post("/api/clarity", json={"brief": "We help people feel better."}).json()
        check(cl["score"] < 60 and len(cl["questions"]) == 3, f"vague brief → clarity {cl['score']} with {len(cl['questions'])} questions")
        check(c.get("/api/me").json()["credit_balance"] == 100, "clarity is free")
        gen_vague = c.post("/api/campaigns", json={"brief": "We help people feel better."})
        check(gen_vague.status_code == 409 and gen_vague.json()["error"]["code"] == "clarity_too_low", "generate on vague brief → 409 clarity_too_low")

        # streaming generation
        brief = "We sell premium dog food for senior dogs, targeting owners who care about joint health and longevity. Grain-free, vet-formulated, subscription-based."
        stages, done, err = [], None, None
        t0 = time.perf_counter()
        with c.stream("POST", "/api/campaigns", json={"brief": brief}, headers={**H, "Accept": "text/event-stream"}) as resp:
            check(resp.headers.get("content-type", "").startswith("text/event-stream"), "SSE content-type")
            ev = None
            for line in resp.iter_lines():
                if line.startswith("event:"):
                    ev = line.split(":", 1)[1].strip()
                elif line.startswith("data:"):
                    data = json.loads(line.split(":", 1)[1].strip())
                    if ev == "stage":
                        stages.append(data)
                        print(f"     stage {data['status']:4} {data['stage']} {data['detail']} {data['ms']}ms")
                    elif ev == "done":
                        done = data
                    elif ev == "error":
                        err = data
        check(err is None and done is not None, f"stream finished ({time.perf_counter()-t0:.1f}s) err={err}")
        check(len([x for x in stages if x["status"] == "done"]) >= 5, f"{len(stages)} stage events received")
        camp = done["campaign"]; cid = camp["id"]
        check(3 <= len(camp["publishers"]) <= 5, f"{len(camp['publishers'])} publishers recommended")
        check(all(len(p["why"]) >= 40 for p in camp["publishers"]), "every publisher has a reason")
        check(len(camp["excluded"]) >= 3, f"{len(camp['excluded'])} exclusions with reasons")
        check(3 <= len(camp["creatives"]) <= 5 and len(camp["creatives"]) == len(camp["personas"]), f"{len(camp['creatives'])} creatives = personas")
        check(sum(a["pct"] for a in camp["config"]["allocation"]) == 100, "allocation sums to 100")
        charged = done["credits"]["charged"]
        check(charged >= 10 and done["credits"]["balance"] == 100 - charged, f"charged {charged} (base {done['credits']['base']} + usage {done['credits']['usage']}), balance {done['credits']['balance']}")
        print("     checks:", [v["check"] for v in done["validation"] if not v["passed"]] or "all pass")
        bal = done["credits"]["balance"]

        # free deterministic edits
        last_pub = camp["publishers"][-1]["id"]
        p = c.patch(f"/api/campaigns/{cid}", json={"op": "drop_publisher", "publisher_id": last_pub}).json()
        check(all(x["id"] != last_pub for x in p["campaign"]["publishers"]) and p["credits"]["charged"] == 0, "drop publisher is free and applied")
        check(sum(a["pct"] for a in p["campaign"]["config"]["allocation"]) == 100, "allocation re-normalised to 100")
        check(p["campaign"]["version"] == camp["version"] + 1, "version bumped")
        p2 = c.patch(f"/api/campaigns/{cid}", json={"op": "set_budget", "total_usd": 20000}).json()
        check(p2["campaign"]["config"]["budget"]["total_usd"] == 20000 and p2["credits"]["charged"] == 0, "set budget free")
        pid = camp["creatives"][0]["persona_id"]
        p3 = c.patch(f"/api/campaigns/{cid}", json={"op": "update_creative", "persona_id": pid, "headline": "Edited headline."}).json()
        check(p3["campaign"]["creatives"][0]["headline"] == "Edited headline." and p3["credits"]["charged"] == 0, "manual creative edit free")
        p4 = c.patch(f"/api/campaigns/{cid}", json={"op": "restore_version"}).json()
        check(p4["campaign"]["creatives"][0]["headline"] != "Edited headline.", "restore_version undoes the edit")

        # feedback repair (charged)
        old = p4["campaign"]["creatives"][0]["headline"]
        fb = c.post("/api/feedback", json={"campaign_id": cid, "target_kind": "creative", "target_id": pid, "vote": "down", "comment": "too clinical, make it warmer"}).json()
        rep = fb["repair"]
        check(rep and rep["campaign"]["creatives"][0]["headline"] != old, f"feedback repair rewrote creative: {rep['campaign']['creatives'][0]['headline']!r}")
        check(rep["credits"]["base"] == 1 and rep["credits"]["charged"] >= 1, f"feedback repair charged {rep['credits']['charged']}")
        up = c.post("/api/feedback", json={"campaign_id": cid, "target_kind": "publisher", "target_id": camp["publishers"][0]["id"], "vote": "up"}).json()
        check(up["repair"] is None, "thumbs-up stores only")

        # regenerate (charged)
        rg = c.post(f"/api/campaigns/{cid}/creatives/{pid}/regenerate", json={}).json()
        check(rg["credits"]["base"] == 2, f"regenerate base 2, charged {rg['credits']['charged']}")

        # memory + chat
        c.put("/api/memory/preferences", json={"key": "brand_voice", "value": "understated, no exclamation marks"})
        mem = c.get("/api/memory").json()
        check(mem["preferences"].get("brand_voice"), "preference saved")
        ch = c.post("/api/chat", json={"campaign_id": cid, "message": f"never use {p4['campaign']['publishers'][-1]['id'].replace('pub_', 'pub ')}"}).json()
        print("     chat:", ch["reply"][:160], "| cards:", [x["type"] for x in ch["cards"]], "| credits", ch["credits"])
        first_name = [x["name"] for x in c.get("/api/catalog").json()["publishers"] if x["id"] == p4["campaign"]["publishers"][-1]["id"]][0]
        ch2 = c.post("/api/chat", json={"thread_id": ch["thread_id"], "message": f"Never use {first_name} again"}).json()
        mem2 = c.get("/api/memory").json()
        print("     chat2:", ch2["reply"][:160], "| cards:", [x["type"] for x in ch2["cards"]])
        check(p4["campaign"]["publishers"][-1]["id"] in (mem2["preferences"].get("banned_publishers") or []), "chat 'never use X' banned the publisher")
        ch3 = c.post("/api/chat", json={"thread_id": ch["thread_id"], "message": "Why does the top publisher rank first?"}).json()
        check(len(ch3["reply"]) > 20 and ch3["credits"]["charged"] == 0, f"explain question answered free: {ch3['reply'][:100]!r}")
        thread = c.get(f"/api/chat/{ch['thread_id']}").json()
        check(len(thread["messages"]) >= 6, f"thread persisted {len(thread['messages'])} messages")
        ch4 = c.post("/api/chat", json={"message": "A sustainable activewear brand for women. Made from recycled ocean plastic. Price point sits between Lululemon and Girlfriend Collective."}).json()
        print("     chat-gen:", ch4["reply"][:120], "| cards:", [x["type"] for x in ch4["cards"]], "| credits", ch4["credits"])
        check(any(x["type"] == "campaign_summary" for x in ch4["cards"]), "chat builds a campaign from a clear brief")
        cid2 = ch4["campaign_id"]

        # export, list, compare, activity, credits
        pdf = c.get(f"/api/campaigns/{cid}/export.pdf")
        check(pdf.status_code == 200 and pdf.content[:4] == b"%PDF" and len(pdf.content) > 3000, f"pdf export {len(pdf.content)} bytes")
        js = c.get(f"/api/campaigns/{cid}/export.json").json()
        check(js["schema"] == "campaign_config.v1" and js["placements"], "json export")
        lst = c.get("/api/campaigns").json()
        check(len(lst) == 2, f"list shows {len(lst)} campaigns")
        cmp_ = c.get(f"/api/campaigns/{cid}/compare/{cid2}").json()
        check(len(cmp_["publishers"]) >= 3, "compare returns publisher rows")
        act = c.get(f"/api/campaigns/{cid}/activity").json()
        check(len(act["interactions"]) >= 5 and len(act["feedback"]) == 2, f"activity {len(act['interactions'])} interactions, {len(act['feedback'])} feedback")
        vers = c.get(f"/api/campaigns/{cid}/versions").json()
        check(len(vers) >= 5, f"{len(vers)} versions")
        cr = c.get("/api/credits").json()
        check(cr["consistent"] and cr["balance"] == sum(r["delta"] for r in cr["ledger"]), f"ledger consistent, balance {cr['balance']}")
        est = c.get("/api/credits/estimate", params={"action": "generate_campaign"}).json()
        check(est["total"] == 12 and est["balance"] == cr["balance"], "estimate endpoint")
        check(c.get(f"/api/campaigns/{uuid.uuid4()}").status_code == 404, "unknown campaign → 404")
        check(httpx.get(f"{BASE}/api/me").status_code == 401, "no token → 401")
        d = c.delete(f"/api/campaigns/{cid2}")
        check(d.status_code == 204 and len(c.get("/api/campaigns").json()) == 1, "delete campaign")
    finally:
        httpx.delete(f"{s.supabase_url}/auth/v1/admin/users/{uid}", headers={"apikey": s.supabase_service_role_key, "Authorization": f"Bearer {s.supabase_service_role_key}"}, timeout=30)
    print("\nRESULT:", "FAILED" if fails else "ALL GOOD", fails)
    return 1 if fails else 0


if __name__ == "__main__":
    sys.exit(main())
