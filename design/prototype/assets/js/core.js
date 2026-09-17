/* Campaign Studio prototype — core module.
   store  : localStorage-backed persistence (session, campaigns, ledger, memory, chat)
   api    : in-browser stand-in for the FastAPI backend. Each function mirrors a real endpoint
            and returns the same response shape ({campaign, validation, credits}) the LLD defines.
   ui     : tiny DOM helpers, icons, toast, popover.
   Everything is attached to window.DCS. */
(function () {
  const { PUBS, PERS, TEMPLATES, ALT } = window.DCS.data;

  /* ------------------------------------------------------------------ store */
  const store = {
    get(key, fallback) {
      try { const v = localStorage.getItem('dcs.' + key); return v ? JSON.parse(v) : fallback; } catch (e) { return fallback; }
    },
    set(key, value) { try { localStorage.setItem('dcs.' + key, JSON.stringify(value)); } catch (e) { /* storage unavailable: keep in memory only */ } },
    remove(key) { try { localStorage.removeItem('dcs.' + key); } catch (e) { /* ignore */ } },
  };

  /* ------------------------------------------------------------------ state */
  const state = {
    session: store.get('session', null),
    campaigns: null,
    ledger: null,
    memory: null,
    chat: store.get('chat', null),
  };

  const uid = (prefix) => prefix + '_' + Math.random().toString(36).slice(2, 8);
  const nowIso = () => new Date().toISOString();

  function seed() {
    state.campaigns = store.get('campaigns', null);
    state.ledger = store.get('ledger', null);
    state.memory = store.get('memory', null) || { preferences: {}, facts: [] };
    if (!state.campaigns) {
      const a = mkCampaign('activewear', { id: 'cmp_2041', createdAt: '2026-09-12T10:14:00Z' });
      const b = mkCampaign('dogfood', { id: 'cmp_2057', createdAt: '2026-09-15T16:42:00Z' });
      b.activity[0].credits = 13;
      b.activity.push({ kind: 'fb', at: '2026-09-15T17:02:00Z', text: '👎 on creative C: "too clinical" → regenerated', credits: 2 });
      state.campaigns = [a, b];
      persist('campaigns');
    }
    if (!state.ledger) {
      state.ledger = [
        { id: uid('led'), at: '2026-09-12T10:00:00Z', reason: 'signup_grant', delta: 100, base: 0, usage: null, campaign: null },
        { id: uid('led'), at: '2026-09-12T10:14:00Z', reason: 'generate_campaign', delta: -12, base: 10, usage: { tokens: 7840, mix: '4.1-mini ×4, 4.1 ×1' }, campaign: 'cmp_2041' },
        { id: uid('led'), at: '2026-09-15T16:42:00Z', reason: 'generate_campaign', delta: -13, base: 10, usage: { tokens: 9120, mix: '4.1-mini ×4, 4.1 ×1' }, campaign: 'cmp_2057' },
        { id: uid('led'), at: '2026-09-15T17:02:00Z', reason: 'feedback_repair', delta: -2, base: 1, usage: { tokens: 2210, mix: '4.1 ×1' }, campaign: 'cmp_2057' },
      ];
      persist('ledger');
    }
    persist('memory');
  }

  function persist(key) { store.set(key, state[key]); }

  function mkCampaign(tpl, extra = {}) {
    const t = JSON.parse(JSON.stringify(TEMPLATES[tpl]));
    return Object.assign({
      id: uid('cmp'), createdAt: nowIso(), tpl, status: 'draft', version: 1,
      activity: [{ kind: 'gen', at: extra.createdAt || nowIso(), text: 'Campaign generated (guided mode)', credits: 12 }],
      feedback: {}, // key: target id → {vote, comment}
      history: [],  // previous versions for undo: [{version, snapshot}]
    }, t, extra);
  }

  /* ------------------------------------------------------------------ credits */
  const PRICING = { generate_campaign: 10, regenerate_creative: 2, chat_llm_edit: 1, feedback_repair: 1 };
  const TOKENS_PER_CREDIT = 4000;
  const credits = {
    balance() { return state.ledger.reduce((s, r) => s + r.delta, 0); },
    estimate(action) {
      const base = PRICING[action] || 0;
      const est = { generate_campaign: 2, regenerate_creative: 1, chat_llm_edit: 1, feedback_repair: 1 }[action] || 0;
      return { base, est, total: base + est, balance: this.balance() };
    },
    /* Simulate the reserve→settle path: one ledger row with base + usage. Throws if insufficient. */
    charge(action, campaignId, extra = {}) {
      const base = PRICING[action] || 0;
      if (this.balance() < base) { const e = new Error('insufficient_credits'); e.code = 402; e.balance = this.balance(); e.needed = base; throw e; }
      const tokens = extra.tokens || Math.round(1800 + Math.random() * 1400) * (action === 'generate_campaign' ? 4 : 1);
      const weighted = tokens * (extra.heavy ? 2 : 1.4);
      const usage = Math.ceil(weighted / TOKENS_PER_CREDIT);
      const row = { id: uid('led'), at: nowIso(), reason: action, delta: -(base + usage), base, usage: { tokens, mix: extra.mix || '4.1-mini ×1, 4.1 ×1' }, campaign: campaignId || null };
      state.ledger.push(row); persist('ledger');
      return { charged: base + usage, base, usage, balance: this.balance() };
    },
  };

  /* ------------------------------------------------------------------ validators
     Pure checks over a campaign, mirroring backend/app/agent/validators. */
  const stem = (s) => s.toLowerCase().replace(/[^a-z ]/g, ' ').split(/\s+/).filter((w) => w.length > 3).map((w) => w.replace(/(ing|ed|es|s)$/, ''));
  const validators = [
    { id: 'alloc_sums_100', severity: 'error', repair: 'build_config', run: (c) => { const s = c.config.alloc.reduce((a, x) => a + x.pct, 0); return s === 100 ? null : `Allocation totals ${s}%, must be 100%.`; } },
    { id: 'alloc_cap_45', severity: 'warning', repair: 'build_config', run: (c) => { const over = c.config.alloc.filter((a) => a.pct > 45); return over.length && c.config.alloc.length > 1 ? `${PUBS[over[0].id].name} holds ${over[0].pct}% — over the 45% single-publisher cap.` : null; } },
    { id: 'no_excluded_in_alloc', severity: 'error', repair: 'build_config', run: (c) => { const rec = new Set(c.publishers.map((p) => p.id)); const bad = c.config.alloc.find((a) => !rec.has(a.id)); return bad ? `${PUBS[bad.id].name} has budget but is not recommended.` : null; } },
    { id: 'min_publishers', severity: 'warning', repair: 'rank_publishers', run: (c) => c.publishers.length >= 3 ? null : `Only ${c.publishers.length} publishers recommended; aim for at least 3 to get signal.` },
    { id: 'reason_present', severity: 'error', repair: 'rank_publishers', run: (c) => { const bad = [...c.publishers, ...c.excluded].find((p) => !p.why || p.why.length < 40); return bad ? `${PUBS[bad.id].name} has no usable reason.` : null; } },
    { id: 'creative_lengths', severity: 'error', repair: 'regenerate_creative', run: (c) => { const bad = c.personas.find((p) => p.h.length > 80 || p.b.length < 60 || p.b.length > 240 || p.cta.length > 24); return bad ? `${PERS[bad.id].name}: headline ${bad.h.length}/80, body ${bad.b.length}/240, CTA ${bad.cta.length}/24.` : null; } },
    { id: 'creative_avoids_disinterest', severity: 'warning', repair: 'regenerate_creative', run: (c) => { for (const p of c.personas) { const text = stem(p.h + ' ' + p.b); const hit = PERS[p.id].dis.flatMap(stem).find((w) => text.includes(w)); if (hit) return `${PERS[p.id].name} creative uses "${hit}", a term this persona is disinterested in.`; } return null; } },
    { id: 'creative_uses_preference', severity: 'error', repair: 'regenerate_creative', run: (c) => { const voice = (state.memory.preferences.brand_voice || '').toLowerCase(); if (voice.includes('no exclamation')) { const bad = c.personas.find((p) => /!/.test(p.h + p.b)); if (bad) return `${PERS[bad.id].name} creative uses "!" but brand voice says no exclamation marks.`; } return null; } },
    { id: 'persona_fit_floor', severity: 'warning', repair: 'pick_personas', run: (c) => { const low = c.personas.find((p) => p.fit < 40); return low ? `${PERS[low.id].name} fit is ${low.fit}, below the 40 floor.` : null; } },
    { id: 'budget_sanity', severity: 'error', repair: 'set_budget', run: (c) => { const days = Math.max(1, Math.round((new Date(c.config.flight.end) - new Date(c.config.flight.start)) / 864e5)); const implied = c.config.budget.daily * days; const drift = Math.abs(implied - c.config.budget.total) / c.config.budget.total; return drift > 0.1 ? `Daily × ${days} days = $${implied.toLocaleString()} vs total $${c.config.budget.total.toLocaleString()} (${Math.round(drift * 100)}% off).` : null; } },
    { id: 'banned_publishers', severity: 'error', repair: 'drop_publisher', run: (c) => { const banned = state.memory.preferences.banned_publishers || []; const hit = c.publishers.find((p) => banned.includes(p.id)); return hit ? `${PUBS[hit.id].name} is on your banned list.` : null; } },
  ];
  function validate(c) {
    return validators.map((v) => { const msg = v.run(c); return { check: v.id, severity: v.severity, passed: !msg, message: msg || 'OK', repair_tool: v.repair }; });
  }

  /* ------------------------------------------------------------------ mock model */
  function pickTemplate(text) {
    const t = text.toLowerCase();
    if (/\b(dog|cat|pet|puppy|kitten)\b/.test(t)) return 'dogfood';
    if (/\b(activewear|apparel|legging|wear|clothing|fashion|shoes|outerwear|bedding|linen|handbag)\b/.test(t)) return 'activewear';
    return 'wellness';
  }
  function scoreClarity(text) {
    const t = text.trim(); const words = t.split(/\s+/).filter(Boolean).length;
    for (const k in TEMPLATES) if (TEMPLATES[k].input.toLowerCase() === t.toLowerCase()) return { tpl: k, score: TEMPLATES[k].clarity.score };
    const hasProduct = /\b(sell|make|brand|product|app|subscription|box|drink|candle|bar|supplement|saas|service)\b/i.test(t);
    const hasBuyer = /\b(for|targeting|customers|people who|owners|women|men|moms|parents|athletes)\b/i.test(t);
    const hasPrice = /(\$|price|premium|cheap|affordable|luxury|cost)/i.test(t);
    const s = 18 + Math.min(words, 30) * 1.4 + (hasProduct ? 20 : 0) + (hasBuyer ? 16 : 0) + (hasPrice ? 12 : 0);
    return { tpl: pickTemplate(t), score: Math.max(8, Math.min(95, Math.round(s))) };
  }

  /* ------------------------------------------------------------------ api */
  function snapshot(c) { c.history.push({ version: c.version, snapshot: JSON.parse(JSON.stringify({ publishers: c.publishers, excluded: c.excluded, personas: c.personas, config: c.config })) }); if (c.history.length > 10) c.history.shift(); }
  function bump(c, kind, text, creditsUsed) { c.version += 1; c.activity.push({ kind, at: nowIso(), text, credits: creditsUsed || 0 }); }
  function respond(c, creditsInfo) { persist('campaigns'); return { campaign: c, validation: validate(c), credits: creditsInfo || { charged: 0, balance: credits.balance() } }; }
  const wait = (ms) => new Promise((r) => setTimeout(r, ms));
  function applyMemoryToCampaign(c) {
    const banned = state.memory.preferences.banned_publishers || [];
    banned.forEach((id) => { if (c.publishers.some((p) => p.id === id)) dropPublisherPure(c, id, 'On your banned publishers list.'); });
    const voice = (state.memory.preferences.brand_voice || '').toLowerCase();
    if (voice.includes('no exclamation')) c.personas.forEach((p) => { p.h = p.h.replace(/!/g, '.'); p.b = p.b.replace(/!/g, '.'); });
    if (state.memory.preferences.default_daily_budget) { c.config.budget.daily = +state.memory.preferences.default_daily_budget; c.config.budget.total = c.config.budget.daily * 30; }
    if (state.memory.preferences.bid_strategy_default) c.config.bid.strategy = state.memory.preferences.bid_strategy_default;
  }
  function dropPublisherPure(c, id, reason) {
    c.publishers = c.publishers.filter((x) => x.id !== id);
    c.excluded.unshift({ id, why: reason });
    c.config.alloc = c.config.alloc.filter((x) => x.id !== id);
    const tot = c.config.alloc.reduce((s, x) => s + x.pct, 0);
    if (tot > 0) { c.config.alloc.forEach((x) => { x.pct = Math.round((x.pct / tot) * 100); }); const d = 100 - c.config.alloc.reduce((s, x) => s + x.pct, 0); c.config.alloc[0].pct += d; }
  }

  const api = {
    me() { return { user: state.session, balance: credits.balance() }; },
    signIn(user) { state.session = user; store.set('session', user); if (!store.get('signup_' + user.email, false)) store.set('signup_' + user.email, true); },
    signOut() { state.session = null; store.remove('session'); },
    resetDemo() { ['campaigns', 'ledger', 'memory', 'chat', 'draft'].forEach(store.remove); },

    clarity(text) { const r = scoreClarity(text); const tpl = TEMPLATES[r.tpl]; return { ...r, label: r.score < 60 ? 'Vague' : r.score < 80 ? 'Usable' : 'Clear', signals: tpl.clarity.signals, summary: tpl.clarity.summary, questions: r.score < 60 ? (tpl.clarity.questions || TEMPLATES.wellness.clarity.questions) : [] }; },

    async generate({ text, answers, onStage }) {
      const cl = scoreClarity(text); const vague = cl.score < 60; const tpl = TEMPLATES[cl.tpl];
      credits.estimate('generate_campaign'); if (credits.balance() < PRICING.generate_campaign) { const e = new Error('insufficient_credits'); e.code = 402; throw e; }
      const stages = ['Parsing brief', 'Scoring 20 publishers', 'Selecting personas', 'Writing creative', 'Assembling config', 'Running 11 checks'];
      for (let i = 0; i < stages.length; i++) { onStage && onStage(i, 'run'); await wait(420 + Math.random() * 380); onStage && onStage(i, 'done'); }
      const name = vague ? tpl.name : (tpl.input.toLowerCase() === text.toLowerCase() ? tpl.name : text.slice(0, 42) + (text.length > 42 ? '…' : ''));
      const c = mkCampaign(cl.tpl, { input: text, name });
      c.clarity.score = cl.score; c.clarity.label = cl.score < 60 ? 'Vague' : cl.score < 80 ? 'Usable' : 'Clear';
      if (vague) { c.clarity.answers = answers.slice(); c.clarity.summary = tpl.clarity.resolved || 'Interpreted from your answers.'; }
      applyMemoryToCampaign(c);
      const bill = credits.charge('generate_campaign', c.id, { mix: '4.1-mini ×4, 4.1 ×1' });
      c.activity[0].credits = bill.charged;
      state.campaigns.push(c);
      return respond(c, bill);
    },

    get(id) { return state.campaigns.find((c) => c.id === id); },
    list() { return [...state.campaigns].sort((a, b) => b.createdAt.localeCompare(a.createdAt)); },
    remove(id) { state.campaigns = state.campaigns.filter((c) => c.id !== id); persist('campaigns'); },

    patch(id, op) {
      const c = this.get(id); snapshot(c);
      switch (op.op) {
        case 'drop_publisher': { dropPublisherPure(c, op.publisher_id, op.reason || `Removed by ${state.session.name}.`); bump(c, 'edit', `Dropped ${PUBS[op.publisher_id].name}; budget re-spread`); break; }
        case 'update_creative': { const p = c.personas.find((x) => x.id === op.persona_id); Object.assign(p, { h: op.h ?? p.h, b: op.b ?? p.b, cta: op.cta ?? p.cta }); bump(c, 'edit', `Edited creative for ${PERS[p.id].name}`); break; }
        case 'set_config': { Object.assign(c.config, op.config); bump(c, 'edit', 'Config saved'); break; }
        case 'set_budget': { c.config.budget.total = op.total; c.config.budget.daily = Math.round(op.total / 30); bump(c, 'edit', `Budget set to $${op.total.toLocaleString()}`); break; }
        case 'set_status': { c.status = op.status; c.activity.push({ kind: 'edit', at: nowIso(), text: op.status === 'ready' ? 'Marked ready to launch' : 'Back to draft', credits: 0 }); break; }
        case 'add_persona': { const P = PERS[op.persona_id]; c.personas.push({ id: op.persona_id, fit: 45, why: 'Added manually. Fit is estimated from category affinities only.', h: `Made for ${P.name.replace('The ', 'the ').toLowerCase()}.`, b: `${P.likes.slice(0, 2).join(' and ')} — because that is what you actually care about when you buy.`, cta: 'Learn more' }); c.skipped = c.skipped.filter((s) => s.id !== op.persona_id); bump(c, 'edit', `Added persona ${P.name}`); break; }
        case 'restore_version': { const h = c.history.pop(); if (h) { Object.assign(c, h.snapshot); c.history.pop(); bump(c, 'edit', `Restored version ${h.version}`); } break; }
        default: throw new Error('unknown op ' + op.op);
      }
      return respond(c);
    },

    async regenerate(id, personaId, instruction) {
      const c = this.get(id); const p = c.personas.find((x) => x.id === personaId);
      const bill = credits.charge(instruction ? 'feedback_repair' : 'regenerate_creative', c.id, { heavy: true, mix: '4.1 ×1' });
      snapshot(c); await wait(700);
      const alts = ALT[p.id];
      if (alts) { const [h, b, cta] = alts[0]; ALT[p.id] = [[p.h, p.b, p.cta]]; p.h = h; p.b = b; p.cta = cta; }
      else { p.h = p.h.endsWith('?') ? p.h.slice(0, -1) + '.' : p.h.replace(/\.$/, '?'); }
      if (instruction && /short|punch/i.test(instruction)) { p.b = p.b.split('. ')[0] + '.'; }
      bump(c, instruction ? 'fb' : 'edit', instruction ? `Regenerated ${PERS[p.id].name} creative from feedback: "${instruction}"` : `Regenerated ${PERS[p.id].name} creative`, bill.charged);
      return respond(c, bill);
    },

    async feedback(id, target, vote, comment) {
      const c = this.get(id);
      c.feedback[target.kind + ':' + target.id] = { vote, comment: comment || '' };
      if (vote === 'down' && comment) {
        if (target.kind === 'creative') return this.regenerate(id, target.id, comment);
        if (target.kind === 'publisher') {
          const bill = credits.charge('feedback_repair', c.id, { mix: '4.1-mini ×1' });
          snapshot(c); await wait(600);
          const p = c.publishers.find((x) => x.id === target.id);
          if (p) { p.score = Math.max(20, p.score - 9); p.why = `Re-evaluated after your note ("${comment}"): ${p.why}`; c.publishers.sort((a, b) => b.score - a.score); }
          bump(c, 'fb', `Re-ranked ${PUBS[target.id].name} from feedback`, bill.charged);
          return respond(c, bill);
        }
      }
      c.activity.push({ kind: 'fb', at: nowIso(), text: `${vote === 'up' ? '👍' : '👎'} on ${target.kind}${comment ? ': "' + comment + '"' : ''}`, credits: 0 });
      return respond(c);
    },

    memory: {
      get() { return state.memory; },
      setPreference(key, value, source) { state.memory.preferences[key] = value; state.memory.sources = state.memory.sources || {}; state.memory.sources[key] = { source, at: nowIso() }; persist('memory'); },
      removePreference(key) { delete state.memory.preferences[key]; persist('memory'); },
      addFact(text, source, campaignId) { state.memory.facts.push({ id: uid('fact'), text, source, campaignId: campaignId || null, at: nowIso() }); persist('memory'); },
      removeFact(id) { state.memory.facts = state.memory.facts.filter((f) => f.id !== id); persist('memory'); },
    },
    credits,
    validate,
    ledger() { let bal = 0; return state.ledger.map((r) => { bal += r.delta; return { ...r, balanceAfter: bal }; }).reverse(); },
  };

  /* ------------------------------------------------------------------ ui helpers */
  const I = {
    spark: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M12 3l1.8 5.2L19 10l-5.2 1.8L12 17l-1.8-5.2L5 10l5.2-1.8z"/><path d="M19 17l.7 2.3L22 20l-2.3.7L19 23l-.7-2.3L16 20l2.3-.7z"/></svg>',
    home: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M3 11l9-8 9 8v9a2 2 0 0 1-2 2h-4v-6H9v6H5a2 2 0 0 1-2-2z"/></svg>',
    plus: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round"><path d="M12 5v14M5 12h14"/></svg>',
    chat: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M21 12a8 8 0 0 1-8 8H7l-4 3V12a8 8 0 0 1 8-8h2a8 8 0 0 1 8 8z"/></svg>',
    hist: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M3 12a9 9 0 1 0 3-6.7L3 8"/><path d="M3 3v5h5"/><path d="M12 7v5l3 2"/></svg>',
    brain: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M9 3a3 3 0 0 0-3 3v1a3 3 0 0 0-2 5 3 3 0 0 0 2 5v1a3 3 0 0 0 6 0V6a3 3 0 0 0-3-3z"/><path d="M15 3a3 3 0 0 1 3 3v1a3 3 0 0 1 2 5 3 3 0 0 1-2 5v1a3 3 0 0 1-6 0V6a3 3 0 0 1 3-3z"/></svg>',
    coin: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><circle cx="12" cy="12" r="9"/><path d="M12 7v10M9.5 9.5h3.75a1.75 1.75 0 0 1 0 3.5H9.5h4.25a1.75 1.75 0 0 1 0 3.5H9.5"/></svg>',
    check: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="3" stroke-linecap="round" stroke-linejoin="round"><path d="M5 12l5 5L20 7"/></svg>',
    x: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round"><path d="M6 6l12 12M18 6L6 18"/></svg>',
    arrow: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><path d="M5 12h14M13 5l7 7-7 7"/></svg>',
    back: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><path d="M19 12H5M11 19l-7-7 7-7"/></svg>',
    dl: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M12 3v12M6 11l6 6 6-6"/><path d="M4 21h16"/></svg>',
    copy: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="9" y="9" width="12" height="12" rx="2"/><path d="M5 15V5a2 2 0 0 1 2-2h10"/></svg>',
    edit: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M12 20h9"/><path d="M16.5 3.5a2.1 2.1 0 0 1 3 3L7 19l-4 1 1-4z"/></svg>',
    refresh: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M21 12a9 9 0 1 1-2.6-6.4"/><path d="M21 3v6h-6"/></svg>',
    undo: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M3 7v6h6"/><path d="M21 17a9 9 0 0 0-15-6.7L3 13"/></svg>',
    out: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4"/><path d="M16 17l5-5-5-5M21 12H9"/></svg>',
    sun: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><circle cx="12" cy="12" r="4"/><path d="M12 2v2M12 20v2M2 12h2M20 12h2M4.9 4.9l1.4 1.4M17.7 17.7l1.4 1.4M4.9 19.1l1.4-1.4M17.7 6.3l1.4-1.4"/></svg>',
    send: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><path d="M22 2L11 13"/><path d="M22 2L15 22l-4-9-9-4z"/></svg>',
    google: '<svg viewBox="0 0 24 24"><path fill="#4285F4" d="M23.5 12.3c0-.8-.1-1.6-.2-2.3H12v4.5h6.5a5.6 5.6 0 0 1-2.4 3.6v3h3.9c2.3-2.1 3.5-5.2 3.5-8.8z"/><path fill="#34A853" d="M12 24c3.2 0 6-1.1 8-2.9l-3.9-3a7.2 7.2 0 0 1-10.8-3.8H1.3v3.1A12 12 0 0 0 12 24z"/><path fill="#FBBC05" d="M5.3 14.3a7.2 7.2 0 0 1 0-4.6V6.6H1.3a12 12 0 0 0 0 10.8l4-3.1z"/><path fill="#EA4335" d="M12 4.8c1.8 0 3.4.6 4.6 1.8l3.4-3.4A12 12 0 0 0 1.3 6.6l4 3.1A7.2 7.2 0 0 1 12 4.8z"/></svg>',
    users: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><circle cx="9" cy="8" r="4"/><path d="M2 21a7 7 0 0 1 14 0"/><path d="M16 4a4 4 0 0 1 0 8M22 21a7 7 0 0 0-5-6.7"/></svg>',
    layers: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linejoin="round"><path d="M12 3l9 5-9 5-9-5z"/><path d="M3 13l9 5 9-5"/><path d="M3 17l9 5 9-5"/></svg>',
    info: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><circle cx="12" cy="12" r="9"/><path d="M12 11v5M12 8h.01"/></svg>',
    warn: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M12 3l10 18H2z"/><path d="M12 10v4M12 18h.01"/></svg>',
    shield: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M12 2l8 3v6c0 5-3.5 9-8 11-4.5-2-8-6-8-11V5z"/><path d="M9 12l2 2 4-4"/></svg>',
    up: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M7 10v11H4V10z"/><path d="M7 10l4-7c1.5 0 2.5 1 2.5 2.5V9h5a2 2 0 0 1 2 2.3l-1.3 7A2 2 0 0 1 17.2 20H7"/></svg>',
    down: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M17 14V3h3v11z"/><path d="M17 14l-4 7c-1.5 0-2.5-1-2.5-2.5V15h-5a2 2 0 0 1-2-2.3l1.3-7A2 2 0 0 1 6.8 4H17"/></svg>',
    trash: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M3 6h18M8 6V4h8v2M6 6l1 14h10l1-14"/></svg>',
  };
  const svg = (name, size) => I[name].replace('<svg', `<svg style="width:${size}px;height:${size}px"`);

  const ui = {
    I, svg,
    $: (s, root) => (root || document).querySelector(s),
    $$: (s, root) => [...(root || document).querySelectorAll(s)],
    esc: (s) => String(s ?? '').replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c])),
    fmtImp: (n) => (n >= 1e6 ? (n / 1e6).toFixed(n % 1e6 ? 1 : 0) + 'M' : String(n)),
    fmt$: (n) => '$' + Number(n).toLocaleString(),
    dateS: (iso) => new Date(iso).toLocaleDateString(undefined, { month: 'short', day: 'numeric' }),
    dateT: (iso) => new Date(iso).toLocaleString(undefined, { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' }),
    scoreCls: (s) => (s >= 75 ? 'good' : s >= 50 ? 'warn' : 'bad'),
    creditCls: (b) => (b < 10 ? 'bad' : b < 20 ? 'warn' : ''),
    toast(msg, icon = 'check') {
      const wrap = document.getElementById('toasts'); const el = document.createElement('div');
      el.className = 'toast'; el.setAttribute('role', 'status'); el.innerHTML = I[icon] + ui.esc(msg); wrap.appendChild(el); setTimeout(() => el.remove(), 3000);
    },
    /* Anchored popover with a comment box. onSubmit(text). */
    popover(anchor, { title, placeholder, submitLabel, cost, onSubmit }) {
      ui.$$('.popover').forEach((p) => p.remove());
      const pop = document.createElement('div'); pop.className = 'popover';
      pop.innerHTML = `<b>${ui.esc(title)}</b><textarea class="textarea" id="popText" placeholder="${ui.esc(placeholder)}"></textarea><div class="row between"><span class="help">${cost ? ui.esc(cost) : ''}</span><div class="row"><button class="btn sm" id="popCancel">Cancel</button><button class="btn primary sm" id="popOk">${ui.esc(submitLabel)}</button></div></div>`;
      const host = anchor.closest('.card, .creative, .pubcard, .banner, main') || document.body;
      host.style.position = host.style.position || 'relative'; host.appendChild(pop);
      const r = anchor.getBoundingClientRect(); const hr = host.getBoundingClientRect();
      pop.style.top = r.bottom - hr.top + 6 + 'px'; pop.style.left = Math.max(8, Math.min(r.left - hr.left, hr.width - pop.offsetWidth - 8)) + 'px';
      const close = () => pop.remove();
      ui.$('#popCancel', pop).onclick = close;
      ui.$('#popOk', pop).onclick = () => { const t = ui.$('#popText', pop).value.trim(); close(); onSubmit(t); };
      setTimeout(() => ui.$('#popText', pop).focus(), 0);
    },
    bindClickOutside(el, onOutside) { const h = (e) => { if (!el.contains(e.target)) { onOutside(); document.removeEventListener('click', h); } }; setTimeout(() => document.addEventListener('click', h), 0); },
  };

  window.DCS = Object.assign(window.DCS, { store, state, api, ui, seed, PRICING });
})();
