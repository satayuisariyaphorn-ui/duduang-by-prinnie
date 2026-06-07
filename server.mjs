/**
 * ดูดวง by Prinnie — LINE Bot Server
 *
 * แม่ส่งข้อความใน LINE → ระบบสร้างคลิปอัตโนมัติ → ส่งกลับ
 *
 * Message formats mom can send:
 *   "ราศีเมษ: วันนี้ชาวเมษนะ ดาวศุกร์มาอยู่ตรงนี้..."
 *   "เมษ วันนี้ชาวเมษนะ..."
 *   "วันนี้ชาวสิงห์นะ..."  (auto-detect zodiac)
 *
 * Setup:
 *   1. Create LINE Bot at developers.line.biz
 *   2. Add LINE_CHANNEL_SECRET and LINE_CHANNEL_ACCESS_TOKEN to .env
 *   3. Set webhook URL to https://your-domain/webhook
 *   4. npm run bot
 *
 * Requires .env with:
 *   ANTHROPIC_API_KEY
 *   LINE_CHANNEL_SECRET
 *   LINE_CHANNEL_ACCESS_TOKEN
 */

import express from 'express';
import crypto from 'crypto';
import { writeFileSync, mkdirSync, readFileSync, existsSync, readdirSync } from 'fs';
import { dirname, join } from 'path';
import { fileURLToPath } from 'url';

import { processMotherScript, detectZodiac } from './scripts/agents/mom-script-agent.mjs';
import { generateSceneVoices } from './scripts/agents/voice-agent.mjs';
import { generateAllSceneVideos } from './scripts/agents/video-agent.mjs';
import { generateSRT } from './scripts/agents/caption-agent.mjs';
import { reviewScript } from './scripts/agents/qa-agent.mjs';
import { assembleVideo } from './scripts/agents/assembly-agent.mjs';

const __dirname = dirname(fileURLToPath(import.meta.url));
const OUTPUT_BASE = join(__dirname, 'scripts', 'pipeline-output');
const JOBS_DIR = join(__dirname, 'jobs');

const app = express();
const PORT = process.env.PORT || 3001;

const LINE_SECRET = process.env.LINE_CHANNEL_SECRET;
function resolveLineToken() {
  const b64 = process.env.LINE_CHANNEL_ACCESS_TOKEN_B64;
  if (b64) return Buffer.from(b64, 'base64').toString('utf-8');
  const raw = process.env.LINE_CHANNEL_ACCESS_TOKEN || '';
  if (raw.endsWith('=') && /^[A-Za-z0-9+/=]+$/.test(raw)) {
    try {
      const decoded = Buffer.from(raw, 'base64').toString('utf-8');
      if (decoded.length > 50) return decoded;
    } catch {}
  }
  return raw;
}
const LINE_TOKEN = resolveLineToken();
const ADMIN_USER_IDS = (process.env.LINE_ADMIN_USERS || '').split(',').filter(Boolean);

// ─── LINE Signature Verification ────────────────────────────────────────────────

function verifySignature(body, signature) {
  if (!LINE_SECRET) return true; // dev mode
  const hash = crypto.createHmac('sha256', LINE_SECRET).update(body).digest('base64');
  return hash === signature;
}

// ─── LINE Reply ─────────────────────────────────────────────────────────────────

async function replyMessage(replyToken, messages) {
  if (!LINE_TOKEN) {
    console.log('  [DEV] Would reply:', messages);
    return;
  }

  console.log(`[REPLY] Sending to LINE...`);
  try {
    const res = await fetch('https://api.line.me/v2/bot/message/reply', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${LINE_TOKEN}`,
      },
      body: JSON.stringify({ replyToken, messages }),
    });

    const responseText = await res.text();
    if (!res.ok) {
      console.error(`[REPLY] FAILED ${res.status}: ${responseText}`);
    } else {
      console.log(`[REPLY] OK`);
    }
  } catch (err) {
    console.error(`[REPLY] Error: ${err.message}`);
  }
}

async function pushMessage(userId, messages) {
  if (!LINE_TOKEN) {
    console.log('  [DEV] Would push to', userId, ':', messages);
    return;
  }

  await fetch('https://api.line.me/v2/bot/message/push', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${LINE_TOKEN}`,
    },
    body: JSON.stringify({ to: userId, messages }),
  });
}

// ─── Message Parser ─────────────────────────────────────────────────────────────

