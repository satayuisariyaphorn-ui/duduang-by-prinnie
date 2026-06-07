/**
 * Video Agent — generates placeholder scene videos using FFmpeg
 *
 * Creates branded visuals (navy bg + gold text + captions) per scene.
 * Replace with Runway/Pika/HyperFrame API when ready.
 */

import { execFile } from 'child_process';
import { promisify } from 'util';
import ffmpegPath from 'ffmpeg-static';

const exec = promisify(execFile);

const BRAND = {
  navy: '0B1026',
  gold: 'E8C77A',
  white: 'FFFFFF',
};

export async function generateSceneVideo(scene, outputPath, options = {}) {
  const duration = scene.duration || 5;
  const width = options.width || 1080;
  const height = options.height || 1920;

  const captionText = (scene.caption_text || '').replace(/'/g, "'\\''");
  const typeLabel = `[${scene.type || 'content'}]`.toUpperCase();

  const args = [
    '-y',
    '-f', 'lavfi',
    '-i', `color=c=0x${BRAND.navy}:s=${width}x${height}:d=${duration}:r=30`,
    '-vf', [
      `drawtext=text='${typeLabel}':fontcolor=0x${BRAND.gold}:fontsize=36:x=(w-text_w)/2:y=200`,
      `drawtext=text='Scene ${scene.scene}':fontcolor=0x${BRAND.gold}:fontsize=48:x=(w-text_w)/2:y=280`,
      `drawtext=text='${captionText}':fontcolor=0x${BRAND.white}:fontsize=56:x=(w-text_w)/2:y=(h-text_h)/2:line_spacing=20`,
      `drawtext=text='${duration}s':fontcolor=0x${BRAND.gold}:fontsize=32:x=(w-text_w)/2:y=h-200`,
    ].join(','),
    '-c:v', 'libx264',
    '-pix_fmt', 'yuv420p',
    '-t', String(duration),
    outputPath,
  ];

  await exec(ffmpegPath, args, { timeout: 120000 });
  return outputPath;
}

export async function generateAllSceneVideos(scenes, outputDir) {
  const results = [];

  for (const scene of scenes) {
    const filename = `scene_${scene.scene}_video.mp4`;
    const outputPath = `${outputDir}/${filename}`;
    await generateSceneVideo(scene, outputPath);
    results.push({ scene: scene.scene, path: outputPath });
    console.log(`    Video scene ${scene.scene}: ${filename} (${scene.duration}s)`);
  }

  return results;
}
