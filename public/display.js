// Live display — polls /api/records every few seconds and re-renders.
// Polling (vs SSE) is required on Vercel Hobby since serverless functions
// cannot hold long-lived streaming connections.
const listEl = document.getElementById('list');
const countEl = document.getElementById('count');

const POLL_MS = 3000;

const state = {
  items: [], // { record_id, card, ts, status }
  freshId: null, // record_id that should show the green "fresh" glow
};

let lastSignature = null;

function signature() {
  return JSON.stringify({
    f: state.freshId,
    n: state.items.length,
    ids: state.items.slice(0, 50).map((x) => [x.record_id, x.status, x.card?.name_zh, x.card?.name_en, x.card?.company, x.card?.title, x.card?.email]),
  });
}

function render() {
  const sig = signature();
  if (sig === lastSignature) return; // nothing changed → don't touch the DOM
  lastSignature = sig;
  if (state.items.length === 0) {
    listEl.innerHTML = '<div class="empty">等候第一位客人…</div>';
    countEl.textContent = '0';
    return;
  }
  countEl.textContent = String(state.items.length);
  listEl.innerHTML = state.items
    .slice(0, 50)
    .map((item) => {
      const c = item.card || {};
      const initial = (c.name_zh || c.name_en || c.email || '?').trim().charAt(0);
      const statusClass = item.status === '已寄' || item.status === '已寄（測試）' ? 'sent'
                         : item.status === '失敗' ? 'failed' : '';
      const statusText = item.status || '處理中…';
      const fresh = item.record_id === state.freshId ? 'fresh' : '';
      return `
        <div class="card-row ${fresh}">
          <div class="avatar">${initial}</div>
          <div class="info">
            <div class="name">${escapeHtml(c.name_zh || c.name_en || '—')}</div>
            <div class="sub">${escapeHtml([c.title, c.company].filter(Boolean).join(' · ') || c.email || '')}</div>
          </div>
          <div class="status ${statusClass}">${escapeHtml(statusText)}</div>
        </div>
      `;
    })
    .join('');
}

function escapeHtml(s) {
  return String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}

function txt(v) {
  if (v == null) return '';
  if (typeof v === 'string') return v;
  if (Array.isArray(v)) return v.map((x) => x.text || x.name || '').join('').trim();
  if (typeof v === 'object') return v.text || v.name || '';
  return String(v);
}

function mapRecord(rec) {
  const f = rec.fields || {};
  const card = {
    name_zh: txt(f['姓名']),
    name_en: txt(f['英文名']),
    company: txt(f['公司']),
    title: txt(f['職稱']),
    email: txt(f['Email']),
  };
  if (!card.name_zh && !card.name_en && !card.email && !card.company) return null;
  return {
    record_id: rec.record_id,
    card,
    ts: Date.now(),
    status: txt(f['信件狀態']) || '—',
  };
}

async function poll() {
  try {
    const r = await fetch('/api/records');
    const { items = [] } = await r.json();
    const previousTopId = state.items[0]?.record_id;
    const mapped = items.map(mapRecord).filter(Boolean);
    state.items = mapped;
    // Mark the top row as "fresh" if a new record_id appeared at the top.
    const newTopId = state.items[0]?.record_id;
    if (newTopId && newTopId !== previousTopId && previousTopId !== undefined) {
      state.freshId = newTopId;
      // clear the glow after 15s so it doesn't linger forever
      setTimeout(() => { state.freshId = null; render(); }, 15000);
    } else if (state.freshId === null && state.items.length && previousTopId === undefined) {
      // first load: treat the top card as fresh briefly
      state.freshId = newTopId;
      setTimeout(() => { state.freshId = null; render(); }, 4000);
    }
    render();
  } catch (e) {
    console.warn('[display] poll failed:', e.message);
  }
}

render();
poll();
setInterval(poll, POLL_MS);