function parseMotherMessage(text) {
  const lines = text.trim().split('\n');
  let zodiac = null;
  let scriptText = text.trim();
  let contentType = 'daily_horoscope';

  // Check first line for "ราศีXXX:" format
  const firstLine = lines[0].trim();
  const colonMatch = firstLine.match(/^(?:ราศี)?(.+?)[:：]\s*(.*)/);
  if (colonMatch) {
    zodiac = detectZodiac(colonMatch[1]);
    scriptText = colonMatch[2] ? [colonMatch[2], ...lines.slice(1)].join('\n').trim() : lines.slice(1).join('\n').trim();
  }

  if (!zodiac) {
    zodiac = detectZodiac(text);
  }

  // Detect content type
  const lower = text.toLowerCase();
  if (lower.includes('ความรัก') || lower.includes('คู่ครอง') || lower.includes('แฟน')) contentType = 'love_reading';
  else if (lower.includes('การเงิน') || lower.includes('เงิน') || lower.includes('ทรัพย์')) contentType = 'money_reading';
  else if (lower.includes('การงาน') || lower.includes('งาน') || lower.includes('อาชีพ')) contentType = 'career_reading';

  return { zodiac, scriptText, contentType };
}

// ─── Pipeline Runner ────────────────────────────────────────────────────────────

async function runMomPipeline(userId, scriptText, zodiac, contentType) {
  const today = new Date().toISOString().slice(0, 10);
  const jobId = `mom_${contentType}_${(zodiac || 'general').toLowerCase()}_${today.replace(/-/g, '_')}_${Date.now()}`;
  const workDir = join(OUTPUT_BASE, jobId);
  mkdirSync(workDir, { recursive: true });

  // Save job info
  mkdirSync(JOBS_DIR, { recursive: true });
  const jobInfo = {
    jobId, userId, zodiac, contentType,
    scriptText, status: 'processing',
    created_at: new Date().toISOString(),
  };
  writeFileSync(join(JOBS_DIR, `${jobId}.json`), JSON.stringify(jobInfo, null, 2));

  try {
    // Step 1: Process mom's script into scenes
    console.log(`  [1/5] Processing script...`);
    const script = await processMotherScript({
      text: scriptText,
      zodiacSign: zodiac,
      contentType,
      platform: 'tiktok',
    });
    writeFileSync(join(workDir, 'script.json'), JSON.stringify(script, null, 2));
    console.log(`  Script: ${script.scenes?.length} scenes`);

    // Step 2: QA check
    console.log(`  [2/5] QA checking...`);
    const qa = await reviewScript(script);
    writeFileSync(join(workDir, 'qa-report.json'), JSON.stringify(qa, null, 2));
    console.log(`  QA: ${qa.overall} (${qa.confidence}%)`);

    // Step 3: Voice generation
    console.log(`  [3/5] Generating voice...`);
    const voiceFiles = await generateSceneVoices(script.scenes, workDir);

    // Step 4: Video + Captions
    console.log(`  [4/5] Generating video...`);
    const videoFiles = await generateAllSceneVideos(script.scenes, workDir);
    const srt = generateSRT(script.scenes);
    writeFileSync(join(workDir, 'captions.srt'), srt, 'utf-8');

    // Step 5: Assembly
    console.log(`  [5/5] Assembling final video...`);
    const finalPath = join(workDir, `${jobId}_final.mp4`);
    await assembleVideo({
      sceneVideos: videoFiles,
      sceneVoices: voiceFiles,
      srtPath: null,
      outputPath: finalPath,
      workDir,
    });

    // Update job status
    jobInfo.status = 'ready';
    jobInfo.finalVideo = finalPath;
    jobInfo.qa = { overall: qa.overall, confidence: qa.confidence };
    jobInfo.completed_at = new Date().toISOString();
    writeFileSync(join(JOBS_DIR, `${jobId}.json`), JSON.stringify(jobInfo, null, 2));

    writeFileSync(join(workDir, 'status.json'), JSON.stringify({
      status: 'ready_for_review',
      generated_at: new Date().toISOString(),
      source: 'line_bot',
      user_id: userId,
    }, null, 2));

    return { success: true, jobId, script, qa, finalPath };
  } catch (err) {
    jobInfo.status = 'failed';
    jobInfo.error = err.message;
    writeFileSync(join(JOBS_DIR, `${jobId}.json`), JSON.stringify(jobInfo, null, 2));
    return { success: false, jobId, error: err.message };
  }
}

// ─── Webhook Handler ────────────────────────────────────────────────────────────

