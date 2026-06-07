/**
 * MU-VERSE Content Factory — Phase 1
 *
 * Generates video scripts + scene JSON for short-form astrology content.
 * Output: script, voiceover, scene breakdown, caption, hashtags, CTA.
 *
 * Usage:
 *   npm run content                           # Generate all pending topics
 *   npm run content -- --topic=daily_aries_2026_06_08  # Single topic
 *   npm run content -- --zodiac=Aries --type=daily_horoscope  # Quick generate
 *   npm run content -- --list                 # List pending topics
 *
 * Requires .env with ANTHROPIC_API_KEY.
 */

import Anthropic from '@anthropic-ai/sdk';
import { readFileSync, writeFileSync, mkdirSync, existsSync } from 'fs';
import { dirname, join } from 'path';
import { fileURLToPath } from 'url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const OUTPUT_DIR = join(__dirname, 'content-output');
const CALENDAR_PATH = join(__dirname, 'content-calendar.json');

// ─── CLI Args ──────────────────────────────────────────────────────────────────

const args = process.argv.slice(2);
const topicFlag  = args.find(a => a.startsWith('--topic='))?.split('=')[1];
const zodiacFlag = args.find(a => a.startsWith('--zodiac='))?.split('=')[1];
const typeFlag   = args.find(a => a.startsWith('--type='))?.split('=')[1];
const platformFlag = args.find(a => a.startsWith('--platform='))?.split('=')[1] ?? 'tiktok';
const durationFlag = parseInt(args.find(a => a.startsWith('--duration='))?.split('=')[1] ?? '45');
const listFlag   = args.includes('--list');
const allFlag    = args.includes('--all');

// ─── Anthropic Init ────────────────────────────────────────────────────────────

const apiKey = process.env.ANTHROPIC_API_KEY;
if (!apiKey && !listFlag) {
  console.error('Missing ANTHROPIC_API_KEY in .env');
  process.exit(1);
}
const client = listFlag ? null : new Anthropic({ apiKey });

// ─── Constants ─────────────────────────────────────────────────────────────────

const ZODIAC_TH = {
  Aries: 'เมษ', Taurus: 'พฤษภ', Gemini: 'เมถุน', Cancer: 'กรกฎ',
  Leo: 'สิงห์', Virgo: 'กันย์', Libra: 'ตุลย์', Scorpio: 'พิจิก',
  Sagittarius: 'ธนู', Capricorn: 'มังกร', Aquarius: 'กุมภ์', Pisces: 'มีน',
};

const CONTENT_TYPES = {
  daily_horoscope: 'ดวงรายวัน',
  love_reading: 'ดวงความรัก',
  money_reading: 'ดวงการเงิน',
  career_reading: 'ดวงการงาน',
  lucky_color: 'สีมงคลประจำวัน',
  tarot_pick_a_card: 'เลือกไพ่ทาโรต์',
  warning_message: 'สัญญาณเตือน',
  manifestation: 'ดึงดูดสิ่งดี',
};

const today = new Date().toISOString().slice(0, 10);

// ─── Load Calendar ─────────────────────────────────────────────────────────────

function loadCalendar() {
  if (!existsSync(CALENDAR_PATH)) return { topics: [], brand_voice: null, hook_styles: null };
  return JSON.parse(readFileSync(CALENDAR_PATH, 'utf-8'));
}

// ─── System Prompt ─────────────────────────────────────────────────────────────

