/**
 * Image Agent — Voice-to-Image Pipeline
 *
 * Flow: script text → Claude extracts structured JSON → build prompt → OpenAI gpt-image-1
 *
 * Uses Claude Haiku to understand the script content and extract:
 *   content_theme, fortune_topic, main_visual, supporting_symbols,
 *   mood, color_palette, style, composition, text_overlay, negative_prompt
 *
 * Then builds a structured prompt and generates via OpenAI gpt-image-1
 */

import { writeFileSync, mkdirSync } from 'fs';
import Anthropic from '@anthropic-ai/sdk';

const OPENAI_KEY = process.env.OPENAI_API_KEY;
const ANTHROPIC_KEY = process.env.ANTHROPIC_API_KEY;
const FAL_KEY = process.env.FAL_API_KEY;

// ─── Step 1: Claude extracts structured JSON from script ────────────────────────

const EXTRACT_SYSTEM = `You are an image prompt extraction engine for a Thai astrology and spiritual image generation system.

Your job is to convert Thai astrology script text into a strict JSON object.

Rules:
1. Output JSON only.
2. Do not explain.
3. Do not use markdown.
4. Do not invent important details that were not implied.
5. If the request is vague, fill missing fields with safe premium astrology defaults.
6. Keep Thai meaning, but make style/composition fields suitable for image generation.
7. Never include unsafe, sexual, hateful, violent, or copyrighted character requests.

JSON schema:
{
  "content_theme": "Thai description of the fortune theme",
  "fortune_topic": "love | money | career | health | luck | general",
  "main_visual": "English description of the main visual subject",
  "supporting_symbols": ["symbol1", "symbol2"],
  "mood": "Thai description of the mood and feeling",
  "color_palette": "color1, color2, color3",
  "style": "premium mystical cinematic digital art, luxury astrology branding, high detail, elegant lighting",
  "composition": "vertical 9:16 social media cover, centered subject, cinematic lighting",
  "social_format": "vertical 9:16",
  "text_overlay": "",
  "negative_prompt": "low quality, blurry, distorted face, distorted hands, extra fingers, watermark, logo, horror, scary"
}

Default values if not implied by the script:
- fortune_topic: "general"
- main_visual: "a mystical female spiritual guide surrounded by soft golden light with zodiac wheel behind"
- color_palette: "deep navy blue, gold, soft white, violet glow"
- style: "premium mystical cinematic digital art, luxury astrology branding, high detail, elegant lighting"`;

async function extractImageJSON(scriptText) {
  if (!ANTHROPIC_KEY) throw new Error('Missing ANTHROPIC_API_KEY');

  const client = new Anthropic({ apiKey: ANTHROPIC_KEY });

  const response = await client.messages.create({
    model: 'claude-haiku-4-5-20251001',
    max_tokens: 1024,
    temperature: 0.2,
    system: EXTRACT_SYSTEM,
    messages: [{
      role: 'user',
      content: `Extract image generation data from this Thai astrology script. Return valid JSON only:\n\n"${scriptText}"`,
    }],
  });

  const rawText = response.content[0]?.text ?? '';
  const jsonMatch = rawText.match(/\{[\s\S]*\}/);
  if (!jsonMatch) {
    // Retry once
    const retry = await client.messages.create({
      model: 'claude-haiku-4-5-20251001',
      max_tokens: 1024,
      temperature: 0,
      system: EXTRACT_SYSTEM,
      messages: [{
        role: 'user',
        content: `Extract image generation data from this Thai astrology script. Return valid JSON only. No markdown:\n\n"${scriptText}"`,
      }],
    });
    const retryText = retry.content[0]?.text ?? '';
    const retryMatch = retryText.match(/\{[\s\S]*\}/);
    if (!retryMatch) throw new Error('Claude JSON parse failed after retry');
    return JSON.parse(retryMatch[0]);
  }

  return JSON.parse(jsonMatch[0]);
}

// ─── Step 2: Validate JSON ──────────────────────────────────────────────────────

function validateImageJSON(data) {
  if (!data.main_visual || data.main_visual.length < 5) {
    data.main_visual = 'a mystical female spiritual guide surrounded by soft golden light with zodiac wheel behind';
  }
  if (!data.fortune_topic) data.fortune_topic = 'general';
  if (!data.color_palette) data.color_palette = 'deep navy blue, gold, soft white, violet glow';
  if (!data.style) data.style = 'premium mystical cinematic digital art, luxury astrology branding, high detail, elegant lighting';
  if (!data.composition) data.composition = 'vertical 9:16 social media cover, centered subject, cinematic lighting';
  if (!data.mood) data.mood = 'mystical, warm, hopeful';
  if (!data.supporting_symbols) data.supporting_symbols = ['zodiac wheel', 'golden light', 'stars'];
  if (!data.negative_prompt) data.negative_prompt = 'low quality, blurry, distorted face, distorted hands, extra fingers, watermark, logo, horror, scary';
  if (!data.social_format) data.social_format = 'vertical 9:16';

  // Limit text overlay
  if (data.text_overlay && data.text_overlay.length > 30) {
    data.text_overlay = data.text_overlay.slice(0, 30);
  }

  return data;
}

// ─── Step 3: Build final image prompt ───────────────────────────────────────────