app.post('/webhook', express.raw({ type: '*/*' }), async (req, res) => {
  let bodyStr;
  try {
    bodyStr = typeof req.body === 'string' ? req.body : Buffer.isBuffer(req.body) ? req.body.toString('utf-8') : JSON.stringify(req.body);
  } catch (e) {
    console.error('Body parse error:', e.message);
    return res.status(400).send('Bad request');
  }

  console.log(`\n[WEBHOOK] Received ${bodyStr.length} bytes`);

  const signature = req.headers['x-line-signature'];
  if (LINE_SECRET && signature) {
    const valid = verifySignature(bodyStr, signature);
    console.log(`[WEBHOOK] Signature: ${valid ? 'OK' : 'INVALID'}`);
    if (!valid) {
      return res.status(401).send('Invalid signature');
    }
  }

  res.status(200).send('OK');

  let events;
  try {
    events = JSON.parse(bodyStr).events || [];
    console.log(`[WEBHOOK] Events: ${events.length}`);
  } catch (e) {
    console.error('[WEBHOOK] JSON parse error:', e.message);
    return;
  }

  for (const event of events) {
   try {
    if (event.type !== 'message' || event.message?.type !== 'text') {
      console.log(`[WEBHOOK] Skipping event type: ${event.type}/${event.message?.type}`);
      continue;
    }

    const userId = event.source?.userId;
    const text = event.message.text.trim();
    const replyToken = event.replyToken;

    console.log(`[MSG] User: ${userId}`);
    console.log(`[MSG] Text: ${text.slice(0, 80)}`);
    console.log(`[MSG] ReplyToken: ${replyToken?.slice(0, 20)}...`);

    // Check if user is authorized (if admin list is set)
    if (ADMIN_USER_IDS.length > 0 && !ADMIN_USER_IDS.includes(userId)) {
      await replyMessage(replyToken, [{
        type: 'text',
        text: 'ขออภัยค่ะ ระบบนี้สำหรับทีม Prinnie เท่านั้น',
      }]);
      continue;
    }

    // Command: /status
    if (text === '/status' || text === '/สถานะ') {
      const jobFiles = existsSync(JOBS_DIR) ?
        readdirSync(JOBS_DIR).filter(f => f.endsWith('.json')).slice(-5) : [];
      const statusText = jobFiles.length > 0
        ? jobFiles.map(f => {
          const j = JSON.parse(readFileSync(join(JOBS_DIR, f), 'utf-8'));
          return `${j.zodiac || '?'} ${j.contentType}: ${j.status}`;
        }).join('\n')
        : 'ยังไม่มีงาน';

      await replyMessage(replyToken, [{ type: 'text', text: `สถานะล่าสุด:\n${statusText}` }]);
      continue;
    }

    // Command: /help
    if (text === '/help' || text === '/วิธีใช้') {
      await replyMessage(replyToken, [{
        type: 'text',
        text: `วิธีใช้ ดูดวง by Prinnie Bot:

ส่งข้อความแบบนี้:

ราศีเมษ: วันนี้ชาวเมษนะ ดาวศุกร์มาอยู่...

หรือพิมพ์เลยไม่ต้องใส่ราศีนำหน้า ระบบจะตรวจจับเอง:

วันนี้ชาวสิงห์นะ ดาวอังคารมาแรง...

คำสั่ง:
/status = ดูสถานะงาน
/help = วิธีใช้`,
      }]);
      continue;
    }

    // Must be a script submission
    if (text.length < 20) {
      await replyMessage(replyToken, [{
        type: 'text',
        text: 'ข้อความสั้นไปค่ะ ลองส่งสคริปต์ยาวกว่านี้อีกหน่อยนะ (อย่างน้อย 20 ตัวอักษร)',
      }]);
      continue;
    }

    // Parse and acknowledge
    const { zodiac, scriptText, contentType } = parseMotherMessage(text);
    const zodiacLabel = zodiac || 'ทั่วไป';

    await replyMessage(replyToken, [{
      type: 'text',
      text: `รับสคริปต์แล้วค่ะ กำลังสร้างคลิป...

ราศี: ${zodiacLabel}
ประเภท: ${contentType}

รอสักครู่นะคะ ประมาณ 1-2 นาที`,
    }]);

    // Run pipeline in background
    console.log(`\n--- New job from LINE ---`);
    console.log(`  User:    ${userId}`);
    console.log(`  Zodiac:  ${zodiacLabel}`);
    console.log(`  Type:    ${contentType}`);
    console.log(`  Script:  ${scriptText.slice(0, 60)}...`);

    const result = await runMomPipeline(userId, scriptText, zodiac, contentType);

    if (result.success) {
      console.log(`  DONE: ${result.jobId}`);
      await pushMessage(userId, [{
        type: 'text',
        text: `คลิปพร้อมแล้วค่ะ!

ราศี: ${zodiacLabel}
QA: ${result.qa.overall} (${result.qa.confidence}%)

คลิปอยู่ที่: ${result.finalPath}

Caption:
${result.script.caption}

${result.script.hashtags?.join(' ')}`,
      }]);
    } else {
      console.log(`  FAILED: ${result.error}`);
      await pushMessage(userId, [{
        type: 'text',
        text: `ขออภัยค่ะ สร้างคลิปไม่สำเร็จ: ${result.error}\n\nลองส่งใหม่อีกครั้งนะคะ`,
      }]);
    }
   } catch (err) {
    console.error(`[ERROR] Event processing failed: ${err.message}`);
    console.error(err.stack);
   }
  }
});

