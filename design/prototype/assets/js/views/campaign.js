/* View: campaign detail — Overview · Publishers · Creatives · Config · Checks · Export.
   Every mutation goes through api.patch/regenerate/feedback and re-renders the active tab from
   the returned {campaign, validation, credits} so the UI never drifts from the "server". */
(function () {
  const { api, ui, views, store } = window.DCS;
  const { I, $, $$, esc, svg, fmt$, fmtImp } = ui;
  const { PUBS, PERS } = window.DCS.data;

  const TABS = [['overview', 'Overview'], ['publishers', 'Publishers'], ['creatives', 'Creatives'], ['config', 'Config'], ['checks', 'Checks'], ['export', 'Export']];

  /* Shared: feedback buttons for a target. */
  function fbButtons(c, kind, id) {
    const f = c.feedback[kind + ':' + id] || {};
    return `<span class="fb" data-fb="${kind}:${id}"><button type="button" class="${f.vote === 'up' ? 'on-up' : ''}" data-vote="up" aria-label="Good ${kind}" title="Good">${I.up}</button><button type="button" class="${f.vote === 'down' ? 'on-down' : ''}" data-vote="down" aria-label="Needs work — leave a note" title="Needs work">${I.down}</button></span>`;
  }
  function bindFeedback(c, root, rerender) {
    $$('[data-fb]', root).forEach((wrap) => {
      const [kind, id] = wrap.dataset.fb.split(':');
      $$('button', wrap).forEach((btn) => {
        btn.onclick = async () => {
          const vote = btn.dataset.vote;
          if (vote === 'up') { await api.feedback(c.id, { kind, id }, 'up'); ui.toast('Thanks — noted as a good example.'); rerender(); return; }
          const est = api.credits.estimate('feedback_repair');
          ui.popover(btn, {
            title: 'What should change?', placeholder: kind === 'creative' ? 'e.g. too clinical, make it warmer' : 'e.g. audience skews too young for us',
            submitLabel: 'Send & fix', cost: `Fix with AI · ~${est.total} credits · ${est.balance} left`,
            onSubmit: async (comment) => {
              if (!comment) { await api.feedback(c.id, { kind, id }, 'down'); ui.toast('Noted. Add a comment next time and I can fix it.'); rerender(); return; }
              const card = wrap.closest('.creative, .pubcard'); if (card) card.classList.add('dim');
              try { const res = await api.feedback(c.id, { kind, id }, 'down', comment); views.refreshCredits(); ui.toast(`Repaired from your note · ${res.credits.charged} credits`); }
              catch (e) { ui.toast(e.code === 402 ? 'Not enough credits for an AI fix — note saved.' : 'Repair failed; nothing charged.', 'warn'); }
              rerender();
            },
          });
        };
      });
    });
  }

  views.campaign = function (id, tab = 'overview') {
    const c = api.get(id); if (!c) { location.hash = '#/history'; return; }
    const validation = api.validate(c); const errors = validation.filter((v) => !v.passed && v.severity === 'error').length; const warns = validation.filter((v) => !v.passed && v.severity === 'warning').length;
    views.shell('history', `<a href="#/history">History</a><span>/</span>${esc(c.name)}`, `
      <div class="row between wrap">
        <div class="grow">
          <div class="row wrap" style="margin-bottom:6px"><span class="pill ${ui.scoreCls(c.clarity.score)}">Clarity ${c.clarity.score}</span><span class="pill ${c.status === 'ready' ? 'good' : ''}">${c.status === 'ready' ? 'Ready to launch' : 'Draft'}</span>${errors ? `<span class="pill bad">${errors} check${errors > 1 ? 's' : ''} failing</span>` : warns ? `<span class="pill warn">${warns} warning${warns > 1 ? 's' : ''}</span>` : `<span class="pill good">${I.shield} All checks pass</span>`}<span class="help num">v${c.version} · ${ui.dateS(c.createdAt)}</span></div>
          <h1>${esc(c.name)}</h1>
          <p class="sub">“${esc(c.input)}”</p>
        </div>
        <div class="row wrap">
          <a class="btn" href="#/chat?c=${c.id}">${I.chat} Chat about this</a>
          <button class="btn" id="rerun">${I.refresh} Re-run</button>
          <button class="btn primary" id="ready" ${errors && c.status !== 'ready' ? 'disabled title="Fix failing checks first"' : ''}>${c.status === 'ready' ? I.check + ' Ready' : 'Mark ready'}</button>
        </div>
      </div>
      <div class="tabs" role="tablist">${TABS.map(([k, l]) => `<a class="tab ${tab === k ? 'on' : ''}" role="tab" aria-selected="${tab === k}" href="#/campaign/${c.id}/${k}">${l}${k === 'checks' && (errors || warns) ? `<span class="pill ${errors ? 'bad' : 'warn'}" style="height:18px;padding:0 6px;font-size:10.5px">${errors || warns}</span>` : ''}</a>`).join('')}</div>
      <div id="tabBody"></div>`);
    $('#ready').onclick = () => { api.patch(id, { op: 'set_status', status: c.status === 'ready' ? 'draft' : 'ready' }); ui.toast(c.status === 'ready' ? 'Back to draft' : 'Marked ready to launch'); views.campaign(id, tab); };
    $('#rerun').onclick = () => { store.set('draft', c.input); location.hash = '#/new'; };
    const el = $('#tabBody');
    const rerender = () => views.campaign(id, tab);
    ({ overview: tOverview, publishers: tPublishers, creatives: tCreatives, config: tConfig, checks: tChecks, export: tExport })[tab](c, el, validation, rerender);
  };

  /* ------------------------------------------------------------------ overview */
  function tOverview(c, el, validation, rerender) {
    const top = c.publishers[0]; const tp = c.personas[0];
    const failing = validation.filter((v) => !v.passed);
    el.innerHTML = `<div class="stack lg">
      <div class="sumstrip">
        <div class="card stat"><span class="eyebrow">Publishers</span><span class="v num">${c.publishers.length}<small> recommended</small></span><span class="d">${c.excluded.length} excluded with reasons</span></div>
        <div class="card stat"><span class="eyebrow">Top match</span><span class="v">${esc(PUBS[top.id].name)}</span><span class="d">Score ${top.score} · ${fmtImp(PUBS[top.id].imp)} monthly impressions</span></div>
        <div class="card stat"><span class="eyebrow">Creatives</span><span class="v num">${c.personas.length}</span><span class="d">Lead: ${esc(PERS[tp.id].name.replace('The ', ''))}</span></div>
        <div class="card stat"><span class="eyebrow">Budget</span><span class="v num">${fmt$(c.config.budget.total)}</span><span class="d">${fmt$(c.config.budget.daily)}/day · ${c.config.bid.strategy.replace(/_/g, ' ')}</span></div>
      </div>
      ${failing.length ? `<div class="banner ${failing.some((f) => f.severity === 'error') ? 'bad' : 'warn'}">${I.warn}<span><b>${failing.length} check${failing.length > 1 ? 's' : ''} need attention.</b> ${esc(failing[0].message)} <a href="#/campaign/${c.id}/checks">See all checks</a></span></div>` : ''}
      <div class="card pad stack">
        <div class="row between wrap"><h3>How we read the brief</h3><div class="row"><span class="pill ${ui.scoreCls(c.clarity.score)}">${c.clarity.label}</span>${fbButtons(c, 'clarity', 'summary')}</div></div>
        <p>${esc(c.clarity.summary)}</p>
        ${c.clarity.answers ? `<div class="row wrap" style="gap:6px"><span class="eyebrow">Your answers</span>${c.clarity.answers.map((a) => `<span class="pill">${esc(a)}</span>`).join('')}</div>` : ''}
        <div class="row wrap" style="gap:6px">${c.clarity.signals.map((s) => `<span class="pill ${c.clarity.score < 60 ? 'bad' : 'good'}">${esc(s)}</span>`).join('')}</div>
      </div>
      <div class="grid g2">
        <div class="card pad stack">
          <div class="row between"><h3>Publisher ranking</h3><a class="help" href="#/campaign/${c.id}/publishers">Details</a></div>
          ${c.publishers.map((p, i) => `<div style="display:grid;grid-template-columns:22px 1fr 44px;gap:10px;align-items:center"><span class="num help">${i + 1}</span><div><div class="row between"><b>${esc(PUBS[p.id].name)}</b><span class="help">${fmtImp(PUBS[p.id].imp)} imp · AOV ${fmt$(PUBS[p.id].aov)}</span></div><div class="bar ${ui.scoreCls(p.score)}" style="margin-top:4px"><i style="width:${p.score}%"></i></div></div><b class="num" style="text-align:right">${p.score}</b></div>`).join('')}
        </div>
        <div class="card pad stack">
          <div class="row between"><h3>Budget split</h3><a class="help" href="#/campaign/${c.id}/config">Edit</a></div>
          ${donut(c)}
        </div>
      </div>
      <div class="grid g2">
        <div class="card pad">
          <div class="row between" style="margin-bottom:12px"><h3>Lead creative</h3><a class="help" href="#/campaign/${c.id}/creatives">All ${c.personas.length} variants</a></div>
          <div class="creative" style="padding:0"><div class="ph"><div class="n">${I.users}${esc(PERS[tp.id].name)}<span class="pill good">Fit ${tp.fit}</span></div>${fbButtons(c, 'creative', tp.id)}</div><div class="ad"><span class="tag">Preview</span><h4>${esc(tp.h)}</h4><p>${esc(tp.b)}</p><span class="cta">${esc(tp.cta)}</span></div><p class="why"><b>Why this persona:</b> ${esc(tp.why)}</p></div>
        </div>
        <div class="card pad">
          <div class="row between" style="margin-bottom:8px"><h3>Activity</h3><span class="help">${c.activity.reduce((s, a) => s + (a.credits || 0), 0)} credits on this campaign</span></div>
          <div class="timeline">${[...c.activity].reverse().slice(0, 6).map((a) => `<div class="tl"><i class="${a.kind}"></i><div>${esc(a.text)}<div class="d">${ui.dateT(a.at)}</div></div><span class="help num">${a.credits ? a.credits + ' cr' : 'free'}</span></div>`).join('')}</div>
        </div>
      </div>
    </div>`;
    bindFeedback(c, el, rerender);
  }

  function donut(c) {
    const cols = ['#7C3AED', '#3B82F6', '#A78BFA', '#60A5FA', '#C4B5FD', '#93C5FD'];
    let acc = 0; const R = 60, r = 40, cx = 75, cy = 75;
    const segs = c.config.alloc.map((a, i) => { const s = (acc / 100) * 2 * Math.PI; acc += a.pct; const e = (acc / 100) * 2 * Math.PI; const p = (t, rad) => [cx + rad * Math.cos(t - Math.PI / 2), cy + rad * Math.sin(t - Math.PI / 2)]; const [x1, y1] = p(s, R), [x2, y2] = p(e, R), [x3, y3] = p(e, r), [x4, y4] = p(s, r); const big = e - s > Math.PI ? 1 : 0; return `<path d="M${x1} ${y1}A${R} ${R} 0 ${big} 1 ${x2} ${y2}L${x3} ${y3}A${r} ${r} 0 ${big} 0 ${x4} ${y4}Z" fill="${cols[i % cols.length]}"><title>${esc(PUBS[a.id].name)} ${a.pct}%</title></path>`; }).join('');
    return `<div class="donut"><svg viewBox="0 0 150 150" role="img" aria-label="Budget split">${segs}<text x="75" y="71" text-anchor="middle" font-size="18" font-weight="700" fill="var(--ink)">${fmt$(c.config.budget.total)}</text><text x="75" y="88" text-anchor="middle" font-size="11" fill="var(--muted)">total budget</text></svg><div class="legend">${c.config.alloc.map((a, i) => `<div><i style="background:${cols[i % cols.length]}"></i>${esc(PUBS[a.id].name)} <b class="num">${a.pct}%</b> <span class="help num">· ${fmt$(Math.round((c.config.budget.total * a.pct) / 100))}</span></div>`).join('')}</div></div>`;
  }

  /* ------------------------------------------------------------------ publishers */
  function tPublishers(c, el, validation, rerender) {
    el.innerHTML = `<div class="stack lg">
      <div class="row between wrap"><div><h3>Recommended (${c.publishers.length})</h3><p class="help">Score = weighted blend of category fit, persona overlap, AOV fit and audience match; the reason is written by the model against the publisher's notes.</p></div><div class="row wrap"><span class="pill">Category 35%</span><span class="pill">Persona 30%</span><span class="pill">AOV 15%</span><span class="pill">Audience 20%</span></div></div>
      ${c.publishers.map((p, i) => { const P = PUBS[p.id]; return `<div class="card pubcard">
        <div class="rank ${i === 0 ? 'top' : ''}">${i + 1}</div>
        <div><h3>${esc(P.name)}<span class="pill">${esc(P.cat.replace(/_/g, ' '))}</span></h3>
          <div class="meta"><span>${fmtImp(P.imp)} imp/mo</span><span>AOV ${fmt$(P.aov)}</span><span>${P.age}</span><span>${Math.round(P.f * 100)}% F</span><span>${esc(P.inc)} income</span><span>${esc(P.geo)}</span></div>
          <p class="why">${esc(p.why)}</p>
          <p class="help" style="margin-top:6px"><b>Catalog note:</b> ${esc(P.notes)}</p></div>
        <div class="score"><b class="num" style="color:var(--${ui.scoreCls(p.score)})">${p.score}</b><small>fit score</small>${fbButtons(c, 'publisher', p.id)}<button class="btn ghost sm danger" data-drop="${p.id}">${I.x} Drop</button></div>
        <div class="bd">${Object.entries(p.bd).map(([k, v]) => `<div class="b"><div class="l"><span>${k[0].toUpperCase() + k.slice(1)}</span><b class="num">${v}</b></div><div class="bar ${ui.scoreCls(v)}"><i style="width:${v}%"></i></div></div>`).join('')}</div>
      </div>`; }).join('')}
      <div class="card pad">
        <h3>Excluded, and why</h3>
        <p class="help" style="margin-bottom:8px">Everything else in the catalog scored below 40. Showing the most instructive exclusions.</p>
        ${c.excluded.map((e) => { const P = PUBS[e.id]; return `<div class="excl"><div class="n">${esc(P.name)}<small>${esc(P.cat.replace(/_/g, ' '))} · ${P.age} · AOV ${fmt$(P.aov)}</small></div><div>${esc(e.why)}</div></div>`; }).join('')}
      </div>
    </div>`;
    $$('[data-drop]', el).forEach((b) => { b.onclick = () => { api.patch(c.id, { op: 'drop_publisher', publisher_id: b.dataset.drop }); ui.toast(`Dropped ${PUBS[b.dataset.drop].name}; budget re-spread · free`); rerender(); }; });
    bindFeedback(c, el, rerender);
  }

  /* ------------------------------------------------------------------ creatives */
  function tCreatives(c, el, validation, rerender) {
    const est = api.credits.estimate('regenerate_creative');
    const used = new Set(c.personas.map((p) => p.id)); const nextPersona = Object.keys(PERS).find((k) => !used.has(k));
    const problems = validation.filter((v) => !v.passed && v.repair_tool === 'regenerate_creative');
    el.innerHTML = `<div class="stack lg">
      <div class="row between wrap"><div><h3>${c.personas.length} variants, one per persona</h3><p class="help">Each is written against the persona's messaging preferences and away from their disinterests. Edit inline (free) or regenerate (~${est.total} credits).</p></div><button class="btn" id="addVar" ${nextPersona ? '' : 'disabled'}>${I.plus} Add a persona</button></div>
      ${problems.length ? `<div class="banner warn">${I.warn}<span>${problems.map((p) => esc(p.message)).join(' ')}</span></div>` : ''}
      <div class="grid g2" id="cgrid">${c.personas.map((p, i) => creativeCard(c, p, i)).join('')}</div>
      <div class="card pad"><h3>Personas we skipped</h3>${c.skipped.map((s) => `<div class="excl"><div class="n">${esc(PERS[s.id].name)}<small>${PERS[s.id].age} · price sensitivity ${PERS[s.id].price}</small></div><div>${esc(s.why)}</div></div>`).join('')}</div>
    </div>`;
    $('#addVar').onclick = () => { api.patch(c.id, { op: 'add_persona', persona_id: nextPersona }); ui.toast(`Added ${PERS[nextPersona].name} · free (no model call)`); rerender(); };
    $$('[data-regen]', el).forEach((b) => { b.onclick = async () => { const pid = b.dataset.regen; el.querySelector(`[data-ci="${pid}"]`).classList.add('dim'); try { const res = await api.regenerate(c.id, pid); views.refreshCredits(); ui.toast(`Variant regenerated · ${res.credits.charged} credits`); } catch (e) { ui.toast(e.code === 402 ? 'Not enough credits to regenerate.' : 'Regeneration failed; nothing charged.', 'warn'); } rerender(); }; });
    $$('[data-edit]', el).forEach((b) => { b.onclick = () => editCreative(c, b.dataset.edit, el, rerender); });
    $$('[data-undo]', el).forEach((b) => { b.onclick = () => { api.patch(c.id, { op: 'restore_version' }); ui.toast('Restored previous version'); rerender(); }; });
    bindFeedback(c, el, rerender);
  }
  function creativeCard(c, p, i) {
    const P = PERS[p.id]; const canUndo = c.history.length > 0 && /creative/i.test(c.activity[c.activity.length - 1].text);
    return `<div class="card creative" data-ci="${p.id}">
      <div class="ph"><div class="n">${I.users}${esc(P.name)}<span class="pill ${ui.scoreCls(p.fit)}">Fit ${p.fit}</span></div><div class="row" style="gap:4px">${fbButtons(c, 'creative', p.id)}<button class="btn ghost sm icon" data-edit="${p.id}" title="Edit" aria-label="Edit creative">${I.edit}</button><button class="btn ghost sm icon" data-regen="${p.id}" title="Regenerate (~${api.credits.estimate('regenerate_creative').total} credits)" aria-label="Regenerate creative">${I.refresh}</button>${canUndo && i === c.personas.length - 1 ? '' : ''}</div></div>
      <div class="ad"><span class="tag">Variant ${String.fromCharCode(65 + i)}</span><h4>${esc(p.h)}</h4><p>${esc(p.b)}</p><span class="cta">${esc(p.cta)}</span></div>
      <p class="why"><b>Why this persona:</b> ${esc(p.why)}</p>
      <div class="row wrap" style="gap:6px"><span class="eyebrow">Speaks to</span>${P.likes.slice(0, 3).map((l) => `<span class="pill purple">${esc(l)}</span>`).join('')}</div>
      <div class="row wrap" style="gap:6px"><span class="eyebrow">Avoids</span>${P.dis.slice(0, 2).map((l) => `<span class="pill">${esc(l)}</span>`).join('')}</div>
    </div>`;
  }
  function editCreative(c, pid, el, rerender) {
    const p = c.personas.find((x) => x.id === pid); const ad = el.querySelector(`[data-ci="${pid}"] .ad`);
    ad.innerHTML = `<div class="edit"><label class="sr-only" for="eh">Headline</label><input id="eh" value="${esc(p.h)}" maxlength="80"><label class="sr-only" for="eb">Body</label><textarea id="eb" rows="3">${esc(p.b)}</textarea><label class="sr-only" for="ec">Call to action</label><input id="ec" value="${esc(p.cta)}" maxlength="24" style="max-width:200px"><div class="row wrap"><button class="btn primary sm" id="sv">Save · free</button><button class="btn sm" id="cx">Cancel</button><span class="help num" id="cnt">${p.h.length}/80 · ${p.b.length}/240</span></div></div>`;
    const cnt = () => { $('#cnt', ad).textContent = `${$('#eh', ad).value.length}/80 · ${$('#eb', ad).value.length}/240`; };
    $('#eh', ad).oninput = cnt; $('#eb', ad).oninput = cnt;
    $('#sv', ad).onclick = () => { api.patch(c.id, { op: 'update_creative', persona_id: pid, h: $('#eh', ad).value.trim() || p.h, b: $('#eb', ad).value.trim() || p.b, cta: $('#ec', ad).value.trim() || p.cta }); ui.toast('Creative saved'); rerender(); };
    $('#cx', ad).onclick = rerender;
  }

  /* ------------------------------------------------------------------ config */
  function tConfig(c, el, validation, rerender) {
    const k = c.config;
    el.innerHTML = `<div class="stack lg">
      <div class="row between wrap"><div><h3>Campaign config</h3><p class="help">Everything a downstream ad server needs. Fields are editable; the JSON updates live and is what <span class="kbd">PATCH /api/campaigns/:id</span> stores. Saving is free.</p></div><div class="row"><button class="btn" id="copyJson">${I.copy} Copy JSON</button><button class="btn primary" id="saveCfg">Save changes</button></div></div>
      <div class="cfg">
        <div class="stack lg">
          <div class="card pad stack"><span class="eyebrow">Objective & bidding</span>
            <div class="kv">
              <label class="k" for="f_obj">Objective</label><span class="v"><select id="f_obj">${['purchase', 'subscription_signup', 'trial_start', 'lead', 'traffic'].map((o) => `<option ${k.objective === o ? 'selected' : ''}>${o}</option>`).join('')}</select></span>
              <label class="k" for="f_kpi">Primary KPI</label><span class="v full"><input id="f_kpi" value="${esc(k.kpi)}"></span>
              <label class="k" for="f_bid">Bid strategy</label><span class="v"><select id="f_bid">${['target_cpa', 'max_conversions_with_cpa_cap', 'manual_cpm', 'manual_cpc', 'max_clicks'].map((o) => `<option ${k.bid.strategy === o ? 'selected' : ''}>${o}</option>`).join('')}</select></span>
              <label class="k" for="f_cpm">CPM range</label><span class="v"><input id="f_cpm" value="${esc(k.bid.cpm)}"></span>
              <label class="k" for="f_cpc">CPC range</label><span class="v"><input id="f_cpc" value="${esc(k.bid.cpc)}"></span>
            </div>
            <p class="help"><b>Why:</b> ${esc(k.bid.note)}</p>
            <div class="row between"><span class="help">Was this bidding rationale useful?</span>${fbButtons(c, 'config', 'bid')}</div>
          </div>
          <div class="card pad stack"><span class="eyebrow">Budget & flight</span>
            <div class="kv">
              <label class="k" for="f_daily">Daily budget</label><span class="v"><input id="f_daily" type="number" value="${k.budget.daily}" class="num"></span>
              <label class="k" for="f_total">Total budget</label><span class="v"><input id="f_total" type="number" value="${k.budget.total}" class="num"></span>
              <span class="k">Flight</span><span class="v row wrap"><label class="sr-only" for="f_start">Start</label><input id="f_start" type="date" value="${k.flight.start}"><span class="help">to</span><label class="sr-only" for="f_end">End</label><input id="f_end" type="date" value="${k.flight.end}"></span>
            </div>
          </div>
          <div class="card pad stack"><span class="eyebrow">Targeting</span>
            <div class="kv">
              <label class="k" for="f_age">Age</label><span class="v"><input id="f_age" value="${esc(k.targeting.age)}"></span>
              <label class="k" for="f_gender">Gender</label><span class="v"><input id="f_gender" value="${esc(k.targeting.gender)}"></span>
              <label class="k" for="f_inc">Income tiers</label><span class="v"><input id="f_inc" value="${esc(k.targeting.income)}"></span>
              <span class="k">Geos</span><span class="v row wrap" style="gap:6px">${k.targeting.geos.map((g) => `<span class="pill blue">${esc(g)}</span>`).join('')}</span>
              <span class="k">Interests</span><span class="v row wrap" style="gap:6px">${k.targeting.interests.map((g) => `<span class="pill purple">${esc(g)}</span>`).join('')}</span>
              <span class="k">Exclude</span><span class="v row wrap" style="gap:6px">${k.targeting.exclude.map((g) => `<span class="pill bad">${esc(g)}</span>`).join('')}</span>
            </div>
          </div>
          <div class="card pad stack"><div class="row between"><span class="eyebrow">Publisher allocation</span><span class="help num" id="allocSum">100%</span></div>
            <div class="alloc">${k.alloc.map((a, i) => `<div class="a"><label for="ar${i}"><b>${esc(PUBS[a.id].name)}</b></label><input id="ar${i}" type="range" min="0" max="100" value="${a.pct}" data-ai="${i}"><span class="num" id="ap${i}">${a.pct}%</span><span class="help num" id="ad${i}">${fmt$(Math.round((k.budget.total * a.pct) / 100))}</span></div>`).join('')}</div>
            <p class="help">Split follows fit score × reach, then capped so no single publisher exceeds 45% — a new campaign needs signal from more than one placement.</p>
          </div>
        </div>
        <div class="card pad stack json-card"><div class="row between"><span class="eyebrow">campaign_config.json</span><span class="pill">schema v1</span></div><pre class="code mono" id="json"></pre></div>
      </div>
    </div>`;
    const alloc = k.alloc.map((a) => ({ ...a }));
    const read = () => ({ campaign_id: c.id, name: c.name, version: c.version, objective: $('#f_obj').value, primary_kpi: $('#f_kpi').value, bid: { strategy: $('#f_bid').value, cpm_range_usd: $('#f_cpm').value, cpc_range_usd: $('#f_cpc').value }, budget: { daily_usd: +$('#f_daily').value, total_usd: +$('#f_total').value, currency: 'USD', pacing: 'even' }, flight: { start: $('#f_start').value, end: $('#f_end').value }, targeting: { age_range: $('#f_age').value, gender: $('#f_gender').value, income_tiers: $('#f_inc').value.split(',').map((s) => s.trim()), geos: k.targeting.geos, interests: k.targeting.interests, exclude_contexts: k.targeting.exclude, personas: c.personas.map((p) => p.id) }, placements: alloc.map((a) => ({ publisher_id: a.id, allocation_pct: a.pct, budget_usd: Math.round((+$('#f_total').value * a.pct) / 100), creative_ids: c.personas.map((p, i) => `${c.id}_cr_${String.fromCharCode(65 + i)}`) })), creatives: c.personas.map((p, i) => ({ id: `${c.id}_cr_${String.fromCharCode(65 + i)}`, persona_id: p.id, headline: p.h, body: p.b, cta: p.cta })), frequency_cap: { impressions: 3, per: 'day' }, attribution: { window_days: 7, model: 'last_touch' } });
    const paint = () => { $('#json').textContent = JSON.stringify(read(), null, 2); };
    $$('input,select', el).forEach((i) => i.addEventListener('input', paint));
    $$('[data-ai]', el).forEach((r) => { r.oninput = () => { const i = +r.dataset.ai; alloc[i].pct = +r.value; const sum = alloc.reduce((s, a) => s + a.pct, 0); $('#allocSum').textContent = sum + '%'; $('#allocSum').style.color = sum === 100 ? 'var(--good)' : 'var(--bad)'; $('#ap' + i).textContent = r.value + '%'; $('#ad' + i).textContent = fmt$(Math.round((+$('#f_total').value * r.value) / 100)); paint(); }; });
    $('#copyJson').onclick = async () => { try { await navigator.clipboard.writeText($('#json').textContent); ui.toast('Config JSON copied'); } catch (e) { ui.toast('Copy blocked by browser — select the JSON to copy', 'info'); } };
    $('#saveCfg').onclick = () => {
      const sum = alloc.reduce((s, a) => s + a.pct, 0); if (sum !== 100) { ui.toast(`Allocation must total 100% (currently ${sum}%)`, 'warn'); return; }
      const r = read();
      api.patch(c.id, { op: 'set_config', config: { objective: r.objective, kpi: r.primary_kpi, bid: { ...k.bid, strategy: r.bid.strategy, cpm: r.bid.cpm_range_usd, cpc: r.bid.cpc_range_usd }, budget: { ...k.budget, daily: r.budget.daily_usd, total: r.budget.total_usd }, flight: r.flight, targeting: { ...k.targeting, age: r.targeting.age_range, gender: r.targeting.gender, income: r.targeting.income_tiers.join(', ') }, alloc } });
      ui.toast('Config saved · free'); rerender();
    };
    bindFeedback(c, el, rerender);
    paint();
  }

  /* ------------------------------------------------------------------ checks */
  function tChecks(c, el, validation, rerender) {
    const order = { error: 0, warning: 1 };
    const rows = [...validation].sort((a, b) => (a.passed - b.passed) || (order[a.severity] - order[b.severity]));
    const est = api.credits.estimate('feedback_repair');
    el.innerHTML = `<div class="stack lg">
      <div class="row between wrap"><div><h3>Checks</h3><p class="help">Deterministic validators run after every change (mirrors <span class="kbd">agent/validators/*</span>). Failing checks name the tool that can fix them; "Fix with AI" re-runs only that tool.</p></div><span class="pill ${rows.some((r) => !r.passed && r.severity === 'error') ? 'bad' : rows.some((r) => !r.passed) ? 'warn' : 'good'}">${rows.filter((r) => r.passed).length}/${rows.length} passing</span></div>
      <div class="checks">${rows.map((r) => `<div class="checkrow ${r.passed ? 'pass' : r.severity}">${r.passed ? I.check : r.severity === 'error' ? I.x : I.warn}<div><div><b>${esc(r.message === 'OK' ? describeCheck(r.check) : r.message)}</b></div><div class="id">${r.check} · ${r.severity} · repair: ${r.repair_tool}</div></div>${r.passed ? '' : `<button class="btn sm ${r.severity === 'error' ? 'primary' : ''}" data-fix="${r.check}">${I.spark} Fix with AI <span class="cost">· ~${est.total}</span></button>`}</div>`).join('')}</div>
    </div>`;
    $$('[data-fix]', el).forEach((b) => { b.onclick = async () => { const r = validation.find((v) => v.check === b.dataset.fix); b.disabled = true; b.textContent = 'Fixing…'; try { if (r.repair_tool === 'regenerate_creative') { const bad = c.personas.find((p) => p.h.length > 80 || p.b.length > 240 || /!/.test(p.h + p.b)) || c.personas[0]; await api.regenerate(c.id, bad.id, r.message); } else if (r.repair_tool === 'build_config') { const alloc = c.config.alloc.filter((a) => c.publishers.some((p) => p.id === a.id)); const tot = alloc.reduce((s, a) => s + a.pct, 0) || 1; alloc.forEach((a) => { a.pct = Math.round((a.pct / tot) * 100); }); alloc[0].pct += 100 - alloc.reduce((s, a) => s + a.pct, 0); api.patch(c.id, { op: 'set_config', config: { alloc } }); } else if (r.repair_tool === 'set_budget') { api.patch(c.id, { op: 'set_budget', total: c.config.budget.daily * 30 }); } else if (r.repair_tool === 'drop_publisher') { const banned = api.memory.get().preferences.banned_publishers || []; const hit = c.publishers.find((p) => banned.includes(p.id)); if (hit) api.patch(c.id, { op: 'drop_publisher', publisher_id: hit.id, reason: 'On your banned publishers list.' }); } else { ui.toast('This check is informational in the prototype.', 'info'); } views.refreshCredits(); ui.toast('Check repaired'); } catch (e) { ui.toast(e.code === 402 ? 'Not enough credits.' : 'Repair failed; nothing charged.', 'warn'); } rerender(); }; });
  }
  function describeCheck(id) {
    return { alloc_sums_100: 'Allocation totals 100%', alloc_cap_45: 'No publisher over the 45% cap', no_excluded_in_alloc: 'Budget only on recommended publishers', min_publishers: 'At least 3 publishers recommended', reason_present: 'Every publisher has a written reason', creative_lengths: 'Headline ≤ 80, body 60–240, CTA ≤ 24 characters', creative_avoids_disinterest: 'Creatives avoid each persona\'s disinterests', creative_uses_preference: 'Creatives follow your brand-voice preference', persona_fit_floor: 'Every persona fit ≥ 40', budget_sanity: 'Daily × flight days ≈ total budget', banned_publishers: 'No banned publishers recommended' }[id] || id;
  }

  /* ------------------------------------------------------------------ export */
  function tExport(c, el) {
    const me = api.me();
    el.innerHTML = `<div class="stack lg">
      <div class="row between wrap"><div><h3>Export</h3><p class="help">A one-page campaign brief for stakeholders, or the raw config for an ad server. Exports are free.</p></div><div class="row wrap"><button class="btn" id="expJson">${I.copy} Copy JSON</button><button class="btn primary" id="expPdf">${I.dl} Download PDF</button></div></div>
      <div class="tscroll"><div class="brief" id="brief">
        <div class="top"><div><div style="font-size:10.5px;letter-spacing:.1em;text-transform:uppercase;color:#6b7280">Campaign brief · Disco Campaign Studio</div><h2>${esc(c.name)}</h2><div style="color:#4b5563;margin-top:4px">“${esc(c.input)}”</div></div><div style="text-align:right;font-size:11px;color:#6b7280;white-space:nowrap">${esc(me.user.name)}<br>${new Date().toLocaleDateString()}<br>v${c.version}</div></div>
        <h3>Interpretation</h3><p>${esc(c.clarity.summary)}</p>
        <h3>Recommended publishers</h3>
        <table><thead><tr><th>#</th><th>Publisher</th><th>Score</th><th>Budget</th><th>Why</th></tr></thead><tbody>${c.publishers.map((p, i) => { const a = c.config.alloc.find((x) => x.id === p.id); return `<tr><td>${i + 1}</td><td><b>${esc(PUBS[p.id].name)}</b></td><td class="num">${p.score}</td><td class="num">${a ? a.pct + '%' : '—'}</td><td>${esc(p.why)}</td></tr>`; }).join('')}</tbody></table>
        <h3>Creative variants</h3>
        ${c.personas.map((p, i) => `<div class="bx"><b>${String.fromCharCode(65 + i)} · ${esc(PERS[p.id].name)} (fit ${p.fit})</b><span style="font-weight:600">${esc(p.h)}</span> — ${esc(p.b)}</div>`).join('')}
        <h3>Config</h3>
        <table><tbody><tr><td>Objective</td><td>${esc(c.config.objective)} · ${esc(c.config.kpi)}</td></tr><tr><td>Bid</td><td>${esc(c.config.bid.strategy)} · CPM ${esc(c.config.bid.cpm)} · CPC ${esc(c.config.bid.cpc)}</td></tr><tr><td>Budget</td><td>${fmt$(c.config.budget.total)} total · ${fmt$(c.config.budget.daily)}/day · ${c.config.flight.start} → ${c.config.flight.end}</td></tr><tr><td>Targeting</td><td>${esc(c.config.targeting.age)} · ${esc(c.config.targeting.gender)} · ${c.config.targeting.geos.join(', ')} · ${esc(c.config.targeting.income)}</td></tr></tbody></table>
        <h3>Excluded publishers</h3>
        ${c.excluded.slice(0, 4).map((e) => `<div style="margin-bottom:4px"><b>${esc(PUBS[e.id].name)}</b> — ${esc(e.why)}</div>`).join('')}
        <div class="foot">${c.id} · v${c.version} · generated ${new Date().toISOString()} · checks ${api.validate(c).filter((v) => v.passed).length}/11 passing</div>
      </div></div>
    </div>`;
    $('#expPdf').onclick = () => { const b = $('#expPdf'); b.disabled = true; b.textContent = 'Rendering…'; setTimeout(() => { b.disabled = false; b.innerHTML = I.dl + ' Download PDF'; ui.toast(`${c.name.replace(/[^a-z0-9]+/gi, '-').toLowerCase()}-brief-v${c.version}.pdf ready · in production this streams from GET /api/campaigns/${c.id}/export.pdf`); }, 900); };
    $('#expJson').onclick = async () => { try { await navigator.clipboard.writeText(JSON.stringify(c.config, null, 2)); ui.toast('Config JSON copied'); } catch (e) { ui.toast('Copy blocked — open the Config tab to select the JSON', 'info'); } };
  }
})();
