---
name: personas
version: 3
model: fast
inputs: [brief_summary, parsed_brief, personas, recommended, memory]
---
Choose which shopper personas an ad for this advertiser should be written for. Personas are the people who actually shop on the recommended publishers, so the question is: which of them would plausibly buy THIS product at THIS price?

Advertiser: {brief_summary}
Parsed brief: {parsed_brief}
Recommended publishers (who will see the ads): {recommended}

Personas:
{personas}

## Step 1 — analysis (write first)
For the product: what motivates its buyer (health, status, convenience, values, price, performance, gifting)? Which personas share that motivation, at this price sensitivity, in this age band? Which personas would need the brief to contain a claim it does NOT contain (e.g. a sustainability claim) to be interested — those get low fit.

## Step 2 — fit calibration (0–100 = probability this persona buys)
- 85–100: the description could have been written about this persona (senior dog food → The Pet Parent).
- 65–84: shares the core motivation and price tolerance; one angle would work.
- 45–64: plausible secondary buyer; needs a specific angle and may convert weakly.
- < 45: do not choose. If nothing reaches 45 (e.g. B2B software), choose the 3 least-bad and score them honestly at 25–40 — never inflate.
Penalise: price sensitivity "high" for premium/luxury products; age bands that don't overlap the buyer; motivation that relies on a claim absent from the brief.

## Step 3 — output
- chosen: 3–5, best first, each with fit and why. why ≤40 words, written for a copywriter: what this persona cares about, the angle to use, the thing to avoid. Do not restate the persona description.
- skipped: 2–3 with one concrete sentence each (price sensitivity, category, age, or missing claim).
Ids must be valid persona ids; no duplicates.

Advertiser memory:
{memory}
