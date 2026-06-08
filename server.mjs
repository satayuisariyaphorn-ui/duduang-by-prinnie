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
import { generateAllSceneImages } from './scripts/agents/image-agent.mjs';
import { generateSceneVideo, generateAllSceneVideos } from './scripts/agents/video-agent.mjs';
import { generateSRT } from './scripts/agents/caption-agent.mjs';
import { reviewScript } from './scripts/agents/qa-agent.mjs';
import { assembleVideo } from './scripts/agents/assembly-agent.mjs';

const __dirname = dirname(fileURLToPath(import.meta.url));
const OUTPUT_BASE = join(__dirname, 'scripts', 'pipeline-output');
const JOBS_DIR = join(__dirname, 'jobs');

const app = express();
const PORT = process.env.PORT || 3001;
const BASE_URL = process.env.RAILWAY_PUBLIC_DOMAIN
  ? `https://${process.env.RAILWAY_PUBLIC_DOMAIN}`
  : `http://localhost:${PORT}`;

app.use('/clips', express.static(join(__dirname, 'scripts', 'pipeline-output')));

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

// Store pending text per user — when mom sends text first, then voice
const pendingText = new Map();

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

// ─── Stock Background Picker ────────────────────────────────────────────────────

function pickBackground(bgDir, sceneIndex) {
  if (!existsSync(bgDir)) return null;
  const files = readdirSync(bgDir).filter(f => /\.(jpg|jpeg|png)$/i.test(f)).sort();
  if (files.length === 0) return null;
  const idx = sceneIndex % files.length;
  return join(bgDir, files[idx]);
}

// ─── Upload + Send Clip ─────────────────────────────────────────────────────────

async function uploadToFal(filePath, mimeType) {
  const { fal } = await import('@fal-ai/client');
  fal.config({ credentials: process.env.FAL_API_KEY });
  const buf = readFileSync(filePath);
  const blob = new Blob([buf], { type: mimeType });
  return await fal.storage.upload(blob);
}

async function generateThumbnail(videoPath, outputPath) {
  const { execFile: execFileCb } = await import('child_process');
  const { promisify } = await import('util');
  const execP = promisify(execFileCb);
  const ffmpegStatic = (await import('ffmpeg-static')).default;
  await execP(ffmpegStatic, [
    '-y', '-i', videoPath, '-ss', '1', '-vframes', '1',
    '-vf', 'scale=480:854',
    outputPath,
  ], { timeout: 30000 });
  return outputPath;
}

