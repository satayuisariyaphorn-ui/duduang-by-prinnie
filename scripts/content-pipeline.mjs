/**
 * MU-VERSE Content Pipeline — Full AI Agent Orchestrator
 *
 * Chains all agents together:
 *   1. Script Agent    → generates script + scene JSON (content-factory)
 *   2. QA Agent        → reviews script for safety & quality
 *   3. Voice Agent     → generates Thai voiceover (Edge TTS)
 *   4. Video Agent     → generates placeholder scene videos (FFmpeg)
 *   5. Caption Agent   → generates SRT subtitles
 *   6. Assembly Agent  → merges everything into final MP4
 *   7. Human Approve   → shows result, waits for approval
 *
 * Usage:
 *   npm run pipeline                                      # first pending topic
 *   npm run pipeline -- --zodiac=Aries --type=love_reading # quick generate
 *   npm run pipeline -- --topic=daily_aries_2026_06_08     # specific topic
 *   npm run pipeline -- --skip-approve                     # skip human step
 *
 * Requires .env with ANTHROPIC_API_KEY
 */

import Anthropic from '@anthropic-ai/sdk';
import { readFileSync, writeFileSync, mkdirSync, existsSync } from 'fs';
import { dirname, join } from 'path';
import { fileURLToPath } from 'url';
import { createInterface } from 'readline';

import { generateSceneVoices } from './agents/voice-agent.mjs';
import { generateAllSceneVideos } from './agents/video-agent.mjs';
import { generateSRT } from './agents/caption-agent.mjs';
import { reviewScript } from './agents/qa-agent.mjs';
import { assembleVideo } from './agents/assembly-agent.mjs';

const __dirname = dirname(fileURLToPath(import.meta.url));
const CALENDAR_PATH = join(__dirname, 'content-calendar.json');
const OUTPUT_BASE = join(__dirname, 'pipeline-output');

// ─── CLI Args ──────────────────────────────────────────────────────────────────

const args = process.argv.slice(2);
const topicFlag    = args.find(a => a.startsWith('--topic='))?.split('=')[1];
const zodiacFlag   = args.find(a => a.startsWith('--zodiac='))?.split('=')[1];
const typeFlag     = args.find(a => a.startsWith('--type='))?.split('=')[1];
const platformFlag = args.find(a => a.startsWith('--platform='))?.split('=')[1] ?? 'tiktok';
const durationFlag = parseInt(args.find(a => a.startsWith('--duration='))?.split('=')[1] ?? '45');
const skipApprove  = args.includes('--skip-approve');

// ─── Constants ─────────────────────────────────────────────────────────────────

const ZODIAC_TH = {
  Aries: 'เมษ', Taurus: 'พฤษภ', Gemini: 'เมถุน', Cancer: 'กรกฎ',
  Leo: 'สิงห์', Virgo: 'กันย์', Libra: 'ตุลย์', Scorpio: 'พิจิก',
  Sagittarius: 'ธนู', Capricorn: 'มังกร', Aquarius: 'กุมภ์', Pisces: 'มีน',
};

const CONTENT_TYPES = {
  daily_horoscope: 'ดวงรายวัน', love_reading: 'ดวงความรัก',
  money_reading: 'ดวงการเงิน', career_reading: 'ดวงการงาน',
  tarot_pick_a_card: 'เลือกไพ่ทาโรต์', warning_message: 'สัญญาณเตือน',
  manifestation: 'ดึงดูดสิ่งดี', lucky_color: 'สีมงคล',
};

const today = new Date().toISOString().slice(0, 10);

// ─── Helpers ───────────────────────────────────────────────────────────────────

function askUser(question) {
  const rl = createInterface({ input: process.stdin, output: process.stdout });
  return new Promise(resolve => {
    rl.question(question, answer => {
      rl.close();
      resolve(answer.trim().toLowerCase());
    });
  });
}

function printBox(title, content) {
  const line = '─'.repeat(60);
  console.log(`\n┌${line}┐`);
  console.log(`│ ${title.padEnd(58)} │`);
  console.log(`├${line}┤`);
  for (const row of content) {
    const text = row.slice(0, 58);
    console.log(`│ ${text.padEnd(58)} │`);
  }
  console.log(`└${line}┘`);
}

function statusIcon(status) {
  if (status === 'PASS') return 'PASS';
  if (status === 'WARN') return 'WARN';
  return 'FAIL';
}

// ─── Step 1: Script Generation ─────────────────────────────────────────────────