function buildSocialImagePrompt(data) {
  let prompt = `Create a premium vertical social media artwork for a Thai astrology / fortune-telling brand.

Core theme:
${data.content_theme || data.fortune_topic}

Fortune topic:
${data.fortune_topic}

Main visual:
${data.main_visual}

Supporting symbols:
${Array.isArray(data.supporting_symbols) ? data.supporting_symbols.join(', ') : data.supporting_symbols}

Mood:
${data.mood}

Visual style:
${data.style}

Color palette:
${data.color_palette}

Composition:
${data.composition}

Format:
${data.social_format}`;

  if (data.text_overlay) {
    prompt += `

Text overlay:
Add short Thai headline text: "${data.text_overlay}"
Make the Thai text beautiful, clean, readable, and premium.
Place the text in a clean empty area, not covering the main subject.`;
  }

  prompt += `

Brand feeling:
Premium astrology app, mystical but trustworthy, elegant, modern, high-conversion social media creative.

Avoid:
${data.negative_prompt}`;

  return prompt.trim();
}

// ─── Step 4: Generate image via OpenAI gpt-image-1 ─────────────────────────────

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

  // gpt-image-1 returns b64_json
  if (data.data?.[0]?.b64_json) {
    writeFileSync(outputPath, Buffer.from(data.data[0].b64_json, 'base64'));
    return outputPath;
  }

  // Fallback: URL-based response
  const imageUrl = data.data?.[0]?.url;
  if (!imageUrl) throw new Error('No image in OpenAI response');
  const imgRes = await fetch(imageUrl);
  writeFileSync(outputPath, Buffer.from(await imgRes.arrayBuffer()));
  return outputPath;
}

// ─── Fallback: FAL.ai ──────────────────────────────────────────────────────────

async function generateWithFal(prompt, outputPath) {
  if (!FAL_KEY) throw new Error('Missing FAL_API_KEY');

  const FAL_MODEL = process.env.FAL_MODEL || 'fal-ai/flux/schnell';
  const res = await fetch(`https://fal.run/${FAL_MODEL}`, {
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
  return outputPath;
}

// ─── Public API ─────────────────────────────────────────────────────────────────

export async function generateSceneImage(scene, outputPath, options = {}) {
  // Use script text if available for better context
  const scriptText = options.scriptText || scene.voice || scene.visual_prompt || '';

  let imageData;
  let finalPrompt;

  try {
    // Step 1: Claude extracts structured JSON
    console.log(`    Extracting image data from script...`);
    imageData = await extractImageJSON(scriptText);
    imageData = validateImageJSON(imageData);

    // Step 2: Build structured prompt
    finalPrompt = buildSocialImagePrompt(imageData);
    console.log(`    Topic: ${imageData.fortune_topic} | Visual: ${imageData.main_visual?.slice(0, 60)}...`);
  } catch (e) {
    console.log(`    JSON extraction failed (${e.message.slice(0, 50)}), using visual_prompt directly`);
    finalPrompt = scene.visual_prompt || `Premium mystical astrology artwork, vertical 9:16, elegant, cinematic lighting, deep navy blue and gold, ${scriptText.slice(0, 100)}`;
  }

  // Step 3: Generate image — OpenAI first, FAL fallback
  if (OPENAI_KEY) {
    try {
      await generateWithOpenAI(finalPrompt, outputPath);
      console.log(`    Generated via OpenAI gpt-image-1`);
      return outputPath;
    } catch (e) {
      console.log(`    OpenAI failed: ${e.message.slice(0, 80)}`);
    }
  }

  if (FAL_KEY) {
    await generateWithFal(finalPrompt, outputPath);
    console.log(`    Generated via FAL (fallback)`);
    return outputPath;
  }

  throw new Error('No image API key available (OPENAI_API_KEY or FAL_API_KEY)');
}

export async function generateAllSceneImages(scenes, outputDir, options = {}) {
  if (!OPENAI_KEY && !FAL_KEY) {
    console.log('    No image API key — skipping image generation');
    return [];
  }

  const imagesDir = `${outputDir}/images`;
  mkdirSync(imagesDir, { recursive: true });

  const pickedScenes = pickBestScenes(scenes, parseInt(process.env.MAX_IMAGES || '2'));
  console.log(`    Generating ${pickedScenes.length} images (scenes ${pickedScenes.map(s => s.scene).join(', ')})`);

  const results = [];
  for (const scene of pickedScenes) {
    const filename = `scene_${scene.scene}.png`;
    const outputPath = `${imagesDir}/${filename}`;

    try {
      await generateSceneImage(scene, outputPath, options);
      results.push({ scene: scene.scene, path: outputPath });
      console.log(`    Image scene ${scene.scene}: ${filename}`);
    } catch (err) {
      console.log(`    Image scene ${scene.scene}: FAILED (${err.message.slice(0, 60)})`);
    }
  }

  return results;
}

function pickBestScenes(scenes, max) {
  if (scenes.length <= max) return scenes;
  const hook = scenes.find(s => s.type === 'hook');
  const content = scenes.filter(s => s.type === 'content');
  const picked = [];
  if (hook) picked.push(hook);
  for (const s of content) {
    if (picked.length >= max) break;
    picked.push(s);
  }
  if (picked.length < max) {
    for (const s of scenes) {
      if (picked.length >= max) break;
      if (!picked.includes(s)) picked.push(s);
    }
  }
  return picked.sort((a, b) => a.scene - b.scene);
}
