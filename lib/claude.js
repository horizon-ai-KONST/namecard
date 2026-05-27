// Claude Vision OCR for business cards + greeting email generator.
// Uses Haiku 4.5 for speed/cost; Opus is available if we ever need fallback.

import Anthropic from '@anthropic-ai/sdk';

const client = new Anthropic();

// Sonnet 4.6 is the default — noticeably more accurate on rare CJK characters
// than Haiku, while still fast enough (~2-3s). Override via env for experiments.
const EXTRACT_MODEL = process.env.CLAUDE_EXTRACT_MODEL || 'claude-sonnet-4-6';
const VERIFY_MODEL = process.env.CLAUDE_VERIFY_MODEL || 'claude-sonnet-4-6';
const GREETING_MODEL = process.env.CLAUDE_GREETING_MODEL || 'claude-haiku-4-5-20251001';

const EXTRACTION_SYSTEM = `You extract structured data from business card photos.

Rules:
- Return ONLY valid JSON matching the schema. No prose, no markdown, no code fences.
- If a field is not visible, use null. Never invent data.
- When the card shows multiple brand logos or company names, use the email domain as the strongest signal for the primary company. Put other brand names in "brands".
- "title" should capture the person's role verbatim (e.g., "AI 數位轉型策略總監"). Do not translate.
- "role_category" is your best guess at one of: "executive", "sales", "marketing", "engineering", "product", "design", "operations", "hr", "finance", "legal", "consulting", "research", "other". This helps customize greeting emails later.
- Normalize phone to E.164-ish format with country code if possible (e.g., "+886 972 281 077").
- For CJK names, be extra careful with characters that look similar (寧/甯/寕, 爁/燦, 傑/杰, 明/朋). If unsure, prefer the more common character. Cross-check the Chinese name against the email local-part — Chinese names commonly share a syllable/pinyin with the email (e.g., grace.wu → 吳, jiahao.li → 李).
- Per-field confidence: 0.0-1.0. Use <0.85 when the character strokes are ambiguous or the image is blurry.`;

const EXTRACTION_SCHEMA = {
  name_zh: 'Chinese name, or null',
  name_en: 'English name, or null',
  company: 'Primary company name (prefer the one matching email domain)',
  company_en: 'English company name, or null',
  brands: 'Array of other brand names shown on the card, or []',
  title: 'Job title verbatim',
  role_category: 'One of the allowed categories',
  email: 'Email address',
  phone: 'Phone number in E.164-ish format',
  address: 'Address if shown, else null',
  tax_id: 'Tax ID / 統一編號 if shown, else null',
  field_confidence: 'Object with per-field confidence: { name_zh: 0.95, email: 0.99, ... }',
  confidence: 'Overall confidence 0.0 - 1.0',
};

function parseJson(text) {
  const cleaned = text.trim().replace(/^```json\s*/i, '').replace(/```$/, '').trim();
  try {
    return JSON.parse(cleaned);
  } catch (e) {
    throw new Error(`Claude returned non-JSON: ${cleaned.slice(0, 200)}`);
  }
}

async function firstPassExtract(imageBuffer, mimeType) {
  const base64 = imageBuffer.toString('base64');
  const msg = await client.messages.create({
    model: EXTRACT_MODEL,
    max_tokens: 1024,
    system: EXTRACTION_SYSTEM,
    messages: [
      {
        role: 'user',
        content: [
          { type: 'image', source: { type: 'base64', media_type: mimeType, data: base64 } },
          { type: 'text', text: `Extract into this JSON shape:\n${JSON.stringify(EXTRACTION_SCHEMA, null, 2)}\n\nReturn JSON only.` },
        ],
      },
    ],
  });
  return parseJson(msg.content.find((c) => c.type === 'text')?.text || '');
}

// Second pass: show the model its own extraction + the image again, ask it to
// double-check rare CJK characters and email spelling. Returns the corrected card.
async function verifyPass(card, imageBuffer, mimeType) {
  const base64 = imageBuffer.toString('base64');
  const prompt = `You previously extracted the following from this business card:

${JSON.stringify(card, null, 2)}

Look at the image again. CHECK CAREFULLY:
1. The Chinese name — are the character strokes exactly as shown? Common errors: 寧↔爁↔甯, 傑↔杰, 強↔彊. If the email local-part is "grace.wu", the surname is almost certainly 吳 (not 伍/武).
2. The email address — every character, including domain TLD (.ai vs .al, .com vs .corn).
3. The phone number digits.
4. Any field you marked with confidence < 0.9 — look extra carefully.

Return the CORRECTED card in the same JSON shape. If everything is correct, return the same data. If you changed anything, include a "corrections" array listing which fields you fixed and why. Return JSON only.`;

  const msg = await client.messages.create({
    model: VERIFY_MODEL,
    max_tokens: 1024,
    messages: [
      {
        role: 'user',
        content: [
          { type: 'image', source: { type: 'base64', media_type: mimeType, data: base64 } },
          { type: 'text', text: prompt },
        ],
      },
    ],
  });
  return parseJson(msg.content.find((c) => c.type === 'text')?.text || '');
}

export async function extractCard(imageBuffer, mimeType = 'image/jpeg') {
  const first = await firstPassExtract(imageBuffer, mimeType);
  // Skip the second self-verification pass when CLAUDE_SKIP_VERIFY=true.
  // Useful for daily / visit modes where the operator reviews every card
  // anyway, and ~2× speed is worth more than the marginal accuracy gain.
  if (process.env.CLAUDE_SKIP_VERIFY === 'true') {
    return first;
  }
  try {
    const verified = await verifyPass(first, imageBuffer, mimeType);
    if (verified.corrections?.length) {
      console.log('[OCR] Verify pass made corrections:', verified.corrections);
    }
    return verified;
  } catch (e) {
    console.warn('[OCR] Verify pass failed, using first-pass result:', e.message);
    return first;
  }
}

// Generate a warm, non-salesy greeting email customized to the visitor's role.
export async function generateGreeting(card, context) {
  const prompt = `You are writing a short, warm greeting email on behalf of ${context.boothOwnerName} (${context.boothOwnerTitle}) from ${context.boothCompany}, who just met ${card.name_zh || card.name_en} at ${context.eventName}.

Recipient:
- Name: ${card.name_zh || card.name_en}
- Company: ${card.company}
- Title: ${card.title}
- Role category: ${card.role_category}

Requirements:
- Language: Traditional Chinese (zh-TW). If the recipient's name is clearly Western-only, use English instead.
- Tone: warm, personal, NOT salesy. Feels like a human wrote it after a real conversation.
- 1 short paragraph greeting + 1 short paragraph offering a concrete next step relevant to their role (e.g., for an executive: a 20-min chat; for engineering: a technical demo; for sales/marketing: a case study).
- No emojis. No exclamation spam. Keep it under 120 words.
- Return JSON: {"subject": "...", "body_text": "..."}. body_text uses real newlines, no HTML.`;

  const msg = await client.messages.create({
    model: GREETING_MODEL,
    max_tokens: 800,
    messages: [{ role: 'user', content: prompt }],
  });

  const text = msg.content.find((c) => c.type === 'text')?.text || '';
  const cleaned = text.trim().replace(/^```json\s*/i, '').replace(/```$/, '').trim();
  return JSON.parse(cleaned);
}