function buildSystemPrompt(brandVoice) {
  return `คุณคือ Content Scriptwriter ของ "ดูดวง by Prinnie" แอปดูดวงที่สวยที่สุดในไทย

สไตล์การเขียน — สำคัญมาก:
- เขียนเหมือนหมอดูนั่งเล่าให้ฟังแบบสบายๆ ไม่ใช่แนวลึกลับ dramatic
- ห้ามใช้ภาษาแบบละครหรือลิเก ห้ามใช้คำฟุ่มเฟือย ห้ามเขียนเว่อร์
- พูดตรงๆ เข้าใจง่าย เหมือนคุยกับเพื่อน แต่มีความรู้เรื่องดวง
- ใช้คำพูดแบบคนไทยจริงๆ เช่น "นะ", "ค่ะ/ครับ", "อ่ะ", "เนอะ"
- ตัวอย่างโทน: "ชาวเมษช่วงนี้นะ ดาวศุกร์มาอยู่ตรงนี้ ก็เลยทำให้เรื่องความรักมันดีขึ้นมาหน่อย"
- ห้ามเขียนแนว: "พลังจักรวาลอันยิ่งใหญ่กำลังส่องแสงประกายสู่ดวงชะตา" ← แนวนี้ห้ามเด็ดขาด

กฎเหล็ก:
- เขียนภาษาไทยทั้งหมด ยกเว้น hashtag ที่เป็นภาษาอังกฤษได้
- ห้ามทำนายแนวขู่ ห้ามเคลมผลลัพธ์ 100% ห้ามพูดเรื่องสุขภาพ/ความตายแรงเกิน
- ห้ามใช้คำว่า: ${brandVoice?.forbidden_words?.join(', ') || 'ซวย, ตาย, หายนะ, แน่นอน100%, การันตี'}
- Hook 3 วินาทีแรกต้องน่าสนใจ แต่ไม่ต้องเว่อร์ พูดตรงๆ
- CTA ท้ายคลิปต้องพาคนเข้าแอป MU-VERSE แต่พูดแบบธรรมชาติ
- แต่ละ Scene ควรยาว 3-8 วินาที
- Visual prompt ต้องเป็นภาษาอังกฤษ สไตล์ mystical, cinematic, vertical video
- Caption ต้องสั้น อ่านง่าย ไม่เกิน 2 บรรทัดต่อ scene

สีแบรนด์: navy #0B1026, gold #E8C77A — ใส่ใน visual prompt ทุก scene`;
}

// ─── User Prompt ───────────────────────────────────────────────────────────────

function buildUserPrompt(topic) {
  const zodiacTh = ZODIAC_TH[topic.zodiac_sign] || topic.zodiac_sign;
  const typeTh = CONTENT_TYPES[topic.content_type] || topic.content_type;

  const hookInstruction = {
    question: 'เริ่มด้วยคำถามที่ทำให้คนหยุดดู เช่น "ชาว{ราศี}รู้ไหมว่าวันนี้..."',
    revelation: 'เริ่มด้วยการเฉลยข้อมูลที่น่าตกใจ เช่น "สิ่งที่ชาว{ราศี}ไม่เคยรู้..."',
    warning: 'เริ่มด้วยสัญญาณเตือนแบบไม่ขู่ เช่น "ชาว{ราศี}ต้องระวังเรื่องนี้..."',
    challenge: 'เริ่มด้วยการท้าให้ลอง เช่น "ถ้าคุณเป็นชาว{ราศี} ลองเลือกตัวเลข..."',
    story: 'เริ่มด้วยเรื่องเล่าสั้น เช่น "เมื่อวานมีคนราศี{ราศี}มาถามว่า..."',
  };

  const hookStyle = hookInstruction[topic.hook_style] || hookInstruction.question;

  return `สร้างสคริปต์คลิปสั้นให้หน่อย:

ราศี: ${topic.zodiac_sign} (${zodiacTh})
ประเภท: ${typeTh} (${topic.content_type})
แพลตฟอร์ม: ${topic.platform}
ความยาว: ${topic.duration} วินาที
อารมณ์: ${topic.mood || 'mystical'}
สไตล์ Hook: ${hookStyle.replace('{ราศี}', zodiacTh)}
CTA: ${topic.cta || 'เปิดแอป MU-VERSE รับเครดิตฟรี ดูดวงเฉพาะคุณ'}
วันที่: ${today}

ตอบเป็น JSON เท่านั้น ไม่ต้องมี markdown fence ตามโครงสร้างนี้:

{
  "video_id": "${topic.topic_id || topic.content_type + '_' + topic.zodiac_sign + '_' + today.replace(/-/g, '_')}",
  "platform": "${topic.platform}",
  "zodiac_sign": "${topic.zodiac_sign}",
  "content_type": "${topic.content_type}",
  "duration": ${topic.duration},
  "date": "${today}",
  "script_text": "สคริปต์เต็มทั้งหมดรวมกัน",
  "voiceover_text": "ข้อความสำหรับพากย์เสียง (เหมือน script_text แต่ตัดคำสั่งภาพออก)",
  "caption": "Caption สั้นๆ สำหรับโพสต์ ไม่เกิน 150 ตัวอักษร",
  "hashtags": ["#ดูดวง", "#ราศีเมษ", "#tarot", "#muverse", ...อีก 3-5 อัน],
  "cta": "CTA ท้ายคลิป",
  "scenes": [
    {
      "scene": 1,
      "type": "hook",
      "duration": 3,
      "voice": "ข้อความพากย์เสียง scene นี้",
      "visual_prompt": "English prompt for AI video generation, mystical style, navy #0B1026 and gold #E8C77A, vertical 9:16, cinematic",
      "caption_text": "ข้อความ caption บน screen"
    },
    {
      "scene": 2,
      "type": "content",
      "duration": 5,
      "voice": "...",
      "visual_prompt": "...",
      "caption_text": "..."
    }
  ]
}

scene type ควรเป็น: "hook" (3-4 วิ), "content" (5-8 วิ), "transition" (2-3 วิ), "cta" (3-5 วิ)
สำคัญมาก: ผลรวม duration ทุก scene ต้อง = ${topic.duration} วินาทีพอดี (ไม่มากไม่น้อย)
ถ้า ${topic.duration} วิ ต้องมีอย่างน้อย ${Math.max(5, Math.floor(topic.duration / 7))} scenes
visual_prompt ต้องเป็นภาษาอังกฤษเท่านั้น มี style: cinematic, mystical, vertical 9:16 ratio
ทุก visual_prompt ต้องมี brand colors: deep navy #0B1026 background, gold #E8C77A accents`;
}

