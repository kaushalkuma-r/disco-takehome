/* View: chat — free-mode orchestrator stand-in. Intent routing is keyword-based here; in
   production the planner model picks tools via function calling. Same api.* as the wizard. */
(function () {
  const { api, ui, views, store, state } = window.DCS;
  const { I, $, $$, esc, fmt$ } = ui;
  const { PUBS, PERS, TEMPLATES, EXAMPLES } = window.DCS.data;

  views.chat = function () {
    const params = new URLSearchParams((location.hash.split('?')[1] || ''));
    views.shell('chat', 'Chat', `
      <div class="chat">
        <div class="msgs" id="msgs" role="log" aria-live="polite"></div>
        <div>
          <div class="suggest" id="sug"></div>
          <form class="composer" id="cf"><label class="sr-only" for="ci">Message</label><input class="input" id="ci" placeholder="Describe your business, or tell me what to change…" autocomplete="off"><button class="btn primary" type="submit" aria-label="Send">${I.send}</button></form>
        </div>
      </div>`);
    const msgs = $('#msgs');
    let chat = state.chat;
    if (!chat || !chat.log || !chat.log.length || params.get('c')) {
      chat = { log: [], stage: 'start', answers: [], cid: params.get('c') || null, tpl: null, text: '' };
      const c = chat.cid && api.get(chat.cid);
      if (c) { chat.stage = 'done'; push('ai', `Picking up <b>${esc(c.name)}</b>. Tell me what to change — <b>“drop ${esc(PUBS[c.publishers[c.publishers.length - 1].id].name)}”</b>, <b>“make variant B punchier”</b>, <b>“never use Swiftcart”</b>, or <b>“export as PDF”</b>.${summaryCard(c)}`); }
      else push('ai', `Hi ${esc(api.me().user.name.split(' ')[0])} — tell me what you sell and who buys it, and I'll build the campaign here. Clarity checks are free; generating costs ~${api.credits.estimate('generate_campaign').total} credits.<div class="card minicard"><div class="r"><b>What I can do</b><span class="pill purple">same brain as the wizard</span></div><div class="r"><span>Build a campaign from a one-line brief</span><span class="help num">~12 cr</span></div><div class="r"><span>Ask clarifying questions when the brief is vague</span><span class="help">free</span></div><div class="r"><span>Drop publishers, change budget, export a brief</span><span class="help">free</span></div><div class="r"><span>Rewrite a creative from your note</span><span class="help num">~3 cr</span></div><div class="r"><span>Remember preferences (“never use Swiftcart”)</span><span class="help">free</span></div></div>`);
    } else chat.log.forEach(paint);
    state.chat = chat; store.set('chat', chat);
    setSuggestions();

    function push(role, html) { const m = { role, html }; chat.log.push(m); store.set('chat', chat); paint(m); }
    function paint(m) { const d = document.createElement('div'); d.className = 'msg ' + (m.role === 'me' ? 'me' : 'ai'); d.innerHTML = (m.role === 'ai' ? `<span class="ai-ic">${I.spark}</span>` : '') + `<div class="b">${m.html}</div>`; msgs.appendChild(d); msgs.scrollTop = msgs.scrollHeight; bindOptions(d); }
    function typing() { const d = document.createElement('div'); d.className = 'msg ai'; d.innerHTML = `<span class="ai-ic">${I.spark}</span><div class="b"><span class="typing"><i></i><i></i><i></i></span></div>`; msgs.appendChild(d); msgs.scrollTop = msgs.scrollHeight; return d; }
    function reply(html, delay = 700, cost) { const t = typing(); return new Promise((res) => setTimeout(() => { t.remove(); push('ai', html + (cost !== undefined ? `<span class="cost">${cost ? `${cost} credits` : 'no model call · free'} · ${api.credits.balance()} left</span>` : '')); views.refreshCredits(); res(); }, delay)); }
    function setSuggestions() { const s = $('#sug'); const items = chat.stage === 'start' ? EXAMPLES.slice(0, 3) : chat.stage === 'done' ? ['Drop the lowest publisher', 'Make variant B punchier', 'Never use Swiftcart', 'Remember that our AOV is $85', 'Export as PDF'] : []; s.innerHTML = items.map((x) => `<button type="button" class="chip" data-s="${esc(x)}">${esc(x.length > 44 ? x.slice(0, 42) + '…' : x)}</button>`).join(''); $$('[data-s]', s).forEach((b) => { b.onclick = () => send(b.dataset.s); }); }
    function bindOptions(d) { $$('[data-ans]', d).forEach((b) => { b.onclick = () => { $$('[data-ans]', d).forEach((x) => { x.disabled = true; }); send(b.dataset.ans); }; }); }
    const current = () => (chat.cid ? api.get(chat.cid) : null);
    function summaryCard(c) { return `<div class="card minicard"><div class="r"><b>${esc(c.name)}</b><span class="pill ${ui.scoreCls(c.clarity.score)}">Clarity ${c.clarity.score}</span></div>${c.publishers.slice(0, 3).map((p, i) => `<div class="r"><span>${i + 1}. ${esc(PUBS[p.id].name)}</span><b class="num">${p.score}</b></div>`).join('')}<div class="r"><span class="help">${c.personas.length} creatives · ${fmt$(c.config.budget.total)} · ${esc(c.config.bid.strategy.replace(/_/g, ' '))} · v${c.version}</span></div><div class="row" style="margin-top:6px"><a class="btn primary sm" href="#/campaign/${c.id}">Open campaign ${I.arrow}</a><a class="btn sm" href="#/campaign/${c.id}/checks">Checks</a></div></div>`; }

    async function send(text) {
      text = text.trim(); if (!text) return; push('me', esc(text)); $('#ci').value = '';
      const t = text.toLowerCase(); const c = current();
      try {
        /* --- memory intents (free) --- */
        if (/\b(never|always)\b/.test(t) && c) {
          const target = c.publishers.find((p) => t.includes(PUBS[p.id].name.toLowerCase().split(' ')[0])) || Object.entries(PUBS).find(([, P]) => t.includes(P.name.toLowerCase().split(' ')[0]));
          const pubId = target ? (target.id || target[0]) : null;
          if (pubId && /never|don't|do not|avoid/.test(t)) {
            const banned = new Set(api.memory.get().preferences.banned_publishers || []); banned.add(pubId); api.memory.setPreference('banned_publishers', [...banned], 'chat');
            let dropped = ''; if (c.publishers.some((p) => p.id === pubId)) { api.patch(c.id, { op: 'drop_publisher', publisher_id: pubId, reason: 'On your banned publishers list.' }); dropped = ` Dropped it from this campaign and re-spread the budget.`; }
            await reply(`Saved to memory: <b>never use ${esc(PUBS[pubId].name)}</b>.${dropped} Future campaigns will exclude it automatically. <a href="#/memory">Manage memory</a>${summaryCard(c)}`, 600, 0); return;
          }
          if (/exclamation|tone|voice|formal|casual|understated/.test(t)) { api.memory.setPreference('brand_voice', text, 'chat'); await reply(`Saved as your brand voice: “${esc(text)}”. It's injected into every creative prompt and enforced by the <span class="kbd">creative_uses_preference</span> check. <a href="#/memory">Manage memory</a>`, 600, 0); return; }
        }
        if (/^remember( that)?\s+/i.test(text) || /\bour (aov|budget|price|launch|customers?)\b/.test(t)) { const fact = text.replace(/^remember( that)?\s+/i, ''); api.memory.addFact(fact, 'chat', c ? c.id : null); await reply(`Remembered: “${esc(fact)}”. It'll be included in every prompt for your workspace. <a href="#/memory">See memory</a>`, 500, 0); return; }

        /* --- edit intents on a campaign --- */
        if (c && /\b(drop|remove|exclude)\b/.test(t)) {
          let target = c.publishers.find((p) => t.includes(PUBS[p.id].name.toLowerCase().split(' ')[0]));
          if (!target && /lowest|last|weakest/.test(t)) target = c.publishers[c.publishers.length - 1];
          if (target) { api.patch(c.id, { op: 'drop_publisher', publisher_id: target.id }); const cc = api.get(c.id); await reply(`Dropped <b>${esc(PUBS[target.id].name)}</b> and re-spread its budget across the remaining ${cc.publishers.length}: ${cc.config.alloc.map((a) => `${esc(PUBS[a.id].name)} ${a.pct}%`).join(', ')}.${summaryCard(cc)}`, 500, 0); return; }
          await reply(`Which publisher? Currently running: ${c.publishers.map((p) => esc(PUBS[p.id].name)).join(', ')}.`, 400); return;
        }
        if (c && /\b(punch|rewrite|regenerate|shorter|bolder|warmer|variant)\b/.test(t)) {
          const m = t.match(/variant\s+([a-e])/); const i = m ? m[1].charCodeAt(0) - 97 : 0; const p = c.personas[i];
          if (!p) { await reply(`There are only ${c.personas.length} variants (A–${String.fromCharCode(64 + c.personas.length)}).`, 400); return; }
          const res = await api.regenerate(c.id, p.id, text); const np = res.campaign.personas.find((x) => x.id === p.id);
          await reply(`Rewrote variant ${String.fromCharCode(65 + i)} for <b>${esc(PERS[p.id].name)}</b>:<div class="card minicard" style="margin-top:8px"><b>${esc(np.h)}</b><span>${esc(np.b)}</span></div><a class="btn sm" style="margin-top:8px" href="#/campaign/${c.id}/creatives">See all variants</a>`, 900, res.credits.charged); return;
        }
        if (c && /\b(budget|\$\d)/.test(t) && /\d/.test(t)) {
          const m = t.replace(/,/g, '').match(/\$?(\d+(?:\.\d+)?)\s*(k)?/);
          if (m) { let v = parseFloat(m[1]) * (m[2] ? 1000 : 1); if (v < 100) v *= 1000; api.patch(c.id, { op: 'set_budget', total: Math.round(v) }); const cc = api.get(c.id); await reply(`Total budget set to <b>${fmt$(cc.config.budget.total)}</b> (${fmt$(cc.config.budget.daily)}/day over the 30-day flight). Allocation percentages unchanged.${summaryCard(cc)}`, 500, 0); return; }
        }
        if (c && /\b(export|pdf|brief|download)\b/.test(t)) { await reply(`Brief rendered: <b>${esc(c.name.replace(/[^a-z0-9]+/gi, '-').toLowerCase())}-brief-v${c.version}.pdf</b>. <a class="btn sm" style="margin-top:8px" href="#/campaign/${c.id}/export">Preview & download</a>`, 500, 0); return; }
        if (c && /\b(why|explain|checks?)\b/.test(t)) { const p = c.publishers[0]; const v = api.validate(c); const failing = v.filter((x) => !x.passed); await reply(`<b>${esc(PUBS[p.id].name)}</b> ranks first at ${p.score}: ${esc(p.why)}<br><br>Breakdown — category ${p.bd.category}, persona ${p.bd.persona}, AOV ${p.bd.aov}, audience ${p.bd.audience}. Checks: ${v.length - failing.length}/${v.length} passing${failing.length ? ' — ' + esc(failing[0].message) : ''}. <a href="#/campaign/${c.id}/publishers">Full ranking</a>`, 500, 0); return; }
        if (/^(new|start over|reset)\b/.test(t)) { chat = { log: [], stage: 'start', answers: [], cid: null, tpl: null, text: '' }; state.chat = chat; store.set('chat', chat); location.hash = '#/chat'; views.chat(); return; }

        /* --- clarity gate conversation --- */
        if (chat.stage === 'asking') {
          chat.answers.push(text); const qs = TEMPLATES[chat.tpl].clarity.questions || TEMPLATES.wellness.clarity.questions;
          if (chat.answers.length < qs.length) { const q = qs[chat.answers.length]; await reply(`${esc(q.q)}<div class="opts">${q.opts.map((o) => `<button type="button" class="chip" data-ans="${esc(o)}">${esc(o)}</button>`).join('')}</div>`, 500); store.set('chat', chat); return; }
          chat.stage = 'generating'; return generate(true);
        }
        /* --- new brief --- */
        const cl = api.clarity(text); chat.text = text; chat.tpl = cl.tpl; chat.score = cl.score; chat.answers = [];
        if (cl.score < 60) { chat.stage = 'asking'; const q = cl.questions[0]; await reply(`That's a bit thin to match publishers on — clarity <b>${cl.score}/100</b>. Three quick questions (free).<br><br>${esc(q.q)}<div class="opts">${q.opts.map((o) => `<button type="button" class="chip" data-ans="${esc(o)}">${esc(o)}</button>`).join('')}</div>`, 600); store.set('chat', chat); return; }
        chat.stage = 'generating'; await reply(`Clear brief (clarity <b>${cl.score}</b>). ${esc(cl.summary)}<br><br>Scoring 20 publishers and writing creative — ~${api.credits.estimate('generate_campaign').total} credits.`, 500); await generate(false);
      } catch (e) {
        await reply(e.code === 402 ? `You have ${api.credits.balance()} credits — not enough for that. Free edits (drop, budget, export) still work. <a href="#/credits">See credits</a>` : 'Something went wrong on my side; nothing was charged.', 400);
      }
    }
    async function generate(vague) {
      const res = await api.generate({ text: chat.text, answers: chat.answers });
      const c = res.campaign; chat.cid = c.id; chat.stage = 'done'; store.set('chat', chat);
      await reply(`${vague ? 'Thanks — ' + esc(c.clarity.summary) + '<br><br>' : ''}Done. <b>${c.publishers.length} publishers</b> recommended (${c.excluded.length} excluded with reasons), <b>${c.personas.length} creatives</b>, and a config with a ${fmt$(c.config.budget.total)} budget on ${esc(c.config.bid.strategy.replace(/_/g, ' '))}. ${res.validation.filter((v) => v.passed).length}/11 checks pass.${summaryCard(c)}<p class="help" style="margin-top:8px">Tell me what to change — drop a publisher, rewrite a variant, adjust the budget, set a preference, or export.</p>`, 1100, res.credits.charged);
      setSuggestions();
    }
    $('#cf').onsubmit = (e) => { e.preventDefault(); send($('#ci').value); };
  };
})();
