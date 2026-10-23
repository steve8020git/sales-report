(() => {
  const API = ((window.SALES_CONFIG || {}).API_URL || '').trim();
  const FIELDS = ['target_rev', 'target_gp', 'actual_rev', 'actual_gp', 'forecast_rev', 'forecast_gp'];
  const $ = (id) => document.getElementById(id);

  let months = {};   // 'YYYY-MM' -> { month, asof, version, updatedAt, updatedBy, rows }
  let order = [];    // 최신 월이 앞
  let cur = null;
  let mode = 'view'; // view | edit | add
  let draft = null;  // { month, asof, baseVersion, sections: { main: [{division, rows}], biz: [...] } }
  let needKey = false;
  let calcs = [];

  // ---------- 계산 (엑셀 수식과 동일) ----------
  const num = (v) => (v === null || v === undefined || v === '' ? null : Number(v));
  // 목표대비 차이액 = 연간 마감 예상 - 연간목표 (둘 다 비어 있으면 빈칸)
  const diff = (r, k) => {
    const t = num(r['target_' + k]), f = num(r['forecast_' + k]);
    return t === null && f === null ? null : (f || 0) - (t || 0);
  };
  const cols = [
    (r) => num(r.target_rev), (r) => num(r.target_gp),
    (r) => num(r.actual_rev), (r) => num(r.actual_gp),
    (r) => num(r.forecast_rev), (r) => num(r.forecast_gp),
    (r) => diff(r, 'rev'), (r) => diff(r, 'gp'),
  ];
  // 합계 = SUM(팀 행), 총합계 = 본부 합계의 합
  const sumCol = (rows, i) => rows.reduce((s, r) => s + (cols[i](r) || 0), 0);

  // ---------- 표시 형식: #,##0_);[Red](#,##0) ----------
  const fmt = (v) => {
    if (v === null || v === undefined || Number.isNaN(v)) return '';
    const n = Math.round(v);
    const s = Math.abs(n).toLocaleString('en-US');
    return n < 0 ? '(' + s + ')' : s;
  };
  const setNum = (td, v) => {
    td.textContent = fmt(v);
    td.classList.toggle('neg', v !== null && Math.round(v) < 0);
  };
  const monthLabel = (m) => m.slice(2, 4) + '년' + Number(m.slice(5, 7)) + '월';
  const asofLabel = (d) => (d ? Number(d.slice(5, 7)) + '/' + Number(d.slice(8, 10)) : '');

  function h(tag, attrs, ...kids) {
    const e = document.createElement(tag);
    if (attrs) for (const [k, v] of Object.entries(attrs)) {
      if (v === null || v === undefined || v === false) continue;
      if (k === 'class') e.className = v;
      else if (k === 'text') e.textContent = v;
      else if (k.startsWith('on')) e.addEventListener(k.slice(2), v);
      else e.setAttribute(k, v === true ? '' : v);
    }
    kids.flat().forEach((c) => c !== null && c !== undefined && e.append(c));
    return e;
  }

  // ---------- 데이터 ----------
  function ingest(rows) {
    months = {};
    rows.forEach((r) => {
      const m = months[r.month] || (months[r.month] = { month: r.month, asof: r.asof, version: '', updatedAt: '', updatedBy: '', rows: [] });
      m.rows.push(r);
      if (r.updated_at > m.version) { m.version = r.updated_at; m.updatedAt = r.updated_at; m.updatedBy = r.updated_by; }
    });
    Object.values(months).forEach((m) => m.rows.sort((a, b) => a.sort - b.sort));
    order = Object.keys(months).sort().reverse();
    if (!cur || !months[cur]) cur = order[0] || null;
  }

  function toSections(rows) {
    const s = { main: [], biz: [] };
    rows.forEach((r) => {
      const list = s[r.section === 'biz' ? 'biz' : 'main'];
      let g = list.find((x) => x.division === r.division);
      if (!g) list.push((g = { division: r.division, rows: [] }));
      const copy = { team: r.team };
      FIELDS.forEach((k) => { copy[k] = num(r[k]); });
      copy._orig = Object.assign({}, copy);
      g.rows.push(copy);
    });
    return s;
  }
  function flatten(sections) {
    const out = [];
    ['main', 'biz'].forEach((sec) => sections[sec].forEach((g) => g.rows.forEach((r) => {
      const o = { section: sec, division: g.division, team: r.team };
      FIELDS.forEach((k) => { o[k] = r[k]; });
      out.push(o);
    })));
    return out;
  }

  async function load(silent) {
    if (!API) {
      banner('아직 데이터 주소가 연결되지 않았습니다. config.js 에 Apps Script 웹 앱 주소(…/exec)를 넣어 주세요.', true);
      return;
    }
    if (!silent) status('불러오는 중…');
    try {
      let viewKey = '';
      try { viewKey = sessionStorage.getItem('sales-view') || ''; } catch (e) { /* 저장소 없음 */ }
      const res = await fetch(API + (API.includes('?') ? '&' : '?') + 't=' + Date.now() + '&key=' + encodeURIComponent(viewKey));
      const j = await res.json();
      if (j.needView) { showLogin(viewKey ? j.error : ''); status(''); return; }
      if (!j.ok) throw new Error(j.error || '응답 오류');
      $('login-panel').hidden = true;
      needKey = !!j.needKey;
      if (mode !== 'view') return;
      ingest(j.rows || []);
      banner('');
      render();
      status(silent ? '' : '');
    } catch (e) {
      if (!silent) { banner('데이터를 불러오지 못했습니다. 잠시 후 새로고침해 주세요. (' + e.message + ')', true); status(''); }
    }
  }

  function showLogin(err) {
    months = {}; order = []; cur = null;
    render();
    $('btn-add').disabled = true;
    $('login-panel').hidden = false;
    $('view-error').textContent = err || '';
    $('view-error').hidden = !err;
    $('view-key').focus();
  }
  function submitLogin() {
    try { sessionStorage.setItem('sales-view', $('view-key').value); } catch (e) { /* 저장소 없음 */ }
    load();
  }
  $('view-go').addEventListener('click', submitLogin);
  $('view-key').addEventListener('keydown', (e) => { if (e.key === 'Enter') submitLogin(); });

  async function post(body) {
    const res = await fetch(API, { method: 'POST', headers: { 'Content-Type': 'text/plain;charset=utf-8' }, body: JSON.stringify(body) });
    return res.json();
  }

  // ---------- 화면 ----------
  function status(t) { $('status').textContent = t; }
  function banner(t, err) {
    const b = $('banner');
    b.replaceChildren();
    b.hidden = !t;
    b.classList.toggle('err', !!err);
    if (t) b.append(t);
    return b;
  }

  function render() {
    renderTabs();
    calcs = [];
    const editing = mode !== 'view';
    document.body.classList.toggle('editing', editing);
    $('editbar').hidden = !editing;
    $('btn-add').disabled = editing || !API;
    $('btn-edit').disabled = editing || !cur;
    $('btn-delete').hidden = mode !== 'edit';
    $('key-wrap').hidden = !needKey;

    const report = $('report');
    report.replaceChildren();
    const month = editing ? draft.month : cur;
    if (!month) {
      report.append(h('p', { class: 'hint', text: API ? '보고가 아직 없습니다. 추가하기를 눌러 첫 보고를 만들어 주세요.' : '' }));
      $('trend-wrap').hidden = true;
      return;
    }
    const asof = editing ? draft.asof : months[cur].asof;
    const sections = editing ? draft.sections : toSections(months[cur].rows);

    if (editing) {
      const b = banner(mode === 'add' ? '새 보고를 작성 중입니다. 가장 최근 보고의 값이 기본값으로 들어 있습니다. 바뀐 칸은 노란색으로 표시됩니다. ' : '수정 중입니다. 바뀐 칸은 노란색으로 표시되고, 합계와 차이액은 바로 다시 계산됩니다. ');
      b.append(h('span', { class: 'asof-edit' }, '누적 실적 기준일',
        h('input', { type: 'date', id: 'draft-asof', value: draft.asof, onchange: (e) => { if (e.target.value) { draft.asof = e.target.value; render(); } } })));
    }

    report.append(
      h('p', { class: 'report-title', text: '■ ' + month.slice(0, 4) + '.' + Number(month.slice(5, 7)) + '월 전략회의 매출현황 보고' }),
      h('p', { class: 'report-unit', text: '[단위 : 백만원]' }),
      table(sections.main, 'main', asof, editing),
    );
    if (editing) report.append(h('div', { class: 'add-div' }, h('button', { type: 'button', class: 'mini', text: '+ 본부 추가', onclick: () => { draft.sections.main.push({ division: '새 본부', rows: [blankRow('새 팀')] }); render(); } })));
    if (sections.biz.length || editing) {
      if (!sections.biz.length) sections.biz.push({ division: '사업부제', rows: [] });
      report.append(table(sections.biz, 'biz', asof, editing));
    }
    if (!editing && months[cur].updatedAt) {
      const d = new Date(months[cur].updatedAt);
      report.append(h('p', { class: 'report-meta', text: '마지막 수정: ' + d.toLocaleString('ko-KR', { dateStyle: 'medium', timeStyle: 'short' }) + ' · ' + months[cur].updatedBy }));
    }
    updateCalcs();
    renderTrend();
  }

  function blankRow(team) {
    const r = { team };
    FIELDS.forEach((k) => { r[k] = null; });
    r._orig = Object.assign({}, r);
    return r;
  }

  function header(asof, firstLabel) {
    const top = h('tr', null,
      h('th', { rowspan: 2, colspan: 2, text: firstLabel || '　구분' }),
      h('th', { colspan: 2, text: '연간목표' }),
      h('th', { colspan: 2, text: '현재 누적 실적(~' + asofLabel(asof) + ')' }),
      h('th', { colspan: 2, text: '연간 마감 예상' }),
      h('th', { colspan: 2, text: '목표대비 차이액' }));
    const sub = h('tr', null, [0, 1, 2, 3].flatMap(() => [h('th', { text: '매출' }), h('th', { text: '매출이익' })]));
    return h('thead', null, top, sub);
  }

  function numCell(i) { return h('td', { class: 'num c' + (i + 1) }); }

  function table(groups, section, asof, editing) {
    const biz = section === 'biz';
    const tbody = h('tbody');
    groups.forEach((g, gi) => {
      if (!biz && gi > 0) tbody.append(h('tr', { class: 'gap' }, h('td', { colspan: 10 })));
      const n = Math.max(1, g.rows.length);
      g.rows.forEach((r, ri) => {
        const tr = h('tr');
        if (ri === 0) tr.append(divisionCell(g, groups, n, editing, biz));
        tr.append(teamCell(g, r, ri, groups, editing));
        for (let i = 0; i < 8; i++) {
          const isRev = i % 2 === 0;
          if (biz && isRev) {
            // 엑셀처럼 사업부제의 매출 칸은 비어 있는 병합 셀
            if (ri === 0) tr.append(h('td', { class: 'num blank c' + (i + 1), rowspan: n }));
            continue;
          }
          const td = numCell(i);
          if (editing && i < 6) td.append(input(r, FIELDS[i]));
          else calcs.push([td, () => cols[i](r)]);
          tr.append(td);
        }
        tbody.append(tr);
      });
      if (!g.rows.length && editing) {
        const tr = h('tr', null, divisionCell(g, groups, 1, editing, biz), h('td', { class: 'team', text: '' }));
        for (let i = 0; i < 8; i++) tr.append(numCell(i));
        tbody.append(tr);
      }
      const sum = h('tr', { class: 'sum' }, h('th', { colspan: 2, text: '합계' }));
      for (let i = 0; i < 8; i++) {
        const td = numCell(i);
        calcs.push([td, () => sumCol(g.rows, i)]);
        sum.append(td);
      }
      tbody.append(sum);
    });
    if (!biz) {
      tbody.append(h('tr', { class: 'gap' }, h('td', { colspan: 10 })));
      const total = h('tr', { class: 'total' }, h('th', { colspan: 2, text: '총합계' }));
      for (let i = 0; i < 8; i++) {
        const td = numCell(i);
        calcs.push([td, () => groups.reduce((s, g) => s + sumCol(g.rows, i), 0)]);
        total.append(td);
      }
      tbody.append(total);
    }
    return h('table', { class: 'xl' }, header(asof), tbody);
  }

  function divisionCell(g, groups, n, editing, biz) {
    const th = h('th', { class: 'div', rowspan: n });
    if (!editing) { th.textContent = g.division; return th; }
    th.append(
      h('input', { class: 'cell name', value: g.division, 'aria-label': '본부 이름', oninput: (e) => { g.division = e.target.value; } }),
      h('div', { class: 'cell-tools', style: 'justify-content:center;margin-top:3px' },
        h('button', { type: 'button', class: 'mini', text: '+ 팀', onclick: () => { g.rows.push(blankRow(biz ? '새 본부' : '새 팀')); render(); } })));
    return th;
  }

  function teamCell(g, r, ri, groups, editing) {
    const td = h('td', { class: 'team' });
    if (!editing) { td.textContent = r.team; return td; }
    td.append(h('div', { class: 'cell-tools' },
      h('input', { class: 'cell name', value: r.team, 'aria-label': '팀 이름', oninput: (e) => { r.team = e.target.value; } }),
      h('button', { type: 'button', class: 'mini del', text: '×', title: '이 행 삭제', 'aria-label': r.team + ' 행 삭제', onclick: () => {
        g.rows.splice(ri, 1);
        if (!g.rows.length) groups.splice(groups.indexOf(g), 1);
        render();
      } })));
    return td;
  }

  function input(r, k) {
    const shown = r[k] === null ? '' : String(r[k]);
    const el = h('input', { class: 'cell', inputmode: 'decimal', value: shown, 'aria-label': k });
    const mark = () => el.classList.toggle('changed', r[k] !== r._orig[k]);
    mark();
    el.addEventListener('input', () => {
      const raw = el.value.replace(/,/g, '').trim();
      const v = raw === '' ? null : Number(raw);
      const bad = raw !== '' && !Number.isFinite(v);
      el.classList.toggle('bad', bad);
      el.style.borderColor = bad ? 'var(--danger)' : '';
      if (!bad) { r[k] = v; mark(); updateCalcs(); }
    });
    return el;
  }

  function updateCalcs() { calcs.forEach(([td, fn]) => setNum(td, fn())); }

  function renderTabs() {
    const tabs = $('tabs');
    tabs.replaceChildren();
    tabs.setAttribute('role', 'tablist');
    if (mode === 'add') tabs.append(h('button', { type: 'button', class: 'tab draft', role: 'tab', 'aria-selected': 'true', text: monthLabel(draft.month) + ' (작성 중)' }));
    order.forEach((m) => tabs.append(h('button', {
      type: 'button', class: 'tab', role: 'tab', 'aria-selected': String(mode !== 'add' && m === cur), text: monthLabel(m),
      disabled: mode !== 'view',
      onclick: () => { cur = m; render(); window.scrollTo({ top: 0 }); },
    })));
  }

  function renderTrend() {
    const wrap = $('trend-wrap');
    wrap.hidden = order.length < 1 || mode !== 'view';
    if (wrap.hidden) return;
    const t = $('trend');
    t.replaceChildren(header(null, '보고 월 (기준일)'));
    t.querySelector('thead tr th:nth-child(3)').textContent = '현재 누적 실적';
    const tb = h('tbody');
    order.forEach((m) => {
      const rows = months[m].rows.filter((r) => r.section !== 'biz');
      const tr = h('tr', { class: m === cur ? 'cur' : '', onclick: () => { cur = m; render(); window.scrollTo({ top: 0, behavior: 'smooth' }); } },
        h('td', { class: 'team', colspan: 2, text: monthLabel(m) + ' (~' + asofLabel(months[m].asof) + ')' }));
      for (let i = 0; i < 8; i++) { const td = numCell(i); setNum(td, sumCol(rows, i)); tr.append(td); }
      tb.append(tr);
    });
    t.append(tb);
  }

  // ---------- 추가 / 수정 / 저장 ----------
  const pad = (n) => String(n).padStart(2, '0');
  function nextMonth() {
    const base = order[0] || (new Date().getFullYear() + '-' + pad(new Date().getMonth()));
    let y = Number(base.slice(0, 4)), m = Number(base.slice(5, 7));
    do { m += 1; if (m > 12) { m = 1; y += 1; } } while (months[y + '-' + pad(m)]);
    return y + '-' + pad(m);
  }
  function today() { const d = new Date(); return d.getFullYear() + '-' + pad(d.getMonth() + 1) + '-' + pad(d.getDate()); }

  $('btn-add').addEventListener('click', () => {
    $('add-month').value = nextMonth();
    $('add-asof').value = today();
    $('add-error').hidden = true;
    $('add-panel').hidden = false;
    $('add-month').focus();
  });
  $('add-cancel').addEventListener('click', () => { $('add-panel').hidden = true; });
  $('add-start').addEventListener('click', () => {
    const m = $('add-month').value, d = $('add-asof').value;
    const err = $('add-error');
    if (!/^\d{4}-\d{2}$/.test(m)) { err.textContent = '보고 월을 골라 주세요.'; err.hidden = false; return; }
    if (!/^\d{4}-\d{2}-\d{2}$/.test(d)) { err.textContent = '기준일을 골라 주세요.'; err.hidden = false; return; }
    if (months[m]) { err.textContent = monthLabel(m) + ' 보고가 이미 있습니다. 그 달 탭을 열고 수정하기를 눌러 주세요.'; err.hidden = false; return; }
    const src = order[0] ? months[order[0]].rows : [];
    draft = { month: m, asof: d, baseVersion: '', sections: toSections(src) };
    if (!draft.sections.main.length) draft.sections.main.push({ division: '새 본부', rows: [blankRow('새 팀')] });
    mode = 'add';
    $('add-panel').hidden = true;
    openEdit();
  });

  $('btn-edit').addEventListener('click', () => {
    if (!cur) return;
    draft = { month: cur, asof: months[cur].asof, baseVersion: months[cur].version, sections: toSections(months[cur].rows) };
    mode = 'edit';
    openEdit();
  });

  function openEdit() {
    try { $('editor-name').value = localStorage.getItem('sales-editor') || ''; } catch (e) { /* 저장소 없음 */ }
    try { $('edit-key').value = sessionStorage.getItem('sales-key') || ''; } catch (e) { /* 저장소 없음 */ }
    $('save-error').hidden = true;
    resetDelete();
    render();
    window.scrollTo({ top: 0 });
  }

  function closeEdit() {
    mode = 'view';
    draft = null;
    banner('');
    render();
  }

  $('btn-cancel').addEventListener('click', closeEdit);

  function saveError(t) { const e = $('save-error'); e.textContent = t; e.hidden = !t; }

  $('btn-save').addEventListener('click', async () => {
    const by = $('editor-name').value.trim();
    if (!by) { saveError('수정자 이름을 적어 주세요.'); $('editor-name').focus(); return; }
    if (document.querySelector('#report input.cell.bad')) { saveError('숫자가 아닌 칸이 있습니다. 빨간 칸을 고쳐 주세요.'); return; }
    const rows = flatten(draft.sections);
    if (!rows.length) { saveError('행이 하나 이상 있어야 합니다.'); return; }
    if (rows.some((r) => !String(r.division).trim() || !String(r.team).trim())) { saveError('본부 또는 팀 이름이 빈 칸이 있습니다.'); return; }
    const key = $('edit-key').value;
    try { localStorage.setItem('sales-editor', by); sessionStorage.setItem('sales-key', key); } catch (e) { /* 저장소 없음 */ }
    saveError('');
    $('btn-save').disabled = true;
    status('저장 중…');
    try {
      const res = await post({ action: 'saveMonth', mode: mode === 'add' ? 'add' : 'edit', month: draft.month, asof: draft.asof, rows, by, key, baseVersion: draft.baseVersion });
      if (!res.ok) {
        saveError(res.error || '저장하지 못했습니다.');
        if (res.badKey) { needKey = true; $('key-wrap').hidden = false; $('edit-key').focus(); }
        status('');
        return;
      }
      cur = draft.month;
      mode = 'view';
      draft = null;
      await load();
      status('저장했습니다');
      setTimeout(() => status(''), 4000);
    } catch (e) {
      saveError('저장하지 못했습니다. 인터넷 연결을 확인하고 다시 눌러 주세요.');
      status('');
    } finally {
      $('btn-save').disabled = false;
    }
  });

  let deleteArmed = null;
  function resetDelete() { clearTimeout(deleteArmed); deleteArmed = null; $('btn-delete').textContent = '이 달 보고 삭제'; }
  $('btn-delete').addEventListener('click', async () => {
    if (!deleteArmed) {
      $('btn-delete').textContent = '한 번 더 누르면 삭제됩니다';
      deleteArmed = setTimeout(resetDelete, 5000);
      return;
    }
    resetDelete();
    const by = $('editor-name').value.trim();
    if (!by) { saveError('수정자 이름을 적어 주세요.'); return; }
    status('삭제 중…');
    try {
      const res = await post({ action: 'deleteMonth', month: draft.month, by, key: $('edit-key').value, baseVersion: draft.baseVersion });
      if (!res.ok) { saveError(res.error || '삭제하지 못했습니다.'); status(''); return; }
      mode = 'view'; draft = null; cur = null;
      await load();
      status('삭제했습니다');
    } catch (e) { saveError('삭제하지 못했습니다. 다시 시도해 주세요.'); status(''); }
  });

  window.addEventListener('beforeunload', (e) => { if (mode !== 'view') { e.preventDefault(); e.returnValue = ''; } });

  // 다른 사람이 바꾼 내용이 보이도록 1분마다 새로 불러옵니다(보는 중일 때만).
  setInterval(() => { if (mode === 'view' && !document.hidden) load(true); }, 60000);
  document.addEventListener('visibilitychange', () => { if (!document.hidden && mode === 'view') load(true); });

  render();
  load();
})();
