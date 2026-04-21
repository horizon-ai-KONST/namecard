// Lark Bitable storage adapter.
// Implements the Storage Adapter interface: init(), saveCard(card, imageBuffer).
// Swappable with future adapters (Airtable, Sheets, Notion, etc.).

const REGION_HOSTS = {
  sg: 'https://open.larksuite.com',
  feishu: 'https://open.feishu.cn',
};

function host() {
  const region = process.env.LARK_REGION || 'sg';
  return REGION_HOSTS[region] || REGION_HOSTS.sg;
}

let tokenCache = { token: null, expiresAt: 0 };

async function getTenantAccessToken() {
  if (tokenCache.token && Date.now() < tokenCache.expiresAt - 60_000) {
    return tokenCache.token;
  }
  const res = await fetch(`${host()}/open-apis/auth/v3/tenant_access_token/internal`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      app_id: process.env.LARK_APP_ID,
      app_secret: process.env.LARK_APP_SECRET,
    }),
  });
  const data = await res.json();
  if (data.code !== 0) {
    throw new Error(`Lark auth failed: ${data.msg} (code ${data.code})`);
  }
  tokenCache = {
    token: data.tenant_access_token,
    expiresAt: Date.now() + data.expire * 1000,
  };
  return tokenCache.token;
}

async function larkFetch(path, options = {}) {
  const token = await getTenantAccessToken();
  const res = await fetch(`${host()}${path}`, {
    ...options,
    headers: {
      Authorization: `Bearer ${token}`,
      'Content-Type': 'application/json',
      ...(options.headers || {}),
    },
  });
  const data = await res.json();
  if (data.code !== 0) {
    throw new Error(`Lark ${path} failed: ${data.msg} (code ${data.code})`);
  }
  return data.data;
}

// ---- Public API ----

export async function listFields() {
  const appToken = process.env.LARK_BITABLE_APP_TOKEN;
  const tableId = process.env.LARK_BITABLE_TABLE_ID;
  const data = await larkFetch(
    `/open-apis/bitable/v1/apps/${appToken}/tables/${tableId}/fields?page_size=100`
  );
  return data.items || [];
}

// Our canonical field names (zh-TW) -> list of aliases the user might have used.
// When writing to Bitable we match case-insensitively against any alias.
const FIELD_ALIASES = {
  name: ['姓名', '中文姓名', 'Name', '名稱'],
  name_en: ['英文名', '英文姓名', 'English Name', 'EN Name'],
  company: ['公司', '公司名稱', 'Company'],
  title: ['職稱', '頭銜', 'Title'],
  email: ['Email', '電子郵件', '信箱', 'E-mail'],
  phone: ['電話', '手機', '聯絡電話', 'Phone'],
  address: ['地址', 'Address'],
  card_image: ['名片照片', '名片', '照片', 'Card Image'],
  scanned_at: ['掃描時間', '建立時間', 'Scanned At', 'Created'],
  email_status: ['信件狀態', '寄信狀態', 'Email Status'],
  notes: ['備註', 'Notes', 'Remarks'],
};

// Lark Bitable field types we care about.
// Reference: https://open.larksuite.com/document/server-docs/docs/bitable-v1/app-table-field/guide
const FIELD_TYPES = {
  TEXT: 1,
  NUMBER: 2,
  SINGLE_SELECT: 3,
  DATETIME: 5,
  ATTACHMENT: 17,
};

// Canonical schema we want in the Bitable. First alias is the name we create.
const DESIRED_SCHEMA = [
  { key: 'name', name: '姓名', type: FIELD_TYPES.TEXT },
  { key: 'name_en', name: '英文名', type: FIELD_TYPES.TEXT },
  { key: 'company', name: '公司', type: FIELD_TYPES.TEXT },
  { key: 'title', name: '職稱', type: FIELD_TYPES.TEXT },
  { key: 'email', name: 'Email', type: FIELD_TYPES.TEXT },
  { key: 'phone', name: '電話', type: FIELD_TYPES.TEXT },
  { key: 'address', name: '地址', type: FIELD_TYPES.TEXT },
  { key: 'card_image', name: '名片照片', type: FIELD_TYPES.ATTACHMENT },
  { key: 'scanned_at', name: '掃描時間', type: FIELD_TYPES.DATETIME },
  {
    key: 'email_status',
    name: '信件狀態',
    type: FIELD_TYPES.SINGLE_SELECT,
    property: {
      options: [
        { name: '未寄' },
        { name: '寄信中' },
        { name: '已寄' },
        { name: '已寄（測試）' },
        { name: '失敗' },
      ],
    },
  },
  { key: 'notes', name: '備註', type: FIELD_TYPES.TEXT },
];

