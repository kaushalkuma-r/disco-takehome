# Prompts

Every prompt the system uses, one file each. Frontmatter carries `name`, `version` and `model`; the
body is a Jinja-free template rendered with Python `str.format_map` on the variables listed in
`inputs`. The `version` is stored on every interaction so a ranking can be traced to the prompt
that produced it. Output shapes are the Pydantic models in `backend/app/schemas/domain.py`,
enforced with OpenAI structured outputs — the model cannot return a shape the app doesn't expect.

| File | Tool | Model | Output |
|---|---|---|---|
| `_context.md` | prepended to every prompt | — | shared placement/catalog context + house rules |
| `clarity.md` (v4) | score_clarity | gpt-4.1-mini | ClarityOut |
| `rank.md` (v5) | rank_publishers | gpt-4.1-mini | RankOut |
| `personas.md` (v3) | pick_personas | gpt-4.1-mini | PersonasOut |
| `creative.md` (v4) | write_creatives / regenerate_creative | gpt-4.1 | CreativesOut (+assumptions) |
| `config_note.md` (v2) | build_config | gpt-4.1-mini | ConfigNoteOut |
| `chat_system.md` (v4) | chat planner | gpt-4.1 | tool calls |

Every output schema starts with an `analysis` field so the model reasons before it answers (structured outputs preserve field order). Creatives also return `assumptions`: facts the advertiser must confirm because the copy implies them and the brief did not state them.
