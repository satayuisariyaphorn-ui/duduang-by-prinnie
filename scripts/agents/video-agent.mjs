/**
 * Video Agent — generates scene videos using FFmpeg
 *
 * Mode 1 (default): Navy branded background — simple placeholder
 * Mode 2 (with images): Takes AI-generated images + applies zoom/pan (Ken Burns effect)
 *
 * Images can be placed in pipeline-output/{jobId}/images/scene_1.png etc.
 * If no image exists for a scene, falls back to navy background.
 */

import { execFile } from 'child_process';
import { existsSync, readdirSync } from 'fs';
import { promisify } from 'util';
import { dirname, join } from 'path';
import { fileURLToPath } from 'url';
import ffmpegPath from 'ffmpeg-static';

const exec = promisify(execFile);
const __dirname = dirname(fileURLToPath(import.meta.url));

const BRAND_NAVY = '0B1026';
const BACKGROUNDS_DIR = join(__dirname, '..', '..', 'assets', 'backgrounds');

const ZOOM_PAN_EFFECTS = [
  'zoompan=z=min(zoom+0.001\\,1.3):d=%d*30:x=iw/2-(iw/zoom/2):y=ih/2-(ih/zoom/2):s=1080x1920:fps=30',
  'zoompan=z=1.3:d=%d*30:x=iw/2-(iw/zoom/2)+sin(on/(%d*30)*PI*2)*50:y=ih/2-(ih/zoom/2):s=1080x1920:fps=30',
  'zoompan=z=min(zoom+0.0015\\,1.4):d=%d*30:x=0:y=0:s=1080x1920:fps=30',
  'zoompan=z=min(zoom+0.001\\,1.3):d=%d*30:x=iw-iw/zoom:y=ih/2-(ih/zoom/2):s=1080x1920:fps=30',
  'zoompan=z=1.4-in/(%d*30)*0.4:d=%d*30:x=iw/2-(iw/zoom/2):y=ih/2-(ih/zoom/2):s=1080x1920:fps=30',
];

export async function generateSceneVideo(scene, outputPath, options = {}) {
  const duration = scene.duration || 5;
  const imagePath = options.imagePath;

  if (imagePath && existsSync(imagePath)) {
    const effectIdx = (scene.scene - 1) % ZOOM_PAN_EFFECTS.length;
    let effect = ZOOM_PAN_EFFECTS[effectIdx];
    effect = effect.replace(/%d/g, String(duration));

    const args = [
      '-y',
      '-loop', '1',
      '-i', imagePath,
      '-vf', effect,
      '-c:v', 'libx264',
      '-pix_fmt', 'yuv420p',
      '-t', String(duration),
      outputPath,
    ];

    await exec(ffmpegPath, args, { timeout: 120000 });
  } else {
    const args = [
      '-y',
      '-f', 'lavfi',
      '-i', `color=c=0x${BRAND_NAVY}:s=1080x1920:d=${duration}:r=30`,
      '-c:v', 'libx264',
      '-pix_fmt', 'yuv420p',
      '-t', String(duration),
      outputPath,
    ];

    await exec(ffmpegPath, args, { timeout: 120000 });
  }

  return outputPath;
}

let _bgShuffle = { files: null, ts: 0 };
function pickStockBackground(sceneIndex) {
  if (!existsSync(BACKGROUNDS_DIR)) return null;
  // Re-shuffle every 60s so different clips get different images
  if (!_bgShuffle.files || Date.now() - _bgShuffle.ts > 60000) {
    _bgShuffle.files = readdirSync(BACKGROUNDS_DIR)
      .filter(f => /\.(jpg|jpeg|png)$/i.test(f))
      .sort(() => Math.random() - 0.5);
    _bgShuffle.ts = Date.now();
  }
  if (_bgShuffle.files.length === 0) return null;
  return join(BACKGROUNDS_DIR, _bgShuffle.files[sceneIndex % _bgShuffle.files.length]);
}

export async function generateAllSceneVideos(scenes, outputDir) {
  const results = [];

  const availableImages = [];
  for (const scene of scenes) {
    const imgPath = `${outputDir}/images/scene_${scene.scene}.png`;
    if (existsSync(imgPath)) availableImages.push({ scene: scene.scene, path: imgPath });
  }

  for (const scene of scenes) {
    const filename = `scene_${scene.scene}_video.mp4`;
    const outputPath = `${outputDir}/${filename}`;

    let imagePath = `${outputDir}/images/scene_${scene.scene}.png`;
    if (!existsSync(imagePath) && availableImages.length > 0) {
      const nearest = availableImages.reduce((best, img) =>
        Math.abs(img.scene - scene.scene) < Math.abs(best.scene - scene.scene) ? img : best
      );
      imagePath = nearest.path;
    }

    let hasImage = existsSync(imagePath);

    // Fallback to stock backgrounds if no AI-generated image
    if (!hasImage) {
      const stock = pickStockBackground(scene.scene - 1);
      if (stock) {
        imagePath = stock;
        hasImage = true;
      }
    }

    await generateSceneVideo(scene, outputPath, { imagePath: hasImage ? imagePath : null });
    results.push({ scene: scene.scene, path: outputPath });

    const mode = hasImage ? 'image+zoom' : 'navy bg';
    console.log(`    Video scene ${scene.scene}: ${filename} (${scene.duration}s, ${mode})`);
  }

  return results;
}
