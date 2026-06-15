/**
 * Image Agent — generates scene images for video clips
 *
 * Tries OpenAI (gpt-image-1) first for best quality,
 * falls back to FAL.ai FLUX if OpenAI unavailable.
 *
 * Images are saved to {workDir}/images/scene_{n}.png
 */

import { writeFileSync, mkdirSync } from 'fs';

const OPENAI_KEY = process.env.OPENAI_API_KEY;
const FAL_KEY = process.env.FAL_API_KEY;
const FAL_MODEL = process.env.FAL_MODEL || 'fal-ai/flux/schnell';

const CONTEXT = `I need a beautiful background image for a short-form astrology video clip (TikTok/Reels). The image will have a slow Ken Burns pan/zoom effect, so it should look good when slightly cropped. Style: photorealistic, naturally beautiful like National Geographic or Apple wallpaper. NOT fantasy, NOT overly dramatic, NOT mystical symbols. Vertical 9:16 portrait format. No text, no letters, no watermarks, no people, no faces, no hands.`;

async function generateWithOpenAI(prompt, outputPath) {
  const fullPrompt = `${CONTEXT}\n\nScene description: ${prompt}`;
  const res = await fetch('https://api.openai.com/v1/images/generations', {
    method: 'POST',
    headers: { 'Authorization': `Bearer ${OPENAI_KEY}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ model: 'gpt-image-1', prompt: fullPrompt, n: 1, size: '1024x1792', quality: 'medium' }),
  });
  if (!res.ok) throw new Error(`OpenAI ${res.status}: ${(await res.text()).slice(0, 200)}`);
  const data = await res.json();
  const url = data.data?.[0]?.url;
  if (!url) throw new Error('No image URL');
  const img = await fetch(url);
  writeFileSync(outputPath, Buffer.from(await img.arrayBuffer()));
}

async function generateWithFal(prompt, outputPath) {
  const fullPrompt = `${prompt}, vertical 9:16, photorealistic landscape photography, beautiful natural scene, high quality, no text, no people`;
  const res = await fetch(`https://fal.run/${FAL_MODEL}`, {
    method: 'POST',
    headers: { 'Authorization': `Key ${FAL_KEY}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ prompt: fullPrompt, image_size: 'portrait_16_9', num_images: 1 }),
  });
  if (!res.ok) throw new Error(`FAL ${res.status}: ${(await res.text()).slice(0, 200)}`);
  const data = await res.json();
  const url = data.images?.[0]?.url;
  if (!url) throw new Error('No image URL');
  const img = await fetch(url);
  writeFileSync(outputPath, Buffer.from(await img.arrayBuffer()));
}

export async function generateSceneImage(scene, outputPath) {
  const prompt = scene.visual_prompt || `beautiful natural landscape for astrology content about ${scene.caption_text || 'zodiac reading'}`;

  if (OPENAI_KEY) {
    try { await generateWithOpenAI(prompt, outputPath); return outputPath; } catch (e) {
      console.log(`    OpenAI image failed: ${e.message.slice(0, 80)}`);
    }
  }
  if (FAL_KEY) {
    await generateWithFal(prompt, outputPath);
    return outputPath;
  }
  throw new Error('No image API key (OPENAI_API_KEY or FAL_API_KEY)');
}

const MAX_IMAGES = parseInt(process.env.MAX_IMAGES || '2');

export async function generateAllSceneImages(scenes, outputDir) {
  if (!FAL_KEY) {
    console.log('    No FAL_API_KEY — skipping image generation');
    return [];
  }

  const imagesDir = `${outputDir}/images`;
  mkdirSync(imagesDir, { recursive: true });

  const pickedScenes = pickBestScenes(scenes, MAX_IMAGES);
  console.log(`    Generating ${pickedScenes.length} images (scenes ${pickedScenes.map(s => s.scene).join(', ')})`);

  const results = [];
  for (const scene of pickedScenes) {
    const filename = `scene_${scene.scene}.png`;
    const outputPath = `${imagesDir}/${filename}`;

    try {
      await generateSceneImage(scene, outputPath);
      results.push({ scene: scene.scene, path: outputPath });
      console.log(`    Image scene ${scene.scene}: ${filename}`);
    } catch (err) {
      console.log(`    Image scene ${scene.scene}: FAILED (${err.message}) — using navy bg`);
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
