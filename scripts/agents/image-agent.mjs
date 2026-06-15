/**
 * Image Agent — Visual Planner + Image Generator
 *
 * Flow:
 *   1. Claude plans scenes from script (how many, what visual, motion hint)
 *   2. For each scene → build prompt → OpenAI gpt-image-1 generates image
 *   3. Returns array of { scene_no, path, motion_hint, duration_hint, text_overlay }
 */

import { writeFileSync, mkdirSync, existsSync } from 'fs';
import Anthropic from '@anthropic-ai/sdk';

const OPENAI_KEY = process.env.OPENAI_API_KEY;
const ANTHROPIC_KEY = process.env.ANTHROPIC_API_KEY;
const FAL_KEY = process.env.FAL_API_KEY;

// ─── Visual Planner (Claude) ────────────────────────────────────────────────────

const PLANNER_SYSTEM = `You are a Thai astrology video visual planner.

Your job is to convert a Thai fortune-telling voice transcript into visual prompts for social media video production.

Output JSON only. Do not explain. Do not use markdown.

The output will be used to generate images for a vertical short video such as TikTok, Reels, Shorts, Facebook, and LINE VOOM.

Create a small set of image scenes that match the video content.

Rules:
1. If the transcript is under 60 seconds, create 1-3 image scenes.
2. If the transcript is 1-3 minutes, create 3-5 image scenes.
3. If the transcript is over 3 minutes, create 5-8 image scenes.
4. Each scene must be visually different but use the same premium astrology brand style.
5. Do not create too many scenes because image generation has API cost.
6. Each scene should work as a video background with zoom, pan, and text overlay.
7. Keep visuals beautiful, mystical, premium, trustworthy, and suitable for Thai horoscope content.
8. Avoid horror, scary dark magic, distorted faces, distorted hands, messy text, watermark, logo, and unreadable text.
9. Thai text overlay must be short, maximum 8 Thai words.
10. Do not include copyrighted characters, celebrities, sexual content, violence, or political content.

Return this JSON schema:

{
  "video_summary": "",
  "fortune_topic": "",
  "recommended_scene_count": 0,
  "estimated_image_cost_thb": 0,
  "video_style": "premium Thai astrology social video",
  "aspect_ratio": "9:16",
  "caption": "Thai social media caption for posting, under 150 chars",
  "hashtags": ["#ดูดวง", "#ดูดวงbyPrinnie", "...relevant tags"],
  "scenes": [
    {
      "scene_no": 1,
      "duration_hint_seconds": 0,
      "purpose": "",
      "image_prompt": "",
      "text_overlay": "",
      "motion_hint": "",
      "negative_prompt": "low quality, blurry, distorted face, distorted hands, extra fingers, watermark, logo, messy text, unreadable text, horror, scary"
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

  // Validate
  if (!plan.scenes || !Array.isArray(plan.scenes) || plan.scenes.length === 0) {
    throw new Error('Visual planner returned no scenes');
  }

  return plan;
}

// ─── Image Generation ───────────────────────────────────────────────────────────

function buildFinalPrompt(scene) {
  return `Create a premium vertical 9:16 image for a Thai astrology social media video.

Scene purpose:
${scene.purpose || 'background for fortune-telling content'}

Visual prompt:
${scene.image_prompt || 'premium mystical astrology scene with golden light and celestial elements'}

Text overlay:
${scene.text_overlay ? `Add short Thai text: "${scene.text_overlay}"` : 'No text on image.'}

Composition:
Vertical mobile video background, clean center composition, cinematic lighting, enough empty space for captions, suitable for slow zoom and pan motion.

Brand style:
Premium Thai astrology, mystical, beautiful, elegant, trustworthy, social media ready, high detail, deep navy blue, gold, soft white, violet glow.

Avoid:
${scene.negative_prompt || 'low quality, blurry, distorted face, distorted hands, extra fingers, watermark, logo, messy text, unreadable text, horror, scary'}`;
}

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

// ─── Public: Plan + Generate All ────────────────────────────────────────────────

export async function generateSceneImages(scriptText, workDir, audioDuration) {
  const imagesDir = `${workDir}/images`;
  mkdirSync(imagesDir, { recursive: true });

  // Step 1: Claude plans scenes
  console.log(`    Planning scenes...`);
  const plan = await planScenes(scriptText, audioDuration);
  console.log(`    Plan: ${plan.scenes.length} scenes, topic: ${plan.fortune_topic}, ~${plan.estimated_image_cost_thb || '?'} THB`);

  writeFileSync(`${workDir}/visual-plan.json`, JSON.stringify(plan, null, 2));

  // Step 2: Generate image for each scene
  const results = [];
  for (const scene of plan.scenes) {
    const filename = `scene_${scene.scene_no}.png`;
    const outputPath = `${imagesDir}/${filename}`;
    const prompt = buildFinalPrompt(scene);

    console.log(`    Scene ${scene.scene_no}: ${scene.purpose?.slice(0, 50) || 'generating'}...`);

    try {
      const engine = await generateImage(prompt, outputPath);
      results.push({
        scene_no: scene.scene_no,
        path: outputPath,
        duration_hint: scene.duration_hint_seconds || 5,
        motion_hint: scene.motion_hint || 'slow zoom in',
        text_overlay: scene.text_overlay || '',
        engine,
      });
      console.log(`    Scene ${scene.scene_no}: OK (${engine})`);
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
    image_prompt: scene.visual_prompt || `Premium astrology artwork matching: ${scriptText.slice(0, 200)}`,
    text_overlay: '',
    negative_prompt: 'low quality, blurry, distorted face, distorted hands, extra fingers, watermark, logo, horror, scary',
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
