// Console — mode picker, event setup, recent records / resend.
// Stores user choice in localStorage so /scan.html can read it.

const LS_KEY_CONTEXT = 'cardapp.context.v1'; // current run context
const LS_KEY_EVENTS = 'cardapp.events.v1';    // history of event names

const views = {
  modes: document.getElementById('view-modes'),
  event: document.getElementById('view-event'),
  recent: document.getElementById('view-recent'),
  batch: document.getElementById('view-batch'),
};
function show(name) {
  for (const v of Object.values(views)) v.classList.remove('active');
  views[name].classList.add('active');
}

// ---- Apply config from backend (brand + which modes to show) ----
(async function applyConfig() {
  try {
    const r = await fetch('/api/config');
    const cfg = await r.json();
    // Set flavor on <html> so CSS palette switches; cache it for next page load
    // (the inline <head> script reads this to avoid the brand flash).
    document.documentElement.dataset.flavor = cfg.flavor;
    try { sessionStorage.setItem('cardapp.flavor', cfg.flavor); } catch (e) {}

    // Brand text
    document.querySelectorAll('[data-brand-name]').forEach((el) => { el.textContent = cfg.brand.name; });
    document.querySelectorAll('[data-brand-tagline]').forEach((el) => { el.textContent = cfg.brand.tagline; });
    document.querySelectorAll('[data-brand-watermark]').forEach((el) => { el.textContent = cfg.brand.watermark; });
    document.title = `Console · ${cfg.brand.name} ${cfg.brand.tagline}`;
    // Subtagline (Konst's "Where Efficiency Leads..." line)
    if (cfg.brand.subtagline) {
      document.querySelectorAll('[data-brand-subtagline]').forEach((el) => {
        el.textContent = cfg.brand.subtagline;
        el.hidden = false;
      });
    }
    // Hide mode cards that aren't enabled
    const enabled = new Set(cfg.modes);
    document.querySelectorAll('.mode-card[data-mode]').forEach((card) => {
      if (!enabled.has(card.dataset.mode)) card.hidden = true;
    });
    // Hide "open display screen" link if this flavor has no display
    if (!cfg.has_display_screen) {
      document.querySelectorAll('[data-needs-display]').forEach((el) => { el.hidden = true; });
    }
    // Bitable entrance link (env: BITABLE_VIEW_URL)
    if (cfg.bitable_url) {
      const lnk = document.getElementById('lnkBitable');
      if (lnk) {
        lnk.href = cfg.bitable_url;
        lnk.hidden = false;
      }
    }
  } catch (e) {
    console.warn('[config] failed to load', e);
  } finally {
    // Reveal the page (was held at opacity 0 to prevent brand flash)
    document.body.classList.add('ready');
  }
})();

// ---- Mode pick ----
document.querySelectorAll('.mode-card').forEach((btn) => {
  btn.addEventListener('click', () => {
    const mode = btn.dataset.mode;
    if (mode === 'tradeshow') {
      renderEventHistory();
      show('event');
    } else {
      // daily or visit — no extra setup, jump straight in
      saveContext({ mode });
      window.location.href = '/scan.html';
    }
  });
});

// ---- Back to modes ----
document.querySelectorAll('[data-back-modes]').forEach((btn) => {
  btn.addEventListener('click', () => show('modes'));
});

// ---- Event input ----
const eventInput = document.getElementById('eventInput');
const btnStartTradeshow = document.getElementById('btnStartTradeshow');

eventInput.addEventListener('input', () => {
  btnStartTradeshow.disabled = eventInput.value.trim().length === 0;
});

btnStartTradeshow.addEventListener('click', () => {
  const eventName = eventInput.value.trim();
  if (!eventName) return;
  rememberEvent(eventName);
  saveContext({ mode: 'tradeshow', event_name: eventName });
  window.location.href = '/scan.html';
});

function getEvents() {
  try {
    const raw = localStorage.getItem(LS_KEY_EVENTS);
    return raw ? JSON.parse(raw) : [];
  } catch { return []; }
}
function rememberEvent(name) {
  const list = getEvents().filter((e) => e !== name);
  list.unshift(name);
  localStorage.setItem(LS_KEY_EVENTS, JSON.stringify(list.slice(0, 8)));
}
function renderEventHistory() {
  const wrap = document.getElementById('eventHistory');
  const events = getEvents();
  if (events.length === 0) {
    wrap.innerHTML = '';
    return;
  }
  wrap.innerHTML = '<div class="event-history-label">最近的展會</div>'
    + events.map((e) => `<button class="event-chip" data-event="${escapeHtml(e)}">${escapeHtml(e)}</button>`).join('');
  wrap.querySelectorAll('.event-chip').forEach((chip) => {
    chip.addEventListener('click', () => {
      eventInput.value = chip.dataset.event;
      btnStartTradeshow.disabled = false;
      btnStartTradeshow.focus();
    });
  });
}

