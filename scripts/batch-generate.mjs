/**
 * ดูดวง by Prinnie — Batch Generator
 *
 * Generates content for all 12 zodiac signs in one run.
 * Runs full pipeline per sign: Script → QA → Voice → Video → Caption → Assembly
 *
 * Usage:
 *   npm run batch                                    # daily_horoscope for all 12
 *   npm run batch -- --type=love_reading             # love reading for all 12
 *   npm run batch -- --type=daily_horoscope,love_reading  # multiple types
 *   npm run batch -- --signs=Aries,Leo,Pisces        # specific signs only
 *   npm run batch -- --duration=45                   # override duration
 */

import Anthropic from '@anthropic-ai/sdk';
import { readFileSync, writeFileSync, mkdirSync, existsSync } from 'fs';
import { dirname, join } from 'path';
import { fileURLToPath } from 'url';

import { generateSceneVoices } from './agents/voice-agent.mjs';
import { generateAllSceneVideos } from './agents/video-agent.mjs';
import { generateSRT } from './agents/caption-agent.mjs';
import { reviewScript } from './agents/qa-agent.mjs';
import { assembleVideo } from './agents/assembly-agent.mjs';

const __dirname = dirname(fileURLToPath(import.meta.url));
const OUTPUT_BASE = join(__dirname, 'pipeline-output');
const REPORT_DIR = join(__dirname, 'reports');

const args = process.argv.slice(2);
const typesFlag    = (args.find(a => a.startsWith('--type='))?.split('=')[1] ?? 'daily_horoscope').split(',');
const signsFlag    = args.find(a => a.startsWith('--signs='))?.split('=')[1]?.split(',');
const durationFlag = parseInt(args.find(a => a.startsWith('--duration='))?.split('=')[1] ?? '35');
const platformFlag = args.find(a => a.startsWith('--platform='))?.split('=')[1] ?? 'tiktok';

const ALL_SIGNS = [
  'Aries','Taurus','Gemini','Cancer','Leo','Virgo',
  'Libra','Scorpio','Sagittarius','Capricorn','Aquarius','Pisces',
];

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

const HOOK_STYLES = ['question', 'revelation', 'warning', 'challenge', 'story'];

const today = new Date().toISOString().slice(0, 10);
const signs = signsFlag || ALL_SIGNS;

function pickHook(index) {
  return HOOK_STYLES[index % HOOK_STYLES.length];
}

// ─── Script Generation ─────────────────────────────────────────────────────────

async function generateScript(topic) {
  const client = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });
  const zodiacTh = ZODIAC_TH[topic.zodiac_sign];
  const typeTh = CONTENT_TYPES[topic.content_type] || topic.content_type;

  const hookInstructions = {
    question: 'เริ่มด้วยคำถามที่ทำให้คนหยุดดู',
    revelation: 'เริ่มด้วยการเฉลยข้อมูลที่น่าสนใจ',
    warning: 'เริ่มด้วยสัญญาณเตือนแบบไม่ขู่',
    challenge: 'เริ่มด้วยการท้าให้ลอง',
    story: 'เริ่มด้วยเรื่องเล่าสั้น',
  };

  const systemPrompt = `คุณคือ Content Scriptwriter ของ "ดูดวง by Prinnie"

สไตล์การเขียน — สำคัญมาก:
- เขียนเหมือนหมอดูนั่งเล่าให้ฟังแบบสบายๆ ไม่ใช่แนวลึกลับ dramatic
- ห้ามใช้ภาษาแบบละครหรือลิเก ห้ามใช้คำฟุ่มเฟือย ห้ามเขียนเว่อร์
- พูดตรงๆ เข้าใจง่าย เหมือนคุยกับเพื่อน แต่มีความรู้เรื่องดวง
- ใช้คำพูดแบบคนไทยจริงๆ เช่น "นะ", "ค่ะ/ครับ", "อ่ะ", "เนอะ"
- ตัวอย่างโทน: "ชาวเมษช่วงนี้นะ ดาวศุกร์มาอยู่ตรงนี้ ก็เลยทำให้เรื่องความรักมันดีขึ้นมาหน่อย"
- ห้ามเขียนแนว: "พลังจักรวาลอันยิ่งใหญ่กำลังส่องแสงประกายสู่ดวงชะตา" ← ห้ามเด็ดขาด

กฎเหล็ก:
- ภาษาไทยทั้งหมด ยกเว้น hashtag
- ห้ามทำนายแนวขู่ ห้ามเคลม 100% ห้ามพูดเรื่องสุขภาพ/ความตายแรง
- ห้ามใช้คำ: ซวย, ตาย, หายนะ, แน่นอน100%, การันตี
- Hook น่าสนใจ แต่ไม่ต้องเว่อร์
- CTA ท้ายคลิปพาคนเข้าแอป MU-VERSE แต่พูดแบบธรรมชาติ
- Visual prompt เป็นภาษาอังกฤษ สไตล์ mystical, cinematic, vertical 9:16
- สีแบรนด์: navy #0B1026, gold #E8C77A ทุก scene

สำคัญ: แต่ละราศีต้องมีเนื้อหาไม่ซ้ำกัน ห้ามใช้ template เดิม`;

  const userPrompt = `สร้างสคริปต์คลิปสั้น:
ราศี: ${topic.zodiac_sign} (${zodiacTh})
ประเภท: ${typeTh}
แพลตฟอร์ม: ${topic.platform}
ความยาว: ${topic.duration} วินาที
สไตล์ Hook: ${hookInstructions[topic.hook_style]}
CTA: เปิดแอป MU-VERSE ดูดวงเฉพาะตัวคุณ
วันที่: ${today}

ตอบเป็น JSON เท่านั้น ไม่ต้องมี markdown fence:
{
  "video_id": "${topic.topic_id}",
  "platform": "${topic.platform}",
  "zodiac_sign": "${topic.zodiac_sign}",
  "content_type": "${topic.content_type}",
  "duration": ${topic.duration},
  "date": "${today}",
  "script_text": "สคริปต์เต็ม",
  "voiceover_text": "ข้อความพากย์เสียง",
  "caption": "Caption โพสต์ ไม่เกิน 150 ตัวอักษร",
  "hashtags": ["#ดูดวง", "#ราศี${zodiacTh}", "#muverse", ...],
  "cta": "CTA ท้ายคลิป",
  "scenes": [
    { "scene": 1, "type": "hook", "duration": 3, "voice": "...", "visual_prompt": "English, mystical, navy #0B1026, gold #E8C77A, 9:16", "caption_text": "..." }
  ]
}

ผลรวม duration ทุก scene ต้อง = ${topic.duration} วินาทีพอดี
ต้องมีอย่างน้อย ${Math.max(5, Math.floor(topic.duration / 7))} scenes`;

  const response = await client.messages.create({
    model: 'claude-haiku-4-5-20251001',
    max_tokens: 4096,
    temperature: 0.9,
    system: systemPrompt,
    messages: [{ role: 'user', content: userPrompt }],
  });

  const rawText = response.content[0]?.text ?? '';
  const jsonMatch = rawText.match(/\{[\s\S]*\}/);
  if (!jsonMatch) throw new Error('No JSON in response');
  return JSON.parse(jsonMatch[0]);
}