async function generateScript(topic, brandVoice) {
  const client = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });
  const zodiacTh = ZODIAC_TH[topic.zodiac_sign] || topic.zodiac_sign;
  const typeTh = CONTENT_TYPES[topic.content_type] || topic.content_type;

  const hookInstructions = {
    question: 'เริ่มด้วยคำถามที่ทำให้คนหยุดดู',
    revelation: 'เริ่มด้วยการเฉลยข้อมูลที่น่าตกใจ',
    warning: 'เริ่มด้วยสัญญาณเตือนแบบไม่ขู่',
    challenge: 'เริ่มด้วยการท้าให้ลอง',
    story: 'เริ่มด้วยเรื่องเล่าสั้น',
  };

  const systemPrompt = `คุณคือ Content Scriptwriter ของ "ดูดวง by Prinnie" แอปดูดวงที่สวยที่สุดในไทย

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
- Hook 3 วินาทีแรกต้องน่าสนใจ แต่ไม่ต้องเว่อร์ พูดตรงๆ ว่าวันนี้มีอะไร
- CTA ท้ายคลิปต้องพาคนเข้าแอป MU-VERSE แต่พูดแบบธรรมชาติ ไม่ใช่โฆษณา
- แต่ละ Scene ควรยาว 3-8 วินาที
- Visual prompt ต้องเป็นภาษาอังกฤษ สไตล์ mystical, cinematic, vertical video
- สีแบรนด์: navy #0B1026, gold #E8C77A`;

  const userPrompt = `สร้างสคริปต์คลิปสั้น:

ราศี: ${topic.zodiac_sign} (${zodiacTh})
ประเภท: ${typeTh}
แพลตฟอร์ม: ${topic.platform}
ความยาว: ${topic.duration} วินาที
อารมณ์: ${topic.mood || 'mystical'}
สไตล์ Hook: ${hookInstructions[topic.hook_style] || hookInstructions.question}
CTA: ${topic.cta || 'เปิดแอป MU-VERSE รับเครดิตฟรี ดูดวงเฉพาะคุณ'}
วันที่: ${today}

ตอบเป็น JSON เท่านั้น ไม่ต้องมี markdown fence:
{
  "video_id": "${topic.topic_id}",
  "platform": "${topic.platform}",
  "zodiac_sign": "${topic.zodiac_sign}",
  "content_type": "${topic.content_type}",
  "duration": ${topic.duration},
  "date": "${today}",
  "script_text": "สคริปต์เต็มรวมกัน",
  "voiceover_text": "ข้อความพากย์เสียง",
  "caption": "Caption โพสต์ ไม่เกิน 150 ตัวอักษร",
  "hashtags": ["#ดูดวง", "#ราศี${zodiacTh}", "#muverse", ...],
  "cta": "CTA ท้ายคลิป",
  "scenes": [
    { "scene": 1, "type": "hook", "duration": 3, "voice": "...", "visual_prompt": "English prompt, mystical, navy #0B1026, gold #E8C77A, 9:16 vertical", "caption_text": "..." }
  ]
}

สำคัญมาก: ผลรวม duration ทุก scene ต้อง = ${topic.duration} วินาทีพอดี
ต้องมีอย่างน้อย ${Math.max(5, Math.floor(topic.duration / 7))} scenes
scene type: "hook" (3-4 วิ), "content" (5-8 วิ), "transition" (2-3 วิ), "cta" (3-5 วิ)`;

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

// ─── Main Pipeline ─────────────────────────────────────────────────────────────

