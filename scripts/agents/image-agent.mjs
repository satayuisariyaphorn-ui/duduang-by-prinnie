/**
 * Image Agent — generates scene images using FAL.ai FLUX
 *
 * Takes visual_prompt from each scene and generates a 9:16 image.
 * Images are saved to {workDir}/images/scene_{n}.png
 */

import { writeFileSync, mkdirSync } from 'fs';

const FAL_KEY = process.env.FAL_API_KEY;
const FAL_MODEL = process.env.FAL_MODEL || 'fal-ai/flux/schnell';

const BRAND_SUFFIX = ', MU-VERSE tarot card art style: ornate illustrated mystical artwork like a premium tarot card, rich detailed illustration with gold ornamental frame and border, dark navy and deep purple background with golden accents, painted in classical tarot illustration style with modern polish, characters can appear as mystical archetypes (priestess, emperor, magician) in flowing robes with celestial elements, Thai-Eastern spiritual aesthetic blended with tarot imagery, golden lotus motifs and sacred geometry in the borders, luminous glowing elements with volumetric light, gemstone accents ruby emerald sapphire, starfield and cosmic nebula, ultra detailed beautiful artwork, portrait composition 9:16, NO photographs, NO realistic faces, NO modern clothing, NO text, NO letters, NO watermarks';

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