// ─── Run single pipeline ────────────────────────────────────────────────────────

async function runPipeline(topic) {
  const jobId = topic.topic_id;
  const workDir = join(OUTPUT_BASE, jobId);
  mkdirSync(workDir, { recursive: true });

  const result = {
    jobId,
    zodiac: topic.zodiac_sign,
    type: topic.content_type,
    status: 'pending',
    qa: null,
    timing: {},
    files: [],
  };

  try {
    // Step 1: Script
    const t1 = Date.now();
    const script = await generateScript(topic);
    result.timing.script = ((Date.now() - t1) / 1000).toFixed(1);
    writeFileSync(join(workDir, 'script.json'), JSON.stringify(script, null, 2));

    // Step 2: QA
    const t2 = Date.now();
    const qa = await reviewScript(script);
    result.timing.qa = ((Date.now() - t2) / 1000).toFixed(1);
    result.qa = { overall: qa.overall, confidence: qa.confidence };
    writeFileSync(join(workDir, 'qa-report.json'), JSON.stringify(qa, null, 2));

    if (qa.overall === 'REJECT') {
      result.status = 'rejected';
      return result;
    }

    // Step 3: Voice
    const t3 = Date.now();
    const voiceFiles = await generateSceneVoices(script.scenes, workDir);
    result.timing.voice = ((Date.now() - t3) / 1000).toFixed(1);

    // Step 4: Video
    const t4 = Date.now();
    const videoFiles = await generateAllSceneVideos(script.scenes, workDir);
    result.timing.video = ((Date.now() - t4) / 1000).toFixed(1);

    // Step 5: Captions
    const srt = generateSRT(script.scenes);
    writeFileSync(join(workDir, 'captions.srt'), srt, 'utf-8');

    // Step 6: Assembly
    const t6 = Date.now();
    const finalPath = join(workDir, `${jobId}_final.mp4`);
    await assembleVideo({
      sceneVideos: videoFiles,
      sceneVoices: voiceFiles,
      srtPath: null,
      outputPath: finalPath,
      workDir,
    });
    result.timing.assembly = ((Date.now() - t6) / 1000).toFixed(1);
    result.files.push(finalPath);

    writeFileSync(join(workDir, 'status.json'), JSON.stringify({
      status: 'ready_for_review',
      generated_at: new Date().toISOString(),
    }, null, 2));

    result.status = 'ready';
  } catch (err) {
    result.status = 'failed';
    result.error = err.message;
  }

  return result;
}

// ─── Generate Report ────────────────────────────────────────────────────────────

