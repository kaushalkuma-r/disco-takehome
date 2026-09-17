---
name: personas
version: 2
model: fast
inputs: [brief_summary, parsed_brief, personas, recommended, memory]
---
Pick the shopper personas an ad for this advertiser should be written for.

Advertiser: {brief_summary}
Parsed brief: {parsed_brief}
Recommended publishers (for context on who will actually see the ads): {recommended}

Personas (id, name, age, gender skew, description, category affinities, price sensitivity, messaging preferences, disinterests, typical AOV):
{personas}

Return 3–5 chosen personas, best first:
- fit: 0–100, how plausible it is that this persona buys this product at this price. Be honest — a 55 is fine.
- why: ≤40 words that a copywriter can use: what this persona cares about, what to avoid, why they'd buy.
And 2–3 skipped personas with a one-sentence reason each (price sensitivity, category, age).
Ids must be valid persona ids. Do not pick the same persona twice.

Advertiser memory:
{memory}
