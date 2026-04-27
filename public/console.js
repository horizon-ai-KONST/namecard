// Console — mode picker, event setup, recent records / resend.
// Stores user choice in localStorage so /scan.html can read it.

const LS_KEY_CONTEXT = 'cardapp.context.v1'; // current run context
const LS_KEY_EVENTS = 'cardapp.events.v1';    // history of event names

const views = {
  modes: document.getElementById('view-modes'),
  event: document.getElementById('view-event'),
  recent: document.getElementById('view-recent'),
};
function show(name) {
  for (const v of Object.values(views)) v.classList.remove('active');
  views[name].classList.add('active');
}

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