function generateReport(results, totalTime) {
  mkdirSync(REPORT_DIR, { recursive: true });

  const ready = results.filter(r => r.status === 'ready');
  const failed = results.filter(r => r.status === 'failed');
  const rejected = results.filter(r => r.status === 'rejected');

  let report = `# ดูดวง by Prinnie — Daily Report\n`;
  report += `Date: ${today}\n`;
  report += `Generated: ${new Date().toISOString()}\n`;
  report += `Total time: ${totalTime}s\n\n`;

  report += `## Summary\n`;
  report += `- Ready for review: ${ready.length}\n`;
  report += `- QA Rejected: ${rejected.length}\n`;
  report += `- Failed: ${failed.length}\n`;
  report += `- Total: ${results.length}\n\n`;

  report += `## Results\n\n`;
  report += `| # | Zodiac | Type | QA | Status | Time |\n`;
  report += `|---|--------|------|----|--------|------|\n`;

  for (const r of results) {
    const qaLabel = r.qa ? `${r.qa.overall} ${r.qa.confidence}%` : '-';
    const totalT = Object.values(r.timing).reduce((s, t) => s + parseFloat(t || 0), 0).toFixed(1);
    report += `| ${results.indexOf(r) + 1} | ${r.zodiac} | ${r.type} | ${qaLabel} | ${r.status} | ${totalT}s |\n`;
  }

  if (failed.length > 0) {
    report += `\n## Errors\n`;
    for (const r of failed) {
      report += `- ${r.zodiac}/${r.type}: ${r.error}\n`;
    }
  }

  if (rejected.length > 0) {
    report += `\n## QA Rejected\n`;
    for (const r of rejected) {
      report += `- ${r.zodiac}/${r.type}: QA rejected — review qa-report.json\n`;
    }
  }

  report += `\n## Next Steps\n`;
  report += `1. Review scripts in pipeline-output/\n`;
  report += `2. Listen to voice MP3s\n`;
  report += `3. Watch final MP4s\n`;
  report += `4. Approve or reject each clip\n`;
  report += `5. Upload approved clips to TikTok/Reels/Shorts\n`;

  const reportPath = join(REPORT_DIR, `report_${today}.md`);
  writeFileSync(reportPath, report, 'utf-8');

  // Also save JSON summary
  const jsonPath = join(REPORT_DIR, `report_${today}.json`);
  writeFileSync(jsonPath, JSON.stringify({ date: today, results, totalTime }, null, 2));

  return reportPath;
}

// ─── Main ──────────────────────────────────────────────────────────────────────

async function main() {
  console.log('\n╔══════════════════════════════════════════════════════════════╗');
  console.log('║       ดูดวง by Prinnie — Batch Generator                   ║');
  console.log('╚══════════════════════════════════════════════════════════════╝');
  console.log(`  Date:     ${today}`);
  console.log(`  Signs:    ${signs.length} (${signs.join(', ')})`);
  console.log(`  Types:    ${typesFlag.join(', ')}`);
  console.log(`  Duration: ${durationFlag}s`);
  console.log(`  Platform: ${platformFlag}`);

  const totalJobs = signs.length * typesFlag.length;
  console.log(`  Total:    ${totalJobs} clips\n`);

  const startTime = Date.now();
  const results = [];
  let current = 0;

  for (const contentType of typesFlag) {
    for (let i = 0; i < signs.length; i++) {
      const sign = signs[i];
      current++;
      const topic = {
        topic_id: `${contentType}_${sign.toLowerCase()}_${today.replace(/-/g, '_')}`,
        zodiac_sign: sign,
        content_type: contentType,
        platform: platformFlag,
        duration: durationFlag,
        hook_style: pickHook(i),
      };

      console.log(`━━━ [${current}/${totalJobs}] ${sign} / ${CONTENT_TYPES[contentType] || contentType} ━━━`);

      const result = await runPipeline(topic);
      results.push(result);

      const icon = result.status === 'ready' ? 'OK' : result.status === 'rejected' ? 'QA_REJECT' : 'FAIL';
      const qaInfo = result.qa ? `QA:${result.qa.overall}(${result.qa.confidence}%)` : '';
      console.log(`  ${icon} ${qaInfo}\n`);
    }
  }

  const totalTime = ((Date.now() - startTime) / 1000).toFixed(1);

  // Generate report
  const reportPath = generateReport(results, totalTime);

  // Print summary
  const ready = results.filter(r => r.status === 'ready').length;
  const failed = results.filter(r => r.status === 'failed').length;
  const rejected = results.filter(r => r.status === 'rejected').length;

  console.log('╔══════════════════════════════════════════════════════════════╗');
  console.log('║                    BATCH COMPLETE                           ║');
  console.log('╠══════════════════════════════════════════════════════════════╣');
  console.log(`║  Ready:    ${String(ready).padEnd(4)} clips                                    ║`);
  console.log(`║  Rejected: ${String(rejected).padEnd(4)} clips                                    ║`);
  console.log(`║  Failed:   ${String(failed).padEnd(4)} clips                                    ║`);
  console.log(`║  Total:    ${String(totalTime + 's').padEnd(10)}                                ║`);
  console.log(`║  Report:   ${reportPath.split('/').slice(-2).join('/')}            ║`);
  console.log('╚══════════════════════════════════════════════════════════════╝');
  console.log(`\n  Output: ${OUTPUT_BASE}/`);
  console.log(`  Report: ${reportPath}\n`);
}

main().catch(err => {
  console.error('Batch error:', err);
  process.exit(1);
});
