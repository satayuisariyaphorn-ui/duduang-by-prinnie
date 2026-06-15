/**
 * Image Agent — Visual Planner + Image Generator + Text Overlay
 *
 * Flow:
 *   1. Claude plans scenes (visuals + Thai text separately)
 *   2. For each scene → build prompt → OpenAI/FAL generates CLEAN image (no text)
 *   3. Overlay real Thai text using FFmpeg drawtext with Kanit font
 *   4. Returns array of { scene_no, path, motion_hint, duration_hint, text_overlay }
 */

import { writeFileSync, mkdirSync, existsSync } from 'fs';
import { execFile } from 'child_process';
import { promisify } from 'util';
import { dirname, join } from 'path';
import { fileURLToPath } from 'url';
import Anthropic from '@anthropic-ai/sdk';
import ffmpegPath from 'ffmpeg-static';

const execP = promisify(execFile);
const __dirname = dirname(fileURLToPath(import.meta.url));

const OPENAI_KEY = process.env.OPENAI_API_KEY;
const ANTHROPIC_KEY = process.env.ANTHROPIC_API_KEY;
const FAL_KEY = process.env.FAL_API_KEY;

const FONT_DIR = join(__dirname, '..', '..', 'assets', 'fonts');
const FONT_BOLD = join(FONT_DIR, 'Kanit-Bold.ttf');
const FONT_MEDIUM = join(FONT_DIR, 'Kanit-Medium.ttf');
const FONT_REGULAR = join(FONT_DIR, 'Kanit-Regular.ttf');

// ─── Visual Planner (Claude) ────────────────────────────────────────────────────

const PLANNER_SYSTEM = `You are a Thai astrology video creative planner.

Your job is to convert a Thai fortune-telling voice transcript into:
1. Image background prompts with NO text inside the image
2. Thai text overlays that will be added later by the video system

Output JSON only. Do not explain. Do not use markdown.

Critical rule:
Never ask the image model to generate Thai text inside the image.
All Thai text must be placed in the "text_overlay" field only.
The image_prompt must always include: "Do not include any text, letters, words, numbers, watermark, logo, Thai text, or English text."

Rules:
1. If transcript is under 60 seconds, create 1-3 scenes.
2. If transcript is 1-3 minutes, create 3-5 scenes.
3. If transcript is over 3 minutes, create 5-8 scenes.
4. Each image_prompt creates only the visual background, never text.
5. Thai headline maximum 8 words.
6. Thai subheadline maximum 12 words.
7. Thai caption maximum 18 words.
8. Avoid horror, scary, dark magic, violent, sexual, political, copyrighted visuals.
9. Keep visuals premium, mystical, elegant, trustworthy, social-media ready.
10. Leave empty space in upper and lower thirds for text overlay.
11. Do not create too many scenes — image generation has API cost.

Return this JSON schema:

{
  "video_summary": "",
  "fortune_topic": "",
  "recommended_scene_count": 0,
  "aspect_ratio": "9:16",
  "brand_style": "premium Thai astrology social video",
  "caption": "Thai social media caption for posting, under 150 chars",
  "hashtags": ["#ดูดวง", "#ดูดวงbyPrinnie", "...relevant tags"],
  "scenes": [
    {
      "scene_no": 1,
      "duration_hint_seconds": 0,
      "purpose": "",
      "image_prompt": "...visual description... Do not include any text, letters, words, numbers, watermark, logo, Thai text, or English text.",
      "text_overlay": {
        "headline": "short Thai headline, max 8 words",
        "subheadline": "Thai subheadline, max 12 words",
        "caption": "Thai caption, max 18 words"
      },
      "motion_hint": "",
      "layout_hint": "headline top center, subheadline middle, caption bottom",
      "negative_prompt": "text, letters, words, numbers, watermark, logo, Thai text, English text, unreadable typography, fake letters, distorted zodiac signs, distorted animals, scary face, horror, dark magic, low quality, blurry, messy composition"
    }
  ]
}`;

export async function planScenes(scriptText, audioDuration) {
  if (!ANTHROPIC_KEY) throw new Error('Missing ANTHROPIC_API_KEY');

  const client = new Anthropic({ apiKey: ANTHROPIC_KEY });
  const durInfo = audioDuration ? `\nEstimated audio duration: ${Math.round(audioDuration)} seconds` : '';

  const response = await client.messages.create({
    model: 'claude-haiku-4-5-20251001',
    max_tokens: 2048,
    temperature: 0.3,
    system: PLANNER_SYSTEM,
    messages: [{
      role: 'user',
      content: `Plan video scenes for this Thai astrology script:${durInfo}\n\n"${scriptText}"`,
    }],
  });

  const rawText = response.content[0]?.text ?? '';
  const jsonMatch = rawText.match(/\{[\s\S]*\}/);
  if (!jsonMatch) throw new Error('Visual planner returned no JSON');

  const plan = JSON.parse(jsonMatch[0]);

  if (!plan.scenes || !Array.isArray(plan.scenes) || plan.scenes.length === 0) {
    throw new Error('Visual planner returned no scenes');
  }

  return plan;
}