// ─── Generate Script ───────────────────────────────────────────────────────────

async function generateScript(topic, brandVoice) {
  const systemPrompt = buildSystemPrompt(brandVoice);
  const userPrompt = buildUserPrompt(topic);

  const response = await client.messages.create({
    model: 'claude-haiku-4-5-20251001',
    max_tokens: 4096,
    temperature: 0.9,
    system: systemPrompt,
    messages: [{ role: 'user', content: userPrompt }],
  });

  const rawText = response.content[0]?.text ?? '';
  const cleaned = rawText.replace(/^```(?:json)?\s*/i, '').replace(/\s*```$/i, '').trim();
  return JSON.parse(cleaned);
}

// ─── Validate Output ───────────────────────────────────────────────────────────

function validateScript(data) {
  const required = ['video_id', 'platform', 'script_text', 'voiceover_text', 'caption', 'hashtags', 'scenes'];
  for (const field of required) {
    if (!data[field]) throw new Error(`Missing field: ${field}`);
  }
  if (!Array.isArray(data.scenes) || data.scenes.length === 0) {
    throw new Error('scenes must be a non-empty array');
  }

  let totalDuration = 0;
  for (const scene of data.scenes) {
    if (!scene.voice || !scene.visual_prompt) {
      throw new Error(`Scene ${scene.scene} missing voice or visual_prompt`);
    }
    totalDuration += scene.duration || 0;
  }

  if (data.duration && Math.abs(totalDuration - data.duration) > 5) {
    console.warn(`  WARNING: total scene duration (${totalDuration}s) differs from target (${data.duration}s)`);
  }

  const forbidden = ['ซวย', 'ตาย', 'หายนะ', 'แน่นอน100%', 'การันตี'];
  const fullText = data.script_text + data.voiceover_text + data.caption;
  for (const word of forbidden) {
    if (fullText.includes(word)) {
      throw new Error(`Forbidden word found: "${word}"`);
    }
  }

  return { totalDuration, sceneCount: data.scenes.length };
}

// ─── Save Output ───────────────────────────────────────────────────────────────

function saveOutput(data) {
  mkdirSync(OUTPUT_DIR, { recursive: true });
  const filename = `${data.video_id}.json`;
  const filepath = join(OUTPUT_DIR, filename);
  writeFileSync(filepath, JSON.stringify(data, null, 2), 'utf-8');
  return filepath;
}

// ─── Print Preview ─────────────────────────────────────────────────────────────