// ─── Debug endpoint ─────────────────────────────────────────────────────────────

app.get('/debug/test-reply', async (req, res) => {
  const testUserId = req.query.uid;
  if (!testUserId) {
    return res.json({ error: 'Add ?uid=USER_ID to test push message' });
  }
  try {
    await pushMessage(testUserId, [{ type: 'text', text: 'ทดสอบ Bot สำเร็จค่ะ!' }]);
    res.json({ status: 'sent', to: testUserId });
  } catch (err) {
    res.json({ status: 'error', message: err.message });
  }
});

app.get('/debug/env', (req, res) => {
  const ak = process.env.ANTHROPIC_API_KEY || '';
  res.json({
    anthropicKeyLength: ak.length,
    anthropicKeyStart: ak.slice(0, 15),
    anthropicKeyEnd: ak.slice(-8),
    hasLineSecret: !!LINE_SECRET,
    hasLineToken: !!LINE_TOKEN,
    lineTokenLength: LINE_TOKEN?.length || 0,
    lineTokenStart: LINE_TOKEN?.slice(0, 10) || '',
    lineTokenEnd: LINE_TOKEN?.slice(-10) || '',
    rawTokenLength: process.env.LINE_CHANNEL_ACCESS_TOKEN?.length || 0,
    adminUsers: ADMIN_USER_IDS.length,
  });
});

// ─── Dev Mode: test via HTTP POST ───────────────────────────────────────────────

app.post('/api/generate', express.json(), async (req, res) => {
  const { text, zodiac, contentType } = req.body;

  if (!text || text.length < 20) {
    return res.status(400).json({ error: 'Script text too short (min 20 chars)' });
  }

  const parsed = parseMotherMessage(text);
  const finalZodiac = zodiac || parsed.zodiac;
  const finalType = contentType || parsed.contentType;

  console.log(`\n--- API generate ---`);
  console.log(`  Zodiac: ${finalZodiac}`);
  console.log(`  Type:   ${finalType}`);

  res.json({ status: 'processing', message: 'Pipeline started' });

  const result = await runMomPipeline('api_user', parsed.scriptText, finalZodiac, finalType);
  console.log(`  Result: ${result.success ? 'OK' : 'FAILED'}`);
});

// ─── Health Check ───────────────────────────────────────────────────────────────

app.get('/', (req, res) => {
  res.json({
    name: 'ดูดวง by Prinnie — Content Bot',
    status: 'running',
    endpoints: {
      webhook: 'POST /webhook (LINE Bot)',
      generate: 'POST /api/generate (dev mode)',
    },
  });
});

// ─── Start ──────────────────────────────────────────────────────────────────────

app.listen(PORT, () => {
  console.log('\n╔══════════════════════════════════════════════════════════════╗');
  console.log('║       ดูดวง by Prinnie — LINE Bot Server                   ║');
  console.log('╚══════════════════════════════════════════════════════════════╝');
  console.log(`  Port:     ${PORT}`);
  console.log(`  LINE:     ${LINE_TOKEN ? 'configured' : 'DEV MODE (no LINE token)'}`);
  console.log(`  Webhook:  http://localhost:${PORT}/webhook`);
  console.log(`  API:      http://localhost:${PORT}/api/generate`);
  console.log(`  Admins:   ${ADMIN_USER_IDS.length > 0 ? ADMIN_USER_IDS.join(', ') : 'all users'}`);
  console.log('');
});