// Create any fields from DESIRED_SCHEMA that don't exist yet. Idempotent.
export async function ensureSchema() {
  const appToken = process.env.LARK_BITABLE_APP_TOKEN;
  const tableId = process.env.LARK_BITABLE_TABLE_ID;
  const existing = await listFields();
  const existingNames = new Set(existing.map((f) => f.field_name.toLowerCase()));

  const created = [];
  for (const desired of DESIRED_SCHEMA) {
    // Check if any alias already exists
    const aliases = FIELD_ALIASES[desired.key] || [desired.name];
    const hasIt = aliases.some((a) => existingNames.has(a.toLowerCase()));
    if (hasIt) continue;

    const body = {
      field_name: desired.name,
      type: desired.type,
    };
    if (desired.property) body.property = desired.property;

    try {
      await larkFetch(
        `/open-apis/bitable/v1/apps/${appToken}/tables/${tableId}/fields`,
        { method: 'POST', body: JSON.stringify(body) }
      );
      created.push(desired.name);
    } catch (e) {
      console.warn(`[Lark] Could not create field "${desired.name}":`, e.message);
    }
  }
  return { created };
}

export async function resolveSchema() {
  const fields = await listFields();
  const byName = {};
  for (const f of fields) byName[f.field_name.toLowerCase()] = f;

  const resolved = {};
  for (const [key, aliases] of Object.entries(FIELD_ALIASES)) {
    for (const alias of aliases) {
      const match = byName[alias.toLowerCase()];
      if (match) {
        resolved[key] = { name: match.field_name, type: match.type };
        break;
      }
    }
  }
  return { fields, resolved };
}

// Upload the card image as an attachment to the Bitable. Returns an attachment token
// that can be written to an Attachment-type field.
export async function uploadAttachment(buffer, filename = 'card.jpg', mimeType = 'image/jpeg') {
  const token = await getTenantAccessToken();
  const appToken = process.env.LARK_BITABLE_APP_TOKEN;

  const form = new FormData();
  const blob = new Blob([buffer], { type: mimeType });
  form.append('file_name', filename);
  form.append('parent_type', 'bitable_image');
  form.append('parent_node', appToken);
  form.append('size', String(buffer.length));
  form.append('file', blob, filename);

  const res = await fetch(`${host()}/open-apis/drive/v1/medias/upload_all`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${token}` },
    body: form,
  });
  const data = await res.json();
  if (data.code !== 0) {
    throw new Error(`Lark upload failed: ${data.msg} (code ${data.code})`);
  }
  return data.data.file_token;
}

// Create a record. `card` is the parsed card object; `imageBuffer` optional.
// Returns { record_id, fields } describing the created row.
export async function saveCard(card, imageBuffer) {
  const { resolved } = await resolveSchema();
  const appToken = process.env.LARK_BITABLE_APP_TOKEN;
  const tableId = process.env.LARK_BITABLE_TABLE_ID;

  const fields = {};
  const put = (key, value) => {
    if (value == null || value === '') return;
    if (!resolved[key]) return; // silently skip fields user didn't create
    fields[resolved[key].name] = value;
  };

  put('name', card.name_zh || card.name);
  put('name_en', card.name_en);
  put('company', card.company);
  put('title', card.title);
  put('email', card.email);
  put('phone', card.phone);
  put('address', card.address);
  put('notes', card.notes);

  // scanned_at: Lark date field expects milliseconds
  if (resolved.scanned_at) {
    fields[resolved.scanned_at.name] = Date.now();
  }
  // email_status default
  if (resolved.email_status) {
    fields[resolved.email_status.name] = '未寄';
  }

  // attachment
  if (imageBuffer && resolved.card_image) {
    try {
      const fileToken = await uploadAttachment(imageBuffer);
      fields[resolved.card_image.name] = [{ file_token: fileToken }];
    } catch (e) {
      console.warn('[Lark] Attachment upload failed, continuing without image:', e.message);
    }
  }

  const data = await larkFetch(
    `/open-apis/bitable/v1/apps/${appToken}/tables/${tableId}/records`,
    {
      method: 'POST',
      body: JSON.stringify({ fields }),
    }
  );
  return data.record;
}

export async function updateEmailStatus(recordId, status) {
  const { resolved } = await resolveSchema();
  if (!resolved.email_status) return;
  const appToken = process.env.LARK_BITABLE_APP_TOKEN;
  const tableId = process.env.LARK_BITABLE_TABLE_ID;
  await larkFetch(
    `/open-apis/bitable/v1/apps/${appToken}/tables/${tableId}/records/${recordId}`,
    {
      method: 'PUT',
      body: JSON.stringify({ fields: { [resolved.email_status.name]: status } }),
    }
  );
}

// List recent records for the live display screen.
export async function listRecentRecords(limit = 20) {
  const appToken = process.env.LARK_BITABLE_APP_TOKEN;
  const tableId = process.env.LARK_BITABLE_TABLE_ID;
  const data = await larkFetch(
    `/open-apis/bitable/v1/apps/${appToken}/tables/${tableId}/records?page_size=${limit}`
  );
  return data.items || [];
}
