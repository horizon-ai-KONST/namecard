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
  app.post('/api/setup', async (req, res) => {
    try {
      const result = await lark.ensureSchema();
      res.json({ ok: true, ...result });
    } catch (e) {
      res.status(500).json({ ok: false, error: e.message });
    }
  });

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

  // ---- Archive: confirmed card + image -> Lark + greeting email
  // Note: awaits email send so Vercel serverless doesn't kill the function early.
  app.post('/api/archive', upload.single('image'), async (req, res) => {
    try {
      const card = JSON.parse(req.body.card || '{}');
      const image = req.file?.buffer;

      const record = await lark.saveCard(card, image);

      let emailStatus = '未寄';
      if (card.email) {
        try {
          const greeting = await generateGreeting(card, {
            eventName: process.env.EVENT_NAME || '展場活動',
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

      res.json({ ok: true, record_id: record.record_id, email_status: emailStatus });
    } catch (e) {
      console.error('[archive] error:', e);
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