function saveContext(ctx) {
  localStorage.setItem(LS_KEY_CONTEXT, JSON.stringify({ ...ctx, ts: Date.now() }));
}

// ---- Recent records ----
document.getElementById('btnRecent').addEventListener('click', () => {
  show('recent');
  loadRecent();
});

async function loadRecent() {
  const list = document.getElementById('recentList');
  list.innerHTML = '<div class="empty">載入中…</div>';
  try {
    const r = await fetch('/api/records');
    const { items = [] } = await r.json();
    if (items.length === 0) {
      list.innerHTML = '<div class="empty">還沒有任何名片</div>';
      return;
    }
    list.innerHTML = items.map(renderRecentRow).join('');
    list.querySelectorAll('[data-resend]').forEach((btn) => {
      btn.addEventListener('click', () => resendGreeting(btn));
    });
  } catch (e) {
    list.innerHTML = `<div class="empty">載入失敗：${escapeHtml(e.message)}</div>`;
  }
}

function txt(v) {
  if (v == null) return '';
  if (typeof v === 'string') return v;
  if (Array.isArray(v)) return v.map((x) => x.text || x.name || '').join('').trim();
  if (typeof v === 'object') return v.text || v.name || '';
  return String(v);
}

function renderRecentRow(rec) {
  const f = rec.fields || {};
  const name = txt(f['姓名']) || txt(f['英文名']) || '—';
  const company = txt(f['公司']);
  const title = txt(f['職稱']);
  const email = txt(f['Email']);
  const status = txt(f['信件狀態']) || '未寄';
  const source = txt(f['來源情境']);
  const mode = txt(f['模式']);
  const sub = [title, company].filter(Boolean).join(' · ');
  const sentClass = status === '已寄' || status === '已寄（測試）' ? 'sent' : status === '失敗' ? 'failed' : '';
  const canResend = !!email && status !== '已寄' && status !== '寄信中';
  const tag = mode ? `<span class="recent-tag">${escapeHtml(mode)}${source ? ' · ' + escapeHtml(source) : ''}</span>` : '';
  return `
    <div class="recent-row">
      <div class="recent-info">
        <div class="recent-name">${escapeHtml(name)}</div>
        <div class="recent-sub">${escapeHtml(sub)}</div>
        <div class="recent-meta">${tag}<span class="recent-status ${sentClass}">${escapeHtml(status)}</span></div>
      </div>
      ${canResend ? `<button class="btn small" data-resend data-id="${rec.record_id}" data-email="${escapeHtml(email)}">補發 greeting</button>` : ''}
    </div>
  `;
}

async function resendGreeting(btn) {
  if (!confirm(`確定要寄 greeting 信給 ${btn.dataset.email}？`)) return;
  btn.disabled = true;
  btn.textContent = '寄送中…';
  try {
    const r = await fetch('/api/resend-greeting', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ record_id: btn.dataset.id }),
    });
    const data = await r.json();
    if (!r.ok) throw new Error(data.error || '寄送失敗');
    btn.textContent = data.email_status || '已寄';
    btn.classList.add('done');
  } catch (e) {
    alert(`寄送失敗：${e.message}`);
    btn.disabled = false;
    btn.textContent = '補發 greeting';
  }
}

function escapeHtml(s) {
  return String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}

// ============================================================
// Batch import — pick multiple files, OCR + archive each one.
// Concurrency limited to BATCH_CONCURRENCY to avoid Vercel rate limits.
// ============================================================
const BATCH_CONCURRENCY = 2;

document.getElementById('btnBatch').addEventListener('click', () => {
  show('batch');
  resetBatchView();
});

const batchFileInput = document.getElementById('batchFileInput');
document.getElementById('btnPickFiles').addEventListener('click', () => batchFileInput.click());
batchFileInput.addEventListener('change', () => {
  const files = Array.from(batchFileInput.files || []);
  if (files.length === 0) return;
  runBatch(files);
});
document.getElementById('btnBatchDone').addEventListener('click', () => {
  resetBatchView();
  show('modes');
});