async function sendClipToLine(userId, result) {
  let clipUrl = `${BASE_URL}/clips/${result.jobId}/${result.jobId}_final.mp4`;
  let thumbUrl = null;

  // Upload video + thumbnail to FAL for public HTTPS URLs
  if (process.env.FAL_API_KEY) {
    try {
      clipUrl = await uploadToFal(result.finalPath, 'video/mp4');
      console.log(`  Uploaded video: ${clipUrl}`);
    } catch (e) { console.log(`  Video upload fallback: ${e.message}`); }

    try {
      const thumbPath = result.finalPath.replace('_final.mp4', '_thumb.jpg');
      await generateThumbnail(result.finalPath, thumbPath);
      thumbUrl = await uploadToFal(thumbPath, 'image/jpeg');
      console.log(`  Uploaded thumbnail: ${thumbUrl}`);
    } catch (e) { console.log(`  Thumbnail fallback: ${e.message}`); }
  }

  const messages = [];

  // Send as LINE video message for easy save/download
  if (clipUrl.startsWith('https://') && thumbUrl) {
    messages.push({
      type: 'video',
      originalContentUrl: clipUrl,
      previewImageUrl: thumbUrl,
    });
  }

  // Always send text with caption + download link
  messages.push({
    type: 'text',
    text: `คลิปพร้อมแล้วค่ะ! 🎬

${thumbUrl ? 'กดวิดีโอด้านบนเพื่อดู แล้วกด save ได้เลย' : `ดาวน์โหลด (กดค้าง):\n${clipUrl}`}

Caption:
${result.script?.caption || ''}

${result.script?.hashtags?.join(' ') || ''}`,
  });

  await pushMessage(userId, messages);
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

// ─── Text+Voice Pipeline (mom sends text then voice) ─────────────────────────────

async function runTextVoicePipeline(userId, scriptText, audioBuffer, messageId) {
  const today = new Date().toISOString().slice(0, 10);
  const jobId = `clip_${today.replace(/-/g, '_')}_${messageId}`;
  const workDir = join(OUTPUT_BASE, jobId);
  mkdirSync(workDir, { recursive: true });
  mkdirSync(JOBS_DIR, { recursive: true });

  const audioPath = join(workDir, 'mom_voice.m4a');
  writeFileSync(audioPath, audioBuffer);
  writeFileSync(join(workDir, 'script_text.txt'), scriptText, 'utf-8');

  const jobInfo = { jobId, userId, scriptText, status: 'processing', created_at: new Date().toISOString() };
  writeFileSync(join(JOBS_DIR, `${jobId}.json`), JSON.stringify(jobInfo, null, 2));

  try {
    const { execFile: execFileCb } = await import('child_process');
    const { promisify } = await import('util');
    const execP = promisify(execFileCb);
    const ffmpegPath = (await import('ffmpeg-static')).default;

    // Step 1: Get audio duration
    console.log(`  [1/4] Checking audio...`);
    let audioDuration = 30;
    try {
      const probeResult = await execP(ffmpegPath, ['-i', audioPath, '-f', 'null', '-'], { timeout: 30000 }).catch(e => ({ stderr: e.stderr || '' }));
      const match = (probeResult.stderr || '').match(/Duration:\s*(\d+):(\d+):(\d+\.\d+)/);
      if (match) audioDuration = parseInt(match[1]) * 3600 + parseInt(match[2]) * 60 + parseFloat(match[3]);
    } catch {}
    console.log(`  Audio: ${audioDuration.toFixed(1)}s`);

    // Step 2: Use text to generate scene breakdown + visual prompts
    console.log(`  [2/4] Generating visual prompts from text...`);
    const { zodiac, contentType } = parseMotherMessage(scriptText);
    const script = await processMotherScript({
      text: scriptText,
      zodiacSign: zodiac,
      contentType,
      platform: 'tiktok',
    });
    writeFileSync(join(workDir, 'script.json'), JSON.stringify(script, null, 2));

    // Step 3: Pick background images (stock art with pan/zoom > AI-generated)
    console.log(`  [3/4] Selecting background images...`);
    const bgDir = join(__dirname, 'assets', 'backgrounds');
    const img1 = pickBackground(bgDir, 0);
    const img2 = pickBackground(bgDir, 1);
    console.log(`  BG 1: ${img1}`);
    console.log(`  BG 2: ${img2}`);

    // Step 4: Build video with pan/zoom (Ken Burns effect)
    console.log(`  [4/4] Building video with pan/zoom...`);
    const dur1 = Math.ceil(audioDuration / 2);
    const dur2 = Math.ceil(audioDuration) - dur1;

    const vid1 = join(workDir, 'vid1.mp4');
    const vid2 = join(workDir, 'vid2.mp4');
    await generateSceneVideo({ scene: 1, duration: dur1 }, vid1, { imagePath: img1 });
    console.log(`  Video 1: ${dur1}s (pan/zoom)`);
    await generateSceneVideo({ scene: 2, duration: dur2 }, vid2, { imagePath: img2 });
    console.log(`  Video 2: ${dur2}s (pan/zoom)`);

    // Concat + combine with mom's audio
    const concatPath = join(workDir, 'concat.txt');
    writeFileSync(concatPath, `file '${vid1}'\nfile '${vid2}'`);
    const merged = join(workDir, 'merged.mp4');
    await execP(ffmpegPath, ['-y', '-f', 'concat', '-safe', '0', '-i', concatPath, '-c', 'copy', merged], { timeout: 120000 });

    const finalPath = join(workDir, `${jobId}_final.mp4`);
    await execP(ffmpegPath, ['-y', '-i', merged, '-i', audioPath, '-map', '0:v', '-map', '1:a', '-c:v', 'libx264', '-c:a', 'aac', '-b:a', '128k', '-shortest', '-pix_fmt', 'yuv420p', finalPath], { timeout: 180000 });

    console.log(`  Final: ${finalPath}`);
    jobInfo.status = 'ready';
    jobInfo.finalVideo = finalPath;
    jobInfo.script = script;
    jobInfo.completed_at = new Date().toISOString();
    writeFileSync(join(JOBS_DIR, `${jobId}.json`), JSON.stringify(jobInfo, null, 2));

    return { success: true, jobId, script, finalPath };
  } catch (err) {
    console.error(`  Pipeline error: ${err.message}`);
    jobInfo.status = 'failed';
    jobInfo.error = err.message;
    writeFileSync(join(JOBS_DIR, `${jobId}.json`), JSON.stringify(jobInfo, null, 2));
    return { success: false, jobId, error: err.message };
  }
}

// ─── Text-only Pipeline Runner (legacy) ──────────────────────────────────────────

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
    console.log(`  [3/6] Generating voice...`);
    const voiceFiles = await generateSceneVoices(script.scenes, workDir);

    // Step 4: Image generation
    console.log(`  [4/6] Generating images...`);
    await generateAllSceneImages(script.scenes, workDir);

    // Step 5: Video + Captions
    console.log(`  [5/6] Generating video...`);
    const videoFiles = await generateAllSceneVideos(script.scenes, workDir);
    const srt = generateSRT(script.scenes);
    writeFileSync(join(workDir, 'captions.srt'), srt, 'utf-8');

    // Step 6: Assembly
    console.log(`  [6/6] Assembling final video...`);
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
    if (event.type !== 'message') continue;
    const msgType = event.message?.type;

    // Handle audio/voice messages from mom
    if (msgType === 'audio') {
      const userId = event.source?.userId;
      const replyToken = event.replyToken;
      const messageId = event.message.id;

      // Check if mom sent text before this voice
      const scriptText = pendingText.get(userId);
      pendingText.delete(userId);

      if (!scriptText) {
        await replyMessage(replyToken, [{
          type: 'text',
          text: 'ส่งข้อความเนื้อหาก่อน แล้วค่อยอัดเสียงตามนะคะ\n\nตัวอย่าง:\n1. พิมพ์: "ราศีเมษ ดาวอังคารมาแรง เรื่องการเงินดี"\n2. อัดเสียงพูดตามเนื้อหา',
        }]);
        continue;
      }

      console.log(`[AUDIO] Voice + text: ${scriptText.slice(0, 60)}...`);

      await replyMessage(replyToken, [{
        type: 'text',
        text: `รับเสียง + เนื้อหาแล้วค่ะ กำลังสร้างคลิป...

เนื้อหา: ${scriptText.slice(0, 60)}...

รอสักครู่นะคะ ประมาณ 1-2 นาที`,
      }]);

      // Download audio from LINE
      const audioRes = await fetch(`https://api-data.line.me/v2/bot/message/${messageId}/content`, {
        headers: { 'Authorization': `Bearer ${LINE_TOKEN}` },
      });
      if (!audioRes.ok) {
        await pushMessage(userId, [{ type: 'text', text: `ดาวน์โหลดเสียงไม่สำเร็จ: ${audioRes.status}` }]);
        continue;
      }
      const audioBuffer = Buffer.from(await audioRes.arrayBuffer());

      // Run voice+text pipeline
      const result = await runTextVoicePipeline(userId, scriptText, audioBuffer, messageId);

      if (result.success) {
        await sendClipToLine(userId, result);
      } else {
        await pushMessage(userId, [{
          type: 'text',
          text: `ขออภัยค่ะ สร้างคลิปไม่สำเร็จ: ${result.error}\n\nลองส่งใหม่นะคะ`,
        }]);
      }
      continue;
    }

    // Handle file messages (m4a, mp3, wav)
    if (msgType === 'file') {
      const userId = event.source?.userId;
      const replyToken = event.replyToken;
      const messageId = event.message.id;
      const fileName = event.message.fileName || '';

      const isAudio = /\.(m4a|mp3|wav|aac|ogg)$/i.test(fileName);
      if (!isAudio) {
        await replyMessage(replyToken, [{
          type: 'text',
          text: 'รองรับไฟล์เสียงเท่านั้นนะคะ (.m4a, .mp3, .wav)',
        }]);
        continue;
      }

      const scriptText = pendingText.get(userId);
      pendingText.delete(userId);

      if (!scriptText) {
        await replyMessage(replyToken, [{
          type: 'text',
          text: 'ส่งข้อความเนื้อหาก่อน แล้วค่อยส่งไฟล์เสียงตามนะคะ\n\nตัวอย่าง:\n1. พิมพ์: "ราศีเมษ ดาวอังคารมาแรง เรื่องการเงินดี"\n2. ส่งไฟล์เสียง .m4a',
        }]);
        continue;
      }

      console.log(`[FILE] Audio file: ${fileName}`);

      await replyMessage(replyToken, [{
        type: 'text',
        text: `รับไฟล์เสียง + เนื้อหาแล้วค่ะ กำลังสร้างคลิป...

ไฟล์: ${fileName}
เนื้อหา: ${scriptText.slice(0, 60)}...

รอสักครู่นะคะ ประมาณ 1-2 นาที`,
      }]);

      const audioRes = await fetch(`https://api-data.line.me/v2/bot/message/${messageId}/content`, {
        headers: { 'Authorization': `Bearer ${LINE_TOKEN}` },
      });
      if (!audioRes.ok) {
        await pushMessage(userId, [{ type: 'text', text: `ดาวน์โหลดไฟล์ไม่สำเร็จ: ${audioRes.status}` }]);
        continue;
      }
      const audioBuffer = Buffer.from(await audioRes.arrayBuffer());

      const result = await runTextVoicePipeline(userId, scriptText, audioBuffer, messageId);

      if (result.success) {
        await sendClipToLine(userId, result);
      } else {
        await pushMessage(userId, [{
          type: 'text',
          text: `ขออภัยค่ะ สร้างคลิปไม่สำเร็จ: ${result.error}\n\nลองส่งใหม่นะคะ`,
        }]);
      }
      continue;
    }

    if (msgType !== 'text') {
      console.log(`[WEBHOOK] Skipping message type: ${msgType}`);
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

    // Save text and wait for voice
    pendingText.set(userId, text);
    const { zodiac: detectedZodiac } = parseMotherMessage(text);
    const zodiacLabel = detectedZodiac || 'ทั่วไป';

    await replyMessage(replyToken, [{
      type: 'text',
      text: `รับเนื้อหาแล้วค่ะ!

ราศี: ${zodiacLabel}

อัดเสียงส่งมาเลยนะคะ แล้วจะสร้างคลิปให้ค่ะ 🎙️`,
    }]);
    continue;
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

app.get('/debug/test-anthropic', async (req, res) => {
  try {
    const resp = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': process.env.ANTHROPIC_API_KEY,
        'anthropic-version': '2023-06-01',
      },
      body: JSON.stringify({
        model: 'claude-haiku-4-5-20251001',
        max_tokens: 5,
        messages: [{ role: 'user', content: 'hi' }],
      }),
    });
    const data = await resp.text();
    res.json({ status: resp.status, response: data.slice(0, 200) });
  } catch (err) {
    res.json({ status: 'error', message: err.message });
  }
});

