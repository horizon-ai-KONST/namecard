// Shared Express app. Used by both the local dev server (server.js) and the
// Vercel serverless handler (api/index.js). Does NOT call app.listen() or
// serve static files — those are the caller's responsibility.

import express from 'express';
import multer from 'multer';
import { extractCard, generateGreeting } from './claude.js';
import * as lark from './lark.js';
import { sendGreeting } from './resend.js';

export function createApp({ withStatic = false } = {}) {
  const app = express();
  app.use(express.json({ limit: '20mb' }));

  if (withStatic) {
    app.use(express.static('public'));
  }

  const upload = multer({
    storage: multer.memoryStorage(),
    limits: { fileSize: 15 * 1024 * 1024 },
  });

  // ---- Setup: auto-create missing fields in the Bitable ----
  // Accept both GET and POST so you can trigger it by just opening the URL.
  const setupHandler = async (req, res) => {
    try {
      const result = await lark.ensureSchema();
      res.json({ ok: true, ...result });
    } catch (e) {
      res.status(500).json({ ok: false, error: e.message });
    }
  };
  app.get('/api/setup', setupHandler);
  app.post('/api/setup', setupHandler);

  // ---- Health / schema check ----
  app.get('/api/health', async (req, res) => {
    try {
      const { fields, resolved } = await lark.resolveSchema();
      res.json({
        ok: true,
        lark: { reachable: true, field_count: fields.length, resolved_keys: Object.keys(resolved) },
        resend: { configured: !!process.env.RESEND_API_KEY },
        anthropic: { configured: !!process.env.ANTHROPIC_API_KEY },
      });
    } catch (e) {
      res.status(500).json({ ok: false, error: e.message });
    }
  });

  // ---- Scan: image in, parsed card out ----
  app.post('/api/scan', upload.single('image'), async (req, res) => {
    try {
      if (!req.file) return res.status(400).json({ error: 'No image uploaded' });
      const card = await extractCard(req.file.buffer, req.file.mimetype);
      res.json({ card });
    } catch (e) {
      console.error('[scan] error:', e);
      res.status(500).json({ error: e.message });
    }
  });

  // ---- Archive: confirmed card + image + context -> Lark (+ optional greeting)
  // context: { mode: 'tradeshow' | 'daily' | 'visit', event_name?, visit_note? }
  // Email is auto-sent only when mode === 'tradeshow'. For 'daily' / 'visit' it
  // can be sent later via /api/resend-greeting.
  app.post('/api/archive', upload.single('image'), async (req, res) => {
    try {
      const card = JSON.parse(req.body.card || '{}');
      const context = JSON.parse(req.body.context || '{}');
      const image = req.file?.buffer;

      const record = await lark.saveCard(card, image, context);

      let emailStatus = '未寄';
      const shouldAutoSend = context.mode === 'tradeshow' && !!card.email;
      if (shouldAutoSend) {
        try {
          const greeting = await generateGreeting(card, {
            eventName: context.event_name || process.env.EVENT_NAME || '展場活動',
            boothOwnerName: process.env.BOOTH_OWNER_NAME || '',
            boothOwnerTitle: process.env.BOOTH_OWNER_TITLE || '',
            boothCompany: process.env.BOOTH_COMPANY || '',
          });
          const result = await sendGreeting({
            to: card.email,
            subject: greeting.subject,
            body_text: greeting.body_text,
          });
          emailStatus = result.dryRun ? '已寄（測試）' : '已寄';
        } catch (e) {
          console.error('[email] failed:', e);
          emailStatus = '失敗';
        }
        try { await lark.updateEmailStatus(record.record_id, emailStatus); } catch {}
      }

      res.json({ ok: true, record_id: record.record_id, email_status: emailStatus, mode: context.mode });
    } catch (e) {
      console.error('[archive] error:', e);
      res.status(500).json({ error: e.message });
    }
  });

  // ---- Resend greeting: manually send greeting for a previously archived card.
  // Used by Console for 日常 / 拜訪 mode entries the user wants to follow up on.
  app.post('/api/resend-greeting', async (req, res) => {
    try {
      const { record_id, event_name } = req.body || {};
      if (!record_id) return res.status(400).json({ error: 'record_id required' });

      const record = await lark.getRecord(record_id);
      const f = record.fields || {};
      const txt = (v) => {
        if (v == null) return '';
        if (typeof v === 'string') return v;
        if (Array.isArray(v)) return v.map((x) => x.text || x.name || '').join('').trim();
        if (typeof v === 'object') return v.text || v.name || '';
        return String(v);
      };
      const card = {
        name_zh: txt(f['姓名']),
        name_en: txt(f['英文名']),
        company: txt(f['公司']),
        title: txt(f['職稱']),
        email: txt(f['Email']),
      };
      if (!card.email) return res.status(400).json({ error: '此名片沒有 Email 無法寄信' });

      const greeting = await generateGreeting(card, {
        eventName: event_name || txt(f['來源情境']) || process.env.EVENT_NAME || '日前',
        boothOwnerName: process.env.BOOTH_OWNER_NAME || '',
        boothOwnerTitle: process.env.BOOTH_OWNER_TITLE || '',
        boothCompany: process.env.BOOTH_COMPANY || '',
      });
      const result = await sendGreeting({
        to: card.email,
        subject: greeting.subject,
        body_text: greeting.body_text,
      });
      const status = result.dryRun ? '已寄（測試）' : '已寄';
      try { await lark.updateEmailStatus(record_id, status); } catch {}
      res.json({ ok: true, email_status: status });
    } catch (e) {
      console.error('[resend-greeting] error:', e);
      res.status(500).json({ error: e.message });
    }
  });

  // ---- List recent records (polled by the display page) ----
  app.get('/api/records', async (req, res) => {
    try {
      const items = await lark.listRecentRecords(50);
      res.json({ items });
    } catch (e) {
      res.status(500).json({ error: e.message });
    }
  });

  return app;
}
