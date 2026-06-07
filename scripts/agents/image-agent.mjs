/**
 * Image Agent — generates scene images using FAL.ai FLUX
 *
 * Takes visual_prompt from each scene and generates a 9:16 image.
 * Images are saved to {workDir}/images/scene_{n}.png
 */

import { writeFileSync, mkdirSync } from 'fs';

const FAL_KEY = process.env.FAL_API_KEY;
const FAL_MODEL = process.env.FAL_MODEL || 'fal-ai/flux/schnell';

const BRAND_SUFFIX = ', deep navy #0B1026 background, gold #E8C77A accents, mystical cinematic lighting, ethereal atmosphere, vertical composition, high quality';

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

export async function generateAllSceneImages(scenes, outputDir) {
  if (!FAL_KEY) {
    console.log('    No FAL_API_KEY — skipping image generation');
    return [];
  }

  const imagesDir = `${outputDir}/images`;
  mkdirSync(imagesDir, { recursive: true });

  const results = [];
  for (const scene of scenes) {
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
