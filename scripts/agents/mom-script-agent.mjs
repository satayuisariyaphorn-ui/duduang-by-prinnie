/**
 * Mom Script Agent — takes mom's raw text and converts it to scene JSON
 *
 * Mom writes the script, AI only does:
 * - Split into scenes (3-8 seconds each)
 * - Generate visual prompts per scene
 * - Generate caption text per scene
 * - Generate post caption + hashtags
 */

import Anthropic from '@anthropic-ai/sdk';

export async function processMotherScript({ text, zodiacSign, contentType, platform, duration }) {
  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) throw new Error('Missing ANTHROPIC_API_KEY');

  const client = new Anthropic({ apiKey });

  const zodiac = zodiacSign || detectZodiac(text);
  const type = contentType || 'daily_horoscope';
  const dur = duration || estimateDuration(text);
  const plat = platform || 'tiktok';
  const today = new Date().toISOString().slice(0, 10);

  const systemPrompt = `คุณคือ Scene Director ของ "ดูดวง by Prinnie"

หน้าที่ของคุณ:
- รับสคริปต์ที่แม่ (Prinnie) เขียนมาแล้ว ห้ามแก้เนื้อหา ห้ามเปลี่ยนคำพูด
- แบ่งสคริปต์เป็น scene (แต่ละ scene 3-8 วินาที)
- สร้าง visual prompt ภาษาอังกฤษสำหรับแต่ละ scene
- สร้าง caption สั้นๆ สำหรับแต่ละ scene
- สร้าง caption โพสต์ + hashtags

กฎ:
- ห้ามแก้ไขคำพูดของแม่เด็ดขาด ใช้คำของแม่ทุกคำ
- visual prompt ต้องเป็นภาษาอังกฤษ เขียนเป็นประโยคอธิบายภาพที่ต้องการ
- ภาพต้องเป็นวิวธรรมชาติสวยๆ ที่เข้ากับอารมณ์ของเนื้อหา ห้ามเป็นภาพมู/แฟนตาซี/ลิเก
- ห้ามมีคน ห้ามมีหน้า ห้ามมีมือ ห้ามมีตัวอักษร
- เลือกวิวให้ตรงกับอารมณ์:
  - เรื่องดีๆ/โชคลาภ → ทุ่งดอกไม้สวย ท้องฟ้าสดใส พระอาทิตย์ขึ้น ทะเลสงบ
  - ระวัง/ช่วงยาก → ท้องฟ้าครึ้ม หมอกบนภูเขา ทะเลคลื่น ป่าทึบ
  - ความรัก → ทะเลยามเย็น ดอกไม้บาน แสงจันทร์บนน้ำ
  - การงาน/เติบโต → ภูเขาสูง ทุ่งกว้าง ทางเดินในป่า แม่น้ำ
  - ทั่วไป → วิวสวยๆ ทะเล ภูเขา ท้องฟ้า น้ำตก ฯลฯ
- style: เหมือนรูปถ่ายจริงคุณภาพสูง National Geographic / Apple wallpaper
- scene แรกเป็น hook, scene สุดท้ายเป็น cta (ถ้าแม่มี CTA), ที่เหลือเป็น content`;

  const userPrompt = `แม่เขียนสคริปต์มาให้แบบนี้:

"${text}"

ราศี: ${zodiac || 'ไม่ระบุ'}
ประเภท: ${type}
แพลตฟอร์ม: ${plat}
วันที่: ${today}

แบ่งเป็น scene แล้วตอบเป็น JSON เท่านั้น ห้ามมี markdown fence:
{
  "video_id": "${type}_${(zodiac || 'general').toLowerCase()}_${today.replace(/-/g, '_')}",
  "platform": "${plat}",
  "zodiac_sign": "${zodiac || 'general'}",
  "content_type": "${type}",
  "duration": <ผลรวม duration ทุก scene>,
  "date": "${today}",
  "script_text": "<สคริปต์เต็มของแม่ ห้ามแก้>",
  "voiceover_text": "<สคริปต์เต็มของแม่ ห้ามแก้>",
  "caption": "<caption โพสต์ ไม่เกิน 150 ตัวอักษร>",
  "hashtags": ["#ดูดวง", "#ดูดวงbyPrinnie", "#muverse", ...],
  "cta": "<CTA ถ้ามีในสคริปต์>",
  "scenes": [
    {
      "scene": 1,
      "type": "hook",
      "duration": <3-8>,
      "voice": "<คำพูดของแม่ใน scene นี้ ห้ามแก้>",
      "visual_prompt": "English prompt, mystical, navy #0B1026, gold #E8C77A, 9:16 vertical, cinematic",
      "caption_text": "<caption สั้นบนจอ>"
    }
  ]
}`;

  const response = await client.messages.create({
    model: 'claude-haiku-4-5-20251001',
    max_tokens: 4096,
    temperature: 0.3,
    system: systemPrompt,
    messages: [{ role: 'user', content: userPrompt }],
  });

  const rawText = response.content[0]?.text ?? '';
  const jsonMatch = rawText.match(/\{[\s\S]*\}/);
  if (!jsonMatch) throw new Error('No JSON in response');
  return JSON.parse(jsonMatch[0]);
}

const ZODIAC_KEYWORDS = {
  Aries: ['เมษ', 'aries'],
  Taurus: ['พฤษภ', 'taurus'],
  Gemini: ['เมถุน', 'gemini'],
  Cancer: ['กรกฎ', 'cancer'],
  Leo: ['สิงห์', 'leo'],
  Virgo: ['กันย์', 'virgo'],
  Libra: ['ตุลย์', 'ตุล', 'libra'],
  Scorpio: ['พิจิก', 'scorpio'],
  Sagittarius: ['ธนู', 'sagittarius'],
  Capricorn: ['มังกร', 'capricorn'],
  Aquarius: ['กุมภ์', 'aquarius'],
  Pisces: ['มีน', 'pisces'],
};

export function detectZodiac(text) {
  const lower = text.toLowerCase();
  for (const [sign, keywords] of Object.entries(ZODIAC_KEYWORDS)) {
    for (const kw of keywords) {
      if (lower.includes(kw.toLowerCase())) return sign;
    }
  }
  return null;
}

function estimateDuration(text) {
  const thaiChars = text.replace(/[^ก-๙a-zA-Z]/g, '').length;
  const wordsPerSecond = 4;
  const estimated = Math.ceil(thaiChars / (wordsPerSecond * 3));
  return Math.max(20, Math.min(60, estimated));
}