app.get('/debug/env', (req, res) => {
  res.json({
    anthropic: !!process.env.ANTHROPIC_API_KEY,
    elevenlabs: !!process.env.ELEVENLABS_API_KEY,
    elevenlabsVoice: process.env.ELEVENLABS_VOICE_ID || 'default',
    fal: !!process.env.FAL_API_KEY,
    minimaxVoice: process.env.MINIMAX_VOICE_ID || 'default (Voiceeffe72d71780906562)',
    lineSecret: !!LINE_SECRET,
    lineToken: LINE_TOKEN?.length || 0,
    railwayDomain: process.env.RAILWAY_PUBLIC_DOMAIN || 'not set',
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

  const result = await runMomPipeline('api_user', parsed.scriptText, finalZodiac, finalType);
  console.log(`  Result: ${result.success ? 'OK' : 'FAILED'}`);

  if (result.success) {
    const clipUrl = `${BASE_URL}/clips/${result.jobId}/${result.jobId}_final.mp4`;
    res.json({ status: 'ready', jobId: result.jobId, clipUrl, qa: result.qa });
  } else {
    res.status(500).json({ status: 'failed', error: result.error });
  }
});

// Download endpoint — forces browser download
app.get('/download/:jobId', (req, res) => {
  const jobId = req.params.jobId;
  const filePath = join(OUTPUT_BASE, jobId, `${jobId}_final.mp4`);
  if (!existsSync(filePath)) return res.status(404).json({ error: 'Clip not found' });
  res.download(filePath, `${jobId}.mp4`);
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
  console.log(`  Base URL: ${BASE_URL}`);
  console.log(`  Webhook:  ${BASE_URL}/webhook`);
  console.log(`  Clips:    ${BASE_URL}/clips/`);
  console.log(`  Admins:   ${ADMIN_USER_IDS.length > 0 ? ADMIN_USER_IDS.join(', ') : 'all users'}`);
  console.log('');
});