function printPreview(data, stats) {
  console.log(`\n  Video ID:    ${data.video_id}`);
  console.log(`  Platform:    ${data.platform}`);
  console.log(`  Zodiac:      ${data.zodiac_sign}`);
  console.log(`  Type:        ${data.content_type}`);
  console.log(`  Scenes:      ${stats.sceneCount} scenes, ${stats.totalDuration}s total`);
  console.log(`  Caption:     ${data.caption.slice(0, 80)}...`);
  console.log(`  Hashtags:    ${data.hashtags.join(' ')}`);
  console.log(`  CTA:         ${data.cta}`);
  console.log('');
  console.log('  Scene breakdown:');
  for (const s of data.scenes) {
    const typeLabel = `[${s.type}]`.padEnd(14);
    console.log(`    ${s.scene}. ${typeLabel} ${s.duration}s  ${s.voice.slice(0, 50)}...`);
  }
}

// ─── Main ──────────────────────────────────────────────────────────────────────

async function main() {
  console.log('\nMU-VERSE Content Factory');
  console.log(`  Date: ${today}\n`);

  const calendar = loadCalendar();
  let topics = [];

  if (listFlag) {
    console.log('Pending topics in content-calendar.json:\n');
    const pending = calendar.topics.filter(t => t.status === 'pending');
    if (pending.length === 0) {
      console.log('  (none)\n');
    } else {
      for (const t of pending) {
        console.log(`  - ${t.topic_id}  [${t.zodiac_sign}] ${t.content_type} (${t.platform}, ${t.duration}s)`);
      }
      console.log(`\n  Total: ${pending.length} pending\n`);
    }
    return;
  }

  if (topicFlag) {
    const found = calendar.topics.find(t => t.topic_id === topicFlag);
    if (!found) {
      console.error(`Topic not found: ${topicFlag}`);
      process.exit(1);
    }
    topics = [found];
  } else if (zodiacFlag && typeFlag) {
    topics = [{
      topic_id: `${typeFlag}_${zodiacFlag.toLowerCase()}_${today.replace(/-/g, '_')}`,
      zodiac_sign: zodiacFlag,
      content_type: typeFlag,
      platform: platformFlag,
      duration: durationFlag,
      mood: 'mystical',
      hook_style: 'question',
      cta: 'เปิดแอป MU-VERSE รับเครดิตฟรี ดูดวงเฉพาะคุณ',
      status: 'pending',
    }];
  } else if (allFlag) {
    topics = calendar.topics.filter(t => t.status === 'pending');
  } else {
    topics = calendar.topics.filter(t => t.status === 'pending').slice(0, 1);
    if (topics.length === 0) {
      console.log('No pending topics. Use --zodiac=Aries --type=daily_horoscope for quick generate.\n');
      return;
    }
  }

  console.log(`  Topics to generate: ${topics.length}\n`);

  let success = 0;
  let failed = 0;

  for (const topic of topics) {
    const label = `${topic.zodiac_sign} / ${topic.content_type}`;
    console.log(`--- Generating: ${label} ---`);

    try {
      const startMs = Date.now();
      const data = await generateScript(topic, calendar.brand_voice);
      const elapsed = ((Date.now() - startMs) / 1000).toFixed(1);
      console.log(`  Claude responded in ${elapsed}s`);

      const stats = validateScript(data);
      console.log(`  Validated OK`);

      const filepath = saveOutput(data);
      console.log(`  Saved: ${filepath}`);

      printPreview(data, stats);
      success++;
    } catch (err) {
      console.error(`  FAILED: ${err.message}`);
      failed++;
    }
  }

  console.log('\n--- Summary ---');
  console.log(`  Success: ${success}`);
  console.log(`  Failed:  ${failed}`);
  console.log(`  Output:  ${OUTPUT_DIR}/\n`);

  if (success > 0) {
    console.log('Next steps:');
    console.log('  1. Review scripts in content-output/');
    console.log('  2. Send voiceover_text to ElevenLabs');
    console.log('  3. Use visual_prompts for video generation');
    console.log('  4. Merge with FFmpeg');
    console.log('  5. Human approve before posting\n');
  }
}

main().catch(err => {
  console.error('Unexpected error:', err);
  process.exit(1);
});