// ─── Image Prompt Builder ───────────────────────────────────────────────────────

function buildFinalPrompt(scene) {
  const negativePrompt = scene.negative_prompt ||
    'text, letters, words, numbers, watermark, logo, Thai text, English text, unreadable typography, fake letters, distorted zodiac signs, distorted animals, scary face, horror, dark magic, low quality, blurry, messy composition';

  return `Create a premium vertical 9:16 background image for a Thai astrology social media video.

IMPORTANT:
Do not include any text, letters, words, numbers, captions, watermark, logo, Thai text, English text, or readable typography inside the image.

Scene purpose:
${scene.purpose || 'background for fortune-telling content'}

Visual:
${scene.image_prompt || 'A luxurious mystical astrology background with glowing golden zodiac energy, soft stars, moonlight, celestial ornaments, sacred geometry. Deep navy blue and royal purple with golden glow.'}

Composition:
Vertical mobile video background.
Keep the center visually beautiful but not too crowded.
Leave clean empty space in the upper third and lower third for text overlay.
No face close-up. No strange animals. No horror. No dark magic. No messy symbols.
Safe margins for social media UI.

Brand style:
Premium Thai astrology, mystical, elegant, trustworthy, cinematic, high detail, deep navy blue, royal purple, gold, soft white, warm golden glow.

Lighting:
Soft cinematic glow, golden particles, subtle stars, elegant spiritual atmosphere.

Avoid:
${negativePrompt}`.trim();
}

// ─── Image Generation ───────────────────────────────────────────────────────────

