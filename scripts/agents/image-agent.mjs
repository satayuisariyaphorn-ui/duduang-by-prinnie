/**
 * Image Agent — generates scene images using FAL.ai FLUX
 *
 * Takes visual_prompt from each scene and generates a 9:16 image.
 * Images are saved to {workDir}/images/scene_{n}.png
 */

import { writeFileSync, mkdirSync } from 'fs';

const FAL_KEY = process.env.FAL_API_KEY;
const FAL_MODEL = process.env.FAL_MODEL || 'fal-ai/flux/schnell';

const BRAND_SUFFIX = ', Thai-Eastern mystical art style inspired by MU-VERSE: luminous glowing object floating in dark cosmic void, Thai Buddhist and Hindu spiritual aesthetic, golden neon linework like Thai temple art (ลายไทย), lotus motifs and Thai floral patterns, sacred yantra and mandala geometry, warm gold and deep purple energy glow, photorealistic 3D render with volumetric lighting, single mystical object centered as hero element, pitch black background with golden sparkle particles, reflective surface below creating mirror effect, Thai spiritual symbols: glowing golden lotus (บัว), Thai celestial wheel (กงจักร), sacred thread (สายสิญจน์), golden Buddha aura light, temple bell, incense smoke trails, Thai offering flowers (ดอกดาวเรือง), gold leaf texture, emerald and ruby gemstone accents, Southeast Asian spiritual luxury, NOT Western, NOT Celtic, NOT Norse, NO people, NO faces, NO human figures, NO hands, NO bodies, NO text, NO letters';

export async function generateSceneImage(scene, outputPath) {
  if (!FAL_KEY) throw new Error('Missing FAL_API_KEY');

  const prompt = (scene.visual_prompt || `mystical astrology scene ${scene.caption_text || ''}`) + BRAND_SUFFIX;

  const res = await fetch(`https://fal.run/${FAL_MODEL}`, {
    method: 'POST',
    headers: {
      'Authorization': `Key ${FAL_KEY}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      prompt,
      image_size: 'portrait_16_9',
      num_images: 1,
    }),
  });

  if (!res.ok) {
    const err = await res.text();
    throw new Error(`FAL.ai ${res.status}: ${err.slice(0, 200)}`);
  }

  const data = await res.json();
  const imageUrl = data.images?.[0]?.url;
  if (!imageUrl) throw new Error('No image URL in FAL response');

  const imgRes = await fetch(imageUrl);
  if (!imgRes.ok) throw new Error(`Failed to download image: ${imgRes.status}`);

  const buffer = Buffer.from(await imgRes.arrayBuffer());
  writeFileSync(outputPath, buffer);
  return outputPath;
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