function resetBatchView() {
  batchFileInput.value = '';
  document.getElementById('batchProgress').hidden = true;
  document.getElementById('batchList').innerHTML = '';
  document.getElementById('batchCountDone').textContent = '0';
  document.getElementById('batchCountTotal').textContent = '0';
  document.getElementById('btnBatchDone').hidden = true;
  document.getElementById('batchOverall').textContent = '處理中…';
  document.getElementById('batchOverall').className = 'batch-status-pill';
}

async function runBatch(files) {
  document.getElementById('batchProgress').hidden = false;
  document.getElementById('batchCountTotal').textContent = String(files.length);
  document.getElementById('btnPickFiles').disabled = true;

  const list = document.getElementById('batchList');
  // render initial rows
  const rows = files.map((f, i) => {
    const row = document.createElement('div');
    row.className = 'batch-row pending';
    row.dataset.idx = String(i);
    row.innerHTML = `
      <div class="batch-thumb"><img src="${URL.createObjectURL(f)}" alt="" /></div>
      <div class="batch-meta">
        <div class="batch-filename">${escapeHtml(f.name)}</div>
        <div class="batch-row-status">排隊中</div>
      </div>
      <div class="batch-icon">⏳</div>
    `;
    list.appendChild(row);
    return row;
  });

  let done = 0;
  let failed = 0;
  const counter = document.getElementById('batchCountDone');

  // Simple concurrency pool
  let cursor = 0;
  async function worker() {
    while (cursor < files.length) {
      const i = cursor++;
      const file = files[i];
      const row = rows[i];
      try {
        row.classList.remove('pending');
        row.classList.add('processing');
        setRowStatus(row, 'AI 辨識中…', '🔍');

        // 1. OCR
        const scanFd = new FormData();
        scanFd.append('image', file);
        const scanRes = await fetch('/api/scan', { method: 'POST', body: scanFd });
        if (!scanRes.ok) throw new Error((await scanRes.json()).error || '辨識失敗');
        const { card } = await scanRes.json();

        // Flag low-confidence fields into notes so user can review in Lark
        const fc = card.field_confidence || {};
        const lowConf = Object.entries(fc).filter(([_, v]) => typeof v === 'number' && v < 0.85).map(([k]) => k);
        if (lowConf.length) {
          card.notes = `[批次匯入] 低信心欄位: ${lowConf.join(', ')}` + (card.notes ? ` · ${card.notes}` : '');
        } else {
          card.notes = (card.notes ? card.notes + ' · ' : '') + '[批次匯入]';
        }

        // 2. Archive (mode=daily so no email is sent)
        setRowStatus(row, '寫入 Lark…', '💾');
        const archFd = new FormData();
        archFd.append('card', JSON.stringify(card));
        archFd.append('context', JSON.stringify({ mode: 'daily', event_name: '', visit_note: '' }));
        archFd.append('image', file);
        const archRes = await fetch('/api/archive', { method: 'POST', body: archFd });
        if (!archRes.ok) throw new Error((await archRes.json()).error || '寫入失敗');

        row.classList.remove('processing');
        row.classList.add('success');
        const summary = [card.name_zh || card.name_en, card.company].filter(Boolean).join(' · ') || '已寫入';
        setRowStatus(row, summary, '✓');
      } catch (e) {
        failed++;
        row.classList.remove('processing');
        row.classList.add('failed');
        setRowStatus(row, e.message || '失敗', '✗');
      } finally {
        done++;
        counter.textContent = String(done);
      }
    }
  }

  const workers = Array.from({ length: Math.min(BATCH_CONCURRENCY, files.length) }, worker);
  await Promise.all(workers);

  const overall = document.getElementById('batchOverall');
  if (failed === 0) {
    overall.textContent = `全部 ${files.length} 張完成`;
    overall.className = 'batch-status-pill success';
  } else {
    overall.textContent = `${files.length - failed} 成功 · ${failed} 失敗`;
    overall.className = 'batch-status-pill mixed';
  }
  document.getElementById('btnBatchDone').hidden = false;
  document.getElementById('btnPickFiles').disabled = false;
}

function setRowStatus(row, text, icon) {
  row.querySelector('.batch-row-status').textContent = text;
  row.querySelector('.batch-icon').textContent = icon;
}
