/**
 * QA Agent — reviews script for quality, brand safety, and platform compliance
 *
 * Uses Claude API to check:
 * - No fear-based predictions
 * - No health/death claims
 * - Brand voice consistency
 * - CTA present and clear
 * - Script length matches duration
 * - Thai language quality
 */

import Anthropic from '@anthropic-ai/sdk';

export async function reviewScript(scriptData, options = {}) {
  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) throw new Error('Missing ANTHROPIC_API_KEY');

  const client = new Anthropic({ apiKey });

  const systemPrompt = `คุณคือ QA Agent ของ "ดูดวง by Prinnie" ทำหน้าที่ตรวจสอบสคริปต์คลิปดูดวงก่อนผลิต

ตรวจสอบ 8 ข้อนี้ ให้คะแนนแต่ละข้อ PASS / WARN / FAIL:

1. SAFETY: ไม่มีคำขู่, ไม่เคลม 100%, ไม่พูดเรื่องสุขภาพ/ความตายแรง
2. BRAND_VOICE: น้ำเสียงอบอุ่น ลึกลับ ให้กำลังใจ เหมือนพี่สาวดูดวง
3. HOOK: 3 วินาทีแรกดึงดูดพอให้คนหยุดเลื่อน
4. CTA: มี CTA ท้ายคลิปที่โยงกลับแอป MU-VERSE
5. DURATION: จำนวน scene และความยาวเหมาะสมกับ platform
6. THAI_QUALITY: ภาษาไทยเป็นธรรมชาติ ไม่มีคำผิด ไม่แปลจากอังกฤษ
7. VISUAL_PROMPTS: prompt ภาพสอดคล้องกับเนื้อหา มี brand colors
8. PLATFORM_SAFE: ไม่มีเนื้อหาที่ platform จะลด reach (เคลมเกิน, clickbait แรง)

ตอบเป็น JSON เท่านั้น:
{
  "overall": "APPROVE" | "REVIEW" | "REJECT",
  "confidence": 0-100,
  "checks": {
    "safety": { "status": "PASS|WARN|FAIL", "note": "..." },
    "brand_voice": { "status": "PASS|WARN|FAIL", "note": "..." },
    ...ทุกข้อ
  },
  "issues": ["ปัญหาที่พบ ถ้ามี"],
  "suggestions": ["ข้อเสนอแนะ ถ้ามี"]
}

ถ้ามี FAIL แม้แต่ 1 ข้อ → overall = REJECT
ถ้ามี WARN 2 ข้อขึ้นไป → overall = REVIEW
นอกนั้น → overall = APPROVE`;

  const scriptSummary = {
    video_id: scriptData.video_id,
    zodiac_sign: scriptData.zodiac_sign,
    content_type: scriptData.content_type,
    platform: scriptData.platform,
    duration: scriptData.duration,
    script_text: scriptData.script_text,
    voiceover_text: scriptData.voiceover_text,
    caption: scriptData.caption,
    cta: scriptData.cta,
    scenes: scriptData.scenes?.map(s => ({
      scene: s.scene, type: s.type, duration: s.duration,
      voice: s.voice, caption_text: s.caption_text,
      visual_prompt: s.visual_prompt?.slice(0, 100),
    })),
  };

  let lastError;
  for (let attempt = 0; attempt < 2; attempt++) {
    const response = await client.messages.create({
      model: 'claude-haiku-4-5-20251001',
      max_tokens: 2048,
      temperature: 0,
      system: systemPrompt,
      messages: [{
        role: 'user',
        content: `ตรวจสอบสคริปต์นี้ ตอบเป็น JSON เท่านั้น ห้ามมี markdown fence:\n\n${JSON.stringify(scriptSummary, null, 2)}`,
      }],
    });

    const rawText = response.content[0]?.text ?? '';
    const jsonMatch = rawText.match(/\{[\s\S]*\}/);
    if (!jsonMatch) {
      lastError = rawText;
      continue;
    }

    try {
      return JSON.parse(jsonMatch[0]);
    } catch {
      lastError = rawText;
    }
  }

  return {
    overall: 'REVIEW',
    confidence: 50,
    checks: {},
    issues: ['QA Agent response could not be parsed after 2 attempts'],
    suggestions: [],
    raw: lastError,
  };
}