async function main() {
  console.log('\n╔══════════════════════════════════════════════════════════════╗');
  console.log('║          ดูดวง by Prinnie — Content Pipeline               ║');
  console.log('║          Full AI Agent Orchestrator                         ║');
  console.log('╚══════════════════════════════════════════════════════════════╝');
  console.log(`  Date: ${today}\n`);

  // ─── Resolve topic ───────────────────────────────────────────────────────
  let topic;
  const calendar = existsSync(CALENDAR_PATH)
    ? JSON.parse(readFileSync(CALENDAR_PATH, 'utf-8'))
    : { topics: [], brand_voice: null };

  if (topicFlag) {
    topic = calendar.topics.find(t => t.topic_id === topicFlag);
    if (!topic) { console.error(`Topic not found: ${topicFlag}`); process.exit(1); }
  } else if (zodiacFlag && typeFlag) {
    topic = {
      topic_id: `${typeFlag}_${zodiacFlag.toLowerCase()}_${today.replace(/-/g, '_')}`,
      zodiac_sign: zodiacFlag,
      content_type: typeFlag,
      platform: platformFlag,
      duration: durationFlag,
      mood: 'mystical',
      hook_style: 'question',
      cta: 'เปิดแอป MU-VERSE รับเครดิตฟรี ดูดวงเฉพาะคุณ',
    };
  } else {
    topic = calendar.topics.find(t => t.status === 'pending');
    if (!topic) {
      console.log('No pending topics. Use --zodiac=Leo --type=daily_horoscope');
      return;
    }
  }

  const jobId = topic.topic_id;
  const workDir = join(OUTPUT_BASE, jobId);
  mkdirSync(workDir, { recursive: true });

  console.log(`  Job:      ${jobId}`);
  console.log(`  Zodiac:   ${topic.zodiac_sign} (${ZODIAC_TH[topic.zodiac_sign] || '?'})`);
  console.log(`  Type:     ${topic.content_type}`);
  console.log(`  Platform: ${topic.platform}`);
  console.log(`  Duration: ${topic.duration}s\n`);

  const startTime = Date.now();
  const timing = {};

  // ═══ STEP 1: Script Agent ════════════════════════════════════════════════
  console.log('━━━ Step 1/7: Script Agent ━━━');
  let script;
  try {
    const t0 = Date.now();
    script = await generateScript(topic, calendar.brand_voice);
    timing.script = ((Date.now() - t0) / 1000).toFixed(1);
    console.log(`  Generated in ${timing.script}s`);
    console.log(`  Scenes: ${script.scenes?.length}`);
    const totalDur = script.scenes?.reduce((s, sc) => s + sc.duration, 0);
    console.log(`  Total duration: ${totalDur}s / target ${topic.duration}s`);

    writeFileSync(join(workDir, 'script.json'), JSON.stringify(script, null, 2));
    console.log('  Saved: script.json\n');
  } catch (err) {
    console.error(`  FAILED: ${err.message}`);
    process.exit(1);
  }

  // ═══ STEP 2: QA Agent ════════════════════════════════════════════════════
  console.log('━━━ Step 2/7: QA Agent ━━━');
  let qaResult;
  try {
    const t0 = Date.now();
    qaResult = await reviewScript(script);
    timing.qa = ((Date.now() - t0) / 1000).toFixed(1);

    const overallIcon = qaResult.overall === 'APPROVE' ? 'APPROVE'
      : qaResult.overall === 'REVIEW' ? 'REVIEW' : 'REJECT';
    console.log(`  Result: ${overallIcon} ${qaResult.overall} (confidence: ${qaResult.confidence}%)`);
    console.log(`  Reviewed in ${timing.qa}s`);

    if (qaResult.checks) {
      for (const [key, val] of Object.entries(qaResult.checks)) {
        console.log(`    ${statusIcon(val.status)} ${key}: ${val.note || ''}`);
      }
    }

    if (qaResult.issues?.length > 0) {
      console.log('  Issues:');
      qaResult.issues.forEach(i => console.log(`    - ${i}`));
    }
    if (qaResult.suggestions?.length > 0) {
      console.log('  Suggestions:');
      qaResult.suggestions.forEach(s => console.log(`    - ${s}`));
    }

    writeFileSync(join(workDir, 'qa-report.json'), JSON.stringify(qaResult, null, 2));
    console.log('  Saved: qa-report.json\n');

    if (qaResult.overall === 'REJECT') {
      console.log('  QA REJECTED this script. Fix issues and try again.');
      process.exit(1);
    }
  } catch (err) {
    console.error(`  QA error (non-blocking): ${err.message}\n`);
    qaResult = { overall: 'REVIEW', confidence: 0 };
  }

  // ═══ STEP 3: Voice Agent ═════════════════════════════════════════════════
  console.log('━━━ Step 3/7: Voice Agent (Edge TTS - Thai) ━━━');
  let voiceFiles;
  try {
    const t0 = Date.now();
    voiceFiles = await generateSceneVoices(script.scenes, workDir);
    timing.voice = ((Date.now() - t0) / 1000).toFixed(1);
    console.log(`  Generated ${voiceFiles.length} audio files in ${timing.voice}s\n`);
  } catch (err) {
    console.error(`  FAILED: ${err.message}`);
    process.exit(1);
  }

  // ═══ STEP 4: Video Agent ═════════════════════════════════════════════════
  console.log('━━━ Step 4/7: Video Agent (FFmpeg placeholder) ━━━');
  let videoFiles;
  try {
    const t0 = Date.now();
    videoFiles = await generateAllSceneVideos(script.scenes, workDir);
    timing.video = ((Date.now() - t0) / 1000).toFixed(1);
    console.log(`  Generated ${videoFiles.length} scene videos in ${timing.video}s\n`);
  } catch (err) {
    console.error(`  FAILED: ${err.message}`);
    process.exit(1);
  }

  // ═══ STEP 5: Caption Agent ═══════════════════════════════════════════════
  console.log('━━━ Step 5/7: Caption Agent ━━━');
  const srtContent = generateSRT(script.scenes);
  const srtPath = join(workDir, 'captions.srt');
  writeFileSync(srtPath, srtContent, 'utf-8');
  console.log('  Generated SRT subtitles');
  console.log(`  Saved: captions.srt\n`);

  // ═══ STEP 6: Assembly Agent ══════════════════════════════════════════════
  console.log('━━━ Step 6/7: Assembly Agent (FFmpeg merge) ━━━');
  const finalVideoPath = join(workDir, `${jobId}_final.mp4`);
  try {
    const t0 = Date.now();
    await assembleVideo({
      sceneVideos: videoFiles,
      sceneVoices: voiceFiles,
      srtPath: null,
      outputPath: finalVideoPath,
      workDir,
    });
    timing.assembly = ((Date.now() - t0) / 1000).toFixed(1);
    console.log(`  Assembled in ${timing.assembly}s\n`);
  } catch (err) {
    console.error(`  FAILED: ${err.message}`);
    console.log('  Continuing without final assembly...\n');
  }

  // ═══ STEP 7: Human Approve ═══════════════════════════════════════════════
  console.log('━━━ Step 7/7: Human Approval ━━━');

  printBox('SCRIPT PREVIEW', [
    `Video ID:  ${script.video_id}`,
    `Platform:  ${script.platform}`,
    `Zodiac:    ${script.zodiac_sign}`,
    `Type:      ${script.content_type}`,
    '',
    'VOICEOVER:',
    ...script.voiceover_text.match(/.{1,56}/g).map(l => `  ${l}`),
    '',
    'CAPTION:',
    `  ${script.caption}`,
    '',
    'CTA:',
    `  ${script.cta}`,
    '',
    `HASHTAGS: ${script.hashtags.join(' ')}`,
    '',
    `QA: ${qaResult.overall} (${qaResult.confidence}% confidence)`,
  ]);

  console.log('\n  Scene breakdown:');
  for (const s of script.scenes) {
    console.log(`    ${s.scene}. [${s.type}] ${s.duration}s`);
    console.log(`       Voice:   ${s.voice.slice(0, 50)}...`);
    console.log(`       Visual:  ${s.visual_prompt.slice(0, 50)}...`);
    console.log(`       Caption: ${s.caption_text}`);
  }

  console.log(`\n  Files in: ${workDir}/`);
  console.log('    - script.json');
  console.log('    - qa-report.json');
  console.log('    - captions.srt');
  console.log(`    - scene_*_voice.mp3 (x${voiceFiles.length})`);
  console.log(`    - scene_*_video.mp4 (x${videoFiles.length})`);
  if (existsSync(finalVideoPath)) {
    console.log(`    - ${jobId}_final.mp4`);
  }

  // ─── Timing summary ─────────────────────────────────────────────────────
  const totalTime = ((Date.now() - startTime) / 1000).toFixed(1);

  printBox('TIMING', [
    `Script Agent:   ${timing.script || '?'}s`,
    `QA Agent:       ${timing.qa || '?'}s`,
    `Voice Agent:    ${timing.voice || '?'}s`,
    `Video Agent:    ${timing.video || '?'}s`,
    `Assembly Agent: ${timing.assembly || '?'}s`,
    `Total:          ${totalTime}s`,
  ]);

  if (skipApprove) {
    console.log('\n  --skip-approve: Auto-approved\n');
    writeFileSync(join(workDir, 'status.json'), JSON.stringify({
      status: 'approved',
      approved_by: 'auto',
      approved_at: new Date().toISOString(),
    }, null, 2));
    return;
  }

  console.log('');
  const answer = await askUser('  Approve this content? (y/n/edit): ');

  if (answer === 'y' || answer === 'yes') {
    writeFileSync(join(workDir, 'status.json'), JSON.stringify({
      status: 'approved',
      approved_by: 'human',
      approved_at: new Date().toISOString(),
    }, null, 2));
    console.log('\n  APPROVED — ready for publishing');
    console.log('  Next: upload to TikTok/Reels/Shorts\n');
  } else if (answer === 'edit') {
    writeFileSync(join(workDir, 'status.json'), JSON.stringify({
      status: 'needs_edit',
      approved_at: new Date().toISOString(),
    }, null, 2));
    console.log('\n  NEEDS EDIT — modify script.json and re-run pipeline\n');
  } else {
    writeFileSync(join(workDir, 'status.json'), JSON.stringify({
      status: 'rejected',
      approved_at: new Date().toISOString(),
    }, null, 2));
    console.log('\n  REJECTED — discarded\n');
  }
}

main().catch(err => {
  console.error('Pipeline error:', err);
  process.exit(1);
});
