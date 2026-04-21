// Tradeshow card scanner — PWA frontend state machine.
// States: capture -> processing -> confirm -> done

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

  btnSubmit.disabled = true;
  btnSubmit.textContent = '傳送中…';
  try {
    const fd = new FormData();
    fd.append('card', JSON.stringify(data));
    if (currentFile) fd.append('image', currentFile);
    const res = await fetch('/api/archive', { method: 'POST', body: fd });
    if (!res.ok) throw new Error((await res.json()).error || 'Archive failed');
    doneSub.textContent = `感謝 ${data.name_zh || data.name_en || ''}！問候信稍後會寄到 ${data.email}`;
    show('done');
  } catch (e) {
    alert(`送出失敗：${e.message}`);
  } finally {
    btnSubmit.disabled = false;
    btnSubmit.textContent = '送出並交換名片';
    btnSubmit.classList.remove('loading');
  }
});