async function generateWithOpenAI(prompt, outputPath) {
  if (!OPENAI_KEY) throw new Error('Missing OPENAI_API_KEY');

  const res = await fetch('https://api.openai.com/v1/images/generations', {
    method: 'POST',
    headers: { 'Authorization': `Bearer ${OPENAI_KEY}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({
      model: 'gpt-image-1',
      prompt,
      n: 1,
      size: '1024x1792',
      quality: 'high',
      output_format: 'png',
    }),
  });

  if (!res.ok) throw new Error(`OpenAI ${res.status}: ${(await res.text()).slice(0, 300)}`);
  const data = await res.json();

  if (data.data?.[0]?.b64_json) {
    writeFileSync(outputPath, Buffer.from(data.data[0].b64_json, 'base64'));
    return;
  }
  const url = data.data?.[0]?.url;
  if (!url) throw new Error('No image in response');
  const img = await fetch(url);
  writeFileSync(outputPath, Buffer.from(await img.arrayBuffer()));
}

async function generateWithFal(prompt, outputPath) {
  if (!FAL_KEY) throw new Error('Missing FAL_API_KEY');
  const model = process.env.FAL_MODEL || 'fal-ai/flux/schnell';
  const res = await fetch(`https://fal.run/${model}`, {
    method: 'POST',
    headers: { 'Authorization': `Key ${FAL_KEY}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ prompt, image_size: 'portrait_16_9', num_images: 1 }),
  });
  if (!res.ok) throw new Error(`FAL ${res.status}: ${(await res.text()).slice(0, 200)}`);
  const data = await res.json();
  const url = data.images?.[0]?.url;
  if (!url) throw new Error('No image URL');
  const img = await fetch(url);
  writeFileSync(outputPath, Buffer.from(await img.arrayBuffer()));
}

async function generateImage(prompt, outputPath) {
  if (OPENAI_KEY) {
    try { await generateWithOpenAI(prompt, outputPath); return 'openai'; } catch (e) {
      console.log(`    OpenAI failed: ${e.message.slice(0, 80)}`);
    }
  }
  if (FAL_KEY) {
    await generateWithFal(prompt, outputPath);
    return 'fal';
  }
  throw new Error('No image API key (OPENAI_API_KEY or FAL_API_KEY)');
}

// ─── Thai Text Overlay (FFmpeg drawtext) ────────────────────────────────────────

function escapeDrawtext(text) {
  return text.replace(/[\\':]/g, c => '\\' + c);
}

export async function overlayThaiText(inputPath, outputPath, textOverlay) {
  if (!textOverlay || typeof textOverlay === 'string') return inputPath;

  const { headline, subheadline, caption } = textOverlay;
  if (!headline && !subheadline && !caption) return inputPath;

  const hasFonts = existsSync(FONT_BOLD);
  if (!hasFonts) {
    console.log('    No Kanit font found — skipping text overlay');
    return inputPath;
  }

  const filters = [];

  if (headline) {
    filters.push(
      `drawtext=fontfile='${FONT_BOLD}':text='${escapeDrawtext(headline)}'` +
      `:fontsize=64:fontcolor=white:borderw=3:bordercolor=black@0.6` +
      `:shadowcolor=black@0.5:shadowx=2:shadowy=2` +
      `:x=(w-text_w)/2:y=200`
    );
  }

  if (subheadline) {
    filters.push(
      `drawtext=fontfile='${FONT_MEDIUM}':text='${escapeDrawtext(subheadline)}'` +
      `:fontsize=44:fontcolor=#E8C77A:borderw=2:bordercolor=black@0.5` +
      `:shadowcolor=black@0.4:shadowx=1:shadowy=1` +
      `:x=(w-text_w)/2:y=h/2-22`
    );
  }

  if (caption) {
    filters.push(
      `drawtext=fontfile='${FONT_REGULAR}':text='${escapeDrawtext(caption)}'` +
      `:fontsize=36:fontcolor=white@0.95:borderw=2:bordercolor=black@0.5` +
      `:shadowcolor=black@0.4:shadowx=1:shadowy=1` +
      `:x=(w-text_w)/2:y=h-280`
    );
  }

  const filterStr = filters.join(',');

  await execP(ffmpegPath, [
    '-y', '-i', inputPath,
    '-vf', filterStr,
    '-q:v', '2',
    outputPath,
  ], { timeout: 30000 });

  return outputPath;
}

// ─── Public: Plan + Generate All ────────────────────────────────────────────────

export async function generateSceneImages(scriptText, workDir, audioDuration) {
  const imagesDir = `${workDir}/images`;
  mkdirSync(imagesDir, { recursive: true });

  console.log(`    Planning scenes...`);
  const plan = await planScenes(scriptText, audioDuration);
  console.log(`    Plan: ${plan.scenes.length} scenes, topic: ${plan.fortune_topic}`);

  writeFileSync(`${workDir}/visual-plan.json`, JSON.stringify(plan, null, 2));

  const results = [];
  for (const scene of plan.scenes) {
    const rawFile = `scene_${scene.scene_no}_raw.png`;
    const finalFile = `scene_${scene.scene_no}.png`;
    const rawPath = `${imagesDir}/${rawFile}`;
    const finalPath = `${imagesDir}/${finalFile}`;
    const prompt = buildFinalPrompt(scene);

    console.log(`    Scene ${scene.scene_no}: ${scene.purpose?.slice(0, 50) || 'generating'}...`);

    try {
      const engine = await generateImage(prompt, rawPath);
      console.log(`    Scene ${scene.scene_no}: image OK (${engine})`);

      // Overlay Thai text with real font
      let usePath = rawPath;
      if (scene.text_overlay && typeof scene.text_overlay === 'object') {
        try {
          await overlayThaiText(rawPath, finalPath, scene.text_overlay);
          usePath = existsSync(finalPath) ? finalPath : rawPath;
          if (usePath === finalPath) console.log(`    Scene ${scene.scene_no}: text overlay OK`);
        } catch (e) {
          console.log(`    Scene ${scene.scene_no}: text overlay failed (${e.message.slice(0, 60)})`);
          usePath = rawPath;
        }
      }

      results.push({
        scene_no: scene.scene_no,
        path: usePath,
        duration_hint: scene.duration_hint_seconds || 5,
        motion_hint: scene.motion_hint || 'slow zoom in',
        text_overlay: scene.text_overlay || {},
        engine,
      });
    } catch (e) {
      console.log(`    Scene ${scene.scene_no}: FAILED (${e.message.slice(0, 60)})`);
    }
  }

  return { plan, images: results };
}

// ─── Legacy API (backward compatible) ───────────────────────────────────────────

export async function generateSceneImage(scene, outputPath, options = {}) {
  const scriptText = options.scriptText || scene.voice || scene.visual_prompt || '';
  const prompt = buildFinalPrompt({
    purpose: 'background for astrology content',
    image_prompt: `Premium astrology artwork matching: ${scriptText.slice(0, 200)}. Do not include any text, letters, words, numbers, watermark, logo, Thai text, or English text.`,
    text_overlay: {},
    negative_prompt: 'text, letters, words, numbers, watermark, logo, Thai text, English text, unreadable typography, fake letters, distorted zodiac signs, horror, scary, low quality, blurry',
  });
  await generateImage(prompt, outputPath);
  return outputPath;
}

export async function generateAllSceneImages(scenes, outputDir, options = {}) {
  if (!OPENAI_KEY && !FAL_KEY) {
    console.log('    No image API key — skipping');
    return [];
  }
  const imagesDir = `${outputDir}/images`;
  mkdirSync(imagesDir, { recursive: true });

  const max = parseInt(process.env.MAX_IMAGES || '2');
  const picked = scenes.slice(0, max);

  const results = [];
  for (const scene of picked) {
    const filename = `scene_${scene.scene}.png`;
    const outputPath = `${imagesDir}/${filename}`;
    try {
      await generateSceneImage(scene, outputPath, options);
      results.push({ scene: scene.scene, path: outputPath });
    } catch (e) {
      console.log(`    Image scene ${scene.scene}: FAILED (${e.message.slice(0, 60)})`);
    }
  }
  return results;
}
