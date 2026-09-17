/* Views: history, compare, memory, credits. */
(function () {
  const { api, ui, views } = window.DCS;
  const { I, $, $$, esc, fmt$ } = ui;
  const { PUBS, PERS } = window.DCS.data;

  /* ------------------------------------------------------------------ history */
  views.history = function () {
    const list = api.list(); let sel = [];
    const body = views.shell('history', 'History', `
      <div class="row between wrap"><div><h1>Campaign history</h1><p class="sub">Every run is saved and versioned. Select two to compare.</p></div><button class="btn primary" id="cmp" disabled>Compare selected ${I.arrow}</button></div>
      <div class="card tscroll"><table><thead><tr><th><span class="sr-only">Select</span></th><th>Campaign</th><th>Clarity</th><th>Top publisher</th><th>Budget</th><th>Checks</th><th>Status</th><th>Created</th><th><span class="sr-only">Actions</span></th></tr></thead><tbody>
        ${list.length ? list.map((c) => { const v = api.validate(c); const bad = v.filter((x) => !x.passed).length; return `<tr><td><label class="check"><input type="checkbox" data-sel="${c.id}" aria-label="Select ${esc(c.name)}"></label></td><td><a href="#/campaign/${c.id}" style="color:var(--ink);font-weight:600">${esc(c.name)}</a><div class="help" style="max-width:36ch;white-space:nowrap;overflow:hidden;text-overflow:ellipsis">${esc(c.input)}</div></td><td><span class="pill ${ui.scoreCls(c.clarity.score)}">${c.clarity.score}</span></td><td>${esc(PUBS[c.publishers[0].id].name)} <span class="help num">${c.publishers[0].score}</span></td><td class="num">${fmt$(c.config.budget.total)}</td><td><span class="pill ${bad ? 'warn' : 'good'}">${v.length - bad}/${v.length}</span></td><td><span class="pill ${c.status === 'ready' ? 'good' : ''}">${c.status === 'ready' ? 'Ready' : 'Draft'}</span></td><td class="help num">${ui.dateS(c.createdAt)} · v${c.version}</td><td><button class="btn ghost sm icon danger" data-del="${c.id}" aria-label="Delete ${esc(c.name)}">${I.trash}</button></td></tr>`; }).join('') : `<tr><td colspan="9"><div class="empty">${I.layers}<b>No campaigns yet</b><a href="#/new" class="btn primary sm" style="margin-top:6px">Build one</a></div></td></tr>`}
      </tbody></table></div>`);
    $$('[data-sel]', body).forEach((cb) => { cb.onchange = () => { sel = $$('[data-sel]:checked', body).map((x) => x.dataset.sel); if (sel.length > 2) { cb.checked = false; sel = sel.filter((s) => s !== cb.dataset.sel); ui.toast('Pick exactly two', 'info'); } $('#cmp').disabled = sel.length !== 2; }; });
    $('#cmp').onclick = () => { location.hash = `#/compare/${sel[0]}/${sel[1]}`; };
    $$('[data-del]', body).forEach((b) => { b.onclick = () => { const c = api.get(b.dataset.del); if (!confirm(`Delete “${c.name}”? This can't be undone.`)) return; api.remove(c.id); ui.toast('Campaign deleted'); views.history(); }; });
  };

  /* ------------------------------------------------------------------ compare */
  views.compare = function (a, b) {
    const A = api.get(a), B = api.get(b); if (!A || !B) { location.hash = '#/history'; return; }
    const ids = [...new Set([...A.publishers.map((p) => p.id), ...B.publishers.map((p) => p.id)])];
    const rows = ids.map((id) => { const pa = A.publishers.find((p) => p.id === id), pb = B.publishers.find((p) => p.id === id); let d; if (pa && pb) { const dd = pb.score - pa.score; d = dd === 0 ? `<span class="delta">=</span>` : `<span class="delta ${dd > 0 ? 'up' : 'dn'}">${dd > 0 ? '+' : ''}${dd}</span>`; } else d = `<span class="delta new">${pa ? 'only in A' : 'only in B'}</span>`; return `<tr><td><b>${esc(PUBS[id].name)}</b></td><td class="num">${pa ? pa.score : '—'}</td><td class="num">${pb ? pb.score : '—'}</td><td>${d}</td></tr>`; }).join('');
    const col = (c, l) => `<div class="card pad stack"><div class="row between"><span class="eyebrow">${l}</span><span class="pill ${ui.scoreCls(c.clarity.score)}">Clarity ${c.clarity.score}</span></div><h3><a href="#/campaign/${c.id}" style="color:var(--ink)">${esc(c.name)}</a></h3><p class="help">“${esc(c.input)}”</p><div class="divider"></div><div class="kv"><span class="k">Budget</span><span class="num">${fmt$(c.config.budget.total)}</span><span class="k">Bid</span><span>${esc(c.config.bid.strategy.replace(/_/g, ' '))}</span><span class="k">Lead persona</span><span>${esc(PERS[c.personas[0].id].name)}</span><span class="k">Lead headline</span><span>“${esc(c.personas[0].h)}”</span><span class="k">Credits spent</span><span class="num">${c.activity.reduce((s, x) => s + (x.credits || 0), 0)}</span></div></div>`;
    views.shell('history', `<a href="#/history">History</a><span>/</span>Compare`, `
      <div><h1>Compare runs</h1><p class="sub">Side-by-side publisher scores and headline decisions.</p></div>
      <div class="cmp">${col(A, 'A')}${col(B, 'B')}</div>
      <div class="card tscroll"><table><thead><tr><th>Publisher</th><th>A score</th><th>B score</th><th>Δ</th></tr></thead><tbody>${rows}</tbody></table></div>`);
  };

  /* ------------------------------------------------------------------ memory */
  views.memory = function () {
    const m = api.memory.get(); const prefs = m.preferences; const src = (k) => (m.sources && m.sources[k]) ? `${m.sources[k].source} · ${ui.dateS(m.sources[k].at)}` : 'manual';
    const body = views.shell('memory', 'Memory', `
      <div><h1>Memory</h1><p class="sub">What the system believes about your brand. Preferences are hard constraints in every prompt and check; facts are context. Everything here is visible and deletable.</p></div>
      <div class="grid g2">
        <div class="card pad stack">
          <div class="row between"><h3>Preferences</h3><span class="pill purple">${Object.keys(prefs).length} set</span></div>
          <div class="field"><label class="label" for="p_voice">Brand voice</label><textarea class="textarea" id="p_voice" style="min-height:72px" placeholder="e.g. Understated, no exclamation marks, never say 'game-changing'">${esc(prefs.brand_voice || '')}</textarea></div>
          <div class="field"><label class="label" for="p_ban">Banned publishers</label><select class="input" id="p_ban" multiple size="5">${Object.entries(PUBS).map(([id, P]) => `<option value="${id}" ${(prefs.banned_publishers || []).includes(id) ? 'selected' : ''}>${esc(P.name)} · ${esc(P.cat.replace(/_/g, ' '))}</option>`).join('')}</select><span class="help">Hold Ctrl/⌘ to select several. Enforced by the <span class="kbd">banned_publishers</span> check.</span></div>
          <div class="grid g2">
            <div class="field"><label class="label" for="p_daily">Default daily budget ($)</label><input class="input num" id="p_daily" type="number" value="${esc(prefs.default_daily_budget || '')}" placeholder="300"></div>
            <div class="field"><label class="label" for="p_bid">Default bid strategy</label><select class="input" id="p_bid"><option value="">Let the model decide</option>${['target_cpa', 'max_conversions_with_cpa_cap', 'manual_cpm', 'manual_cpc', 'max_clicks'].map((o) => `<option ${prefs.bid_strategy_default === o ? 'selected' : ''}>${o}</option>`).join('')}</select></div>
          </div>
          <div class="row between wrap"><span class="help">Sources: ${Object.keys(prefs).map((k) => `${k} (${src(k)})`).join(', ') || 'none yet'}</span><button class="btn primary" id="savePrefs">Save preferences</button></div>
        </div>
        <div class="card pad stack">
          <div class="row between"><h3>Facts</h3><span class="pill purple">${m.facts.length}</span></div>
          <div class="row"><label class="sr-only" for="factText">New fact</label><input class="input" id="factText" placeholder="e.g. Our AOV is $85 · We can't ship to Canada"><button class="btn" id="addFact">${I.plus} Add</button></div>
          <div>${m.facts.length ? m.facts.map((f) => `<div class="memrow"><div><div class="k">${esc(f.text)}</div><div class="s">${esc(f.source)} · ${ui.dateT(f.at)}${f.campaignId ? ' · campaign ' + esc(f.campaignId) : ''}</div></div><button class="btn ghost sm icon" data-rmfact="${f.id}" aria-label="Delete fact">${I.trash}</button></div>`).join('') : `<div class="empty">${I.brain}<b>No facts yet</b><span>Say "remember that…" in chat, or add one here.</span></div>`}</div>
          <div class="banner purple">${I.info}<span>Memory is rendered into a ≤600-token block at the top of every prompt: preferences as constraints first, then the 10 most recent facts.</span></div>
        </div>
      </div>`);
    $('#savePrefs').onclick = () => {
      const voice = $('#p_voice').value.trim(); voice ? api.memory.setPreference('brand_voice', voice, 'manual') : api.memory.removePreference('brand_voice');
      const banned = $$('#p_ban option:checked').map((o) => o.value); banned.length ? api.memory.setPreference('banned_publishers', banned, 'manual') : api.memory.removePreference('banned_publishers');
      const daily = +$('#p_daily').value; daily ? api.memory.setPreference('default_daily_budget', daily, 'manual') : api.memory.removePreference('default_daily_budget');
      const bid = $('#p_bid').value; bid ? api.memory.setPreference('bid_strategy_default', bid, 'manual') : api.memory.removePreference('bid_strategy_default');
      ui.toast('Preferences saved — applied to the next generation and to checks'); views.memory();
    };
    $('#addFact').onclick = () => { const t = $('#factText').value.trim(); if (!t) return; api.memory.addFact(t, 'manual'); ui.toast('Fact remembered'); views.memory(); };
    $$('[data-rmfact]', body).forEach((b) => { b.onclick = () => { api.memory.removeFact(b.dataset.rmfact); views.memory(); }; });
  };

  /* ------------------------------------------------------------------ credits */
  views.credits = function () {
    const rows = api.ledger(); const bal = api.credits.balance(); const spent = 100 - bal;
    const byDay = {}; rows.forEach((r) => { if (r.delta < 0) { const d = r.at.slice(0, 10); byDay[d] = (byDay[d] || 0) - r.delta; } });
    const days = [...Array(14)].map((_, i) => { const d = new Date(Date.now() - (13 - i) * 864e5).toISOString().slice(0, 10); return [d, byDay[d] || 0]; });
    const max = Math.max(1, ...days.map((d) => d[1]));
    const label = (r) => ({ signup_grant: 'Signup grant', generate_campaign: 'Campaign generation', regenerate_creative: 'Regenerate creative', feedback_repair: 'Fix from feedback', chat_llm_edit: 'Chat edit (model)' }[r.reason] || r.reason);
    views.shell('credits', 'Credits', `
      <div class="row between wrap"><div><h1>Credits</h1><p class="sub">Every model-touching action is charged from real token usage: a base fee per action plus 1 credit per 4k weighted tokens (gpt-4.1 counts 2×). Deterministic edits, exports and compare are free.</p></div><button class="btn primary" id="more">${I.coin} Get more credits</button></div>
      <div class="grid g4">
        <div class="card stat"><span class="eyebrow">Balance</span><span class="v num" style="color:var(--${ui.creditCls(bal) || 'ink'})">${bal}</span><span class="d">of 100 granted</span></div>
        <div class="card stat"><span class="eyebrow">Spent</span><span class="v num">${spent}</span><span class="d">${rows.filter((r) => r.delta < 0).length} charges</span></div>
        <div class="card stat"><span class="eyebrow">Avg per generation</span><span class="v num">${(() => { const g = rows.filter((r) => r.reason === 'generate_campaign'); return g.length ? Math.round(g.reduce((s, r) => s - r.delta, 0) / g.length) : '—'; })()}</span><span class="d">10 base + usage</span></div>
        <div class="card stat"><span class="eyebrow">Runway</span><span class="v num">~${Math.floor(bal / 12)}<small> generations</small></span><span class="d">at current usage</span></div>
      </div>
      <div class="card pad stack"><div class="row between"><h3>Last 14 days</h3><span class="help">credits per day</span></div><div class="spark" role="img" aria-label="Daily credit spend">${days.map(([d, v]) => `<i class="${v ? 'on' : ''}" style="height:${Math.max(4, (v / max) * 100)}%" title="${d}: ${v}"></i>`).join('')}</div></div>
      <div class="card tscroll ledger"><table><thead><tr><th>When</th><th>Action</th><th>Campaign</th><th>Base</th><th>Usage</th><th>Δ</th><th>Balance</th></tr></thead><tbody>
        ${rows.map((r) => { const c = r.campaign && api.get(r.campaign); return `<tr><td class="help num" style="white-space:nowrap">${ui.dateT(r.at)}</td><td><b>${label(r)}</b></td><td>${c ? `<a href="#/campaign/${c.id}">${esc(c.name)}</a>` : r.campaign ? `<span class="help">${esc(r.campaign)} (deleted)</span>` : '—'}</td><td class="num">${r.base || '—'}</td><td class="num help">${r.usage ? `${r.usage.tokens.toLocaleString()} tok · ${esc(r.usage.mix)}` : '—'}</td><td class="num ${r.delta < 0 ? 'neg' : 'pos'}">${r.delta > 0 ? '+' : ''}${r.delta}</td><td class="num">${r.balanceAfter}</td></tr>`; }).join('')}
      </tbody></table></div>`);
    $('#more').onclick = () => ui.toast('Top-ups are not enabled in the beta — email hello@disconetwork.com and we\'ll grant more.', 'info');
  };
})();
