// Scanner page — reads mode/event from Console (localStorage) and adapts UI.
// States: capture -> processing -> confirm -> done

const LS_KEY_CONTEXT = 'cardapp.context.v1';

// Apply brand config from backend
(async () => {
  try {
    const r = await fetch('/api/config');
    const cfg = await r.json();
    document.documentElement.dataset.flavor = cfg.flavor;
    document.querySelectorAll('[data-brand-name]').forEach((el) => { el.textContent = cfg.brand.name; });
    document.querySelectorAll('[data-brand-watermark]').forEach((el) => { el.textContent = cfg.brand.watermark; });
    document.title = `名片掃描 · ${cfg.brand.name}`;
  } catch {}
})();

function loadContext() {
  try {
    const raw = localStorage.getItem(LS_KEY_CONTEXT);
    return raw ? JSON.parse(raw) : { mode: 'daily' };
  } catch { return { mode: 'daily' }; }
}
const ctx = loadContext();

// ---- Apply context to UI ----
const MODE_LABELS = {
  tradeshow: '展場名片交換',
  daily: '日常紀錄',
  visit: '客戶拜訪',
};
document.getElementById('modeLabel').textContent = MODE_LABELS[ctx.mode] || '名片掃描';

const banner = document.getElementById('contextBanner');
if (ctx.mode === 'tradeshow' && ctx.event_name) {
  banner.innerHTML = `🎪 <b>${escapeHtml(ctx.event_name)}</b> · 掃描後將自動寄 greeting 信`;
  banner.classList.add('show', 'tradeshow');
} else if (ctx.mode === 'visit') {
  banner.innerHTML = `🤝 客戶拜訪模式 · 不自動寄信，可加會議備註`;
  banner.classList.add('show', 'visit');
} else {
  banner.innerHTML = `📇 日常紀錄模式 · 不自動寄信`;
  banner.classList.add('show', 'daily');
}

// Show visit_note field only for visit mode
if (ctx.mode === 'visit') {
  document.getElementById('visitNoteField').hidden = false;
}

// Hint banner: only "請客人親自確認" makes sense at a tradeshow.
const confirmHint = document.getElementById('confirmHint');
if (ctx.mode !== 'tradeshow') {
  confirmHint.innerHTML = '⚠️ AI 偶爾會看錯相似的字，請確認 <b>姓名</b> 與 <b>Email</b> 是否正確';
}

// Email field: required only for tradeshow (we need to send the greeting)
const emailInput = document.querySelector('input[name="email"]');
if (emailInput && ctx.mode === 'tradeshow') {
  emailInput.required = true;
}

// ---- State machine ----
const steps = {
  capture: document.getElementById('step-capture'),
  processing: document.getElementById('step-processing'),
  confirm: document.getElementById('step-confirm'),
  done: document.getElementById('step-done'),
};

function show(name) {
  for (const el of Object.values(steps)) el.classList.remove('active');
  steps[name].classList.add('active');
}

const fileInput = document.getElementById('fileInput');
const btnCapture = document.getElementById('btnCapture');
const btnBack = document.getElementById('btnBack');
const btnSubmit = document.getElementById('btnSubmit');
const btnNext = document.getElementById('btnNext');
const previewImg = document.getElementById('previewImg');
const form = document.getElementById('form');
const doneSub = document.getElementById('doneSub');

let currentFile = null;

btnCapture.addEventListener('click', () => fileInput.click());
btnBack.addEventListener('click', () => show('capture'));
btnNext.addEventListener('click', () => {
  currentFile = null;
  fileInput.value = '';
  form.reset();
  show('capture');
});

fileInput.addEventListener('change', async () => {
  const file = fileInput.files?.[0];
  if (!file) return;
  currentFile = file;
  previewImg.src = URL.createObjectURL(file);
  show('processing');

  try {
    const fd = new FormData();
    fd.append('image', file);
    const res = await fetch('/api/scan', { method: 'POST', body: fd });
    if (!res.ok) throw new Error((await res.json()).error || 'Scan failed');
    const { card } = await res.json();
    fillForm(card);
    show('confirm');
  } catch (e) {
    alert(`辨識失敗：${e.message}\n請重試或手動填寫`);
    fillForm({});
    show('confirm');
  }
});

function fillForm(card) {
  const setVal = (name, v) => {
    const el = form.elements[name];
    if (el) el.value = v || '';
  };
  setVal('name_zh', card.name_zh);
  setVal('name_en', card.name_en);
  setVal('company', card.company);
  setVal('title', card.title);
  setVal('email', card.email);
  setVal('phone', card.phone);
  setVal('role_category', card.role_category);

  // Highlight low-confidence fields based on per-field scores from Claude
  const fc = card.field_confidence || {};
  const THRESHOLD = 0.9;
  form.querySelectorAll('label[data-key]').forEach((label) => {
    const key = label.dataset.key;
    const score = fc[key];
    label.classList.toggle('low-confidence', typeof score === 'number' && score < THRESHOLD);
  });
}

btnSubmit.addEventListener('click', async (e) => {
  e.preventDefault();
  if (!form.reportValidity()) return;
  const data = Object.fromEntries(new FormData(form).entries());

  // separate visit_note out of card payload — it goes into context
  const visit_note = data.visit_note || '';
  delete data.visit_note;

  const context = {
    mode: ctx.mode,
    event_name: ctx.event_name || '',
    visit_note,
  };

  btnSubmit.disabled = true;
  btnSubmit.textContent = '傳送中…';
  try {
    const fd = new FormData();
    fd.append('card', JSON.stringify(data));
    fd.append('context', JSON.stringify(context));
    if (currentFile) fd.append('image', currentFile);
    const res = await fetch('/api/archive', { method: 'POST', body: fd });
    const respData = await res.json();
    if (!res.ok) throw new Error(respData.error || 'Archive failed');

    if (ctx.mode === 'tradeshow' && data.email) {
      doneSub.textContent = `感謝 ${data.name_zh || data.name_en || ''}！問候信稍後會寄到 ${data.email}`;
    } else if (ctx.mode === 'visit') {
      doneSub.textContent = `已歸檔 ${data.name_zh || data.name_en || ''}（含拜訪備註）`;
    } else {
      doneSub.textContent = `已歸檔 ${data.name_zh || data.name_en || ''}`;
    }
    show('done');
  } catch (e) {
    alert(`送出失敗：${e.message}`);
  } finally {
    btnSubmit.disabled = false;
    btnSubmit.textContent = '送出';
    btnSubmit.classList.remove('loading');
  }
});

function escapeHtml(s) {
  return String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}
