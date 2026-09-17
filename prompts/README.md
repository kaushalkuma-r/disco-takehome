# Prompts

Every prompt the system uses, one file each. Frontmatter carries `name`, `version` and `model`; the
body is a Jinja-free template rendered with Python `str.format_map` on the variables listed in
`inputs`. The `version` is stored on every interaction so a ranking can be traced to the prompt
that produced it. Output shapes are the Pydantic models in `backend/app/schemas/domain.py`,
enforced with OpenAI structured outputs — the model cannot return a shape the app doesn't expect.

| File | Tool | Model | Output |
|---|---|---|---|
| `clarity.md` | score_clarity | gpt-4.1-mini | ClarityOut |
| `rank.md` | rank_publishers | gpt-4.1-mini | RankOut |
| `personas.md` | pick_personas | gpt-4.1-mini | PersonasOut |
| `creative.md` | write_creatives / regenerate_creative | gpt-4.1 | CreativesOut |
| `config_note.md` | build_config | gpt-4.1-mini | ConfigNoteOut |
| `chat_system.md` | chat planner | gpt-4.1 | tool calls |
