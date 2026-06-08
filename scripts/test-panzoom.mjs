/**
 * Test pan/zoom (Ken Burns) effect on images
 *
 * Usage: node scripts/test-panzoom.mjs [image-path]
 *
 * Generates a 10-second demo clip for each zoompan effect style,
 * then a combined preview clip. Output goes to pipeline-output/test-panzoom/
 */

import { execFile } from 'child_process';
import { existsSync, mkdirSync, writeFileSync } from 'fs';
import { dirname, join, resolve } from 'path';
import { fileURLToPath } from 'url';
import { promisify } from 'util';
import ffmpegPath from 'ffmpeg-static';

const exec = promisify(execFile);
const __dirname = dirname(fileURLToPath(import.meta.url));
const OUT = join(__dirname, '..', 'pipeline-output', 'test-panzoom');

const DEFAULT_IMAGE = resolve(__dirname, '../../muverse/assets/wallpapers/moon-01-full-ocean.jpg');
const imagePath = process.argv[2] || DEFAULT_IMAGE;

if (!existsSync(imagePath)) {
  console.error(`Image not found: ${imagePath}`);
  process.exit(1);
}

const DURATION = 8;

const EFFECTS = [
  { name: 'slow-zoom-in-center', filter: `zoompan=z=min(zoom+0.001\\,1.3):d=${DURATION}*30:x=iw/2-(iw/zoom/2):y=ih/2-(ih/zoom/2):s=1080x1920:fps=30` },
  { name: 'drift-zoom-wave', filter: `zoompan=z=1.3:d=${DURATION}*30:x=iw/2-(iw/zoom/2)+sin(on/(${DURATION}*30)*PI*2)*50:y=ih/2-(ih/zoom/2):s=1080x1920:fps=30` },
  { name: 'zoom-in-top-left', filter: `zoompan=z=min(zoom+0.0015\\,1.4):d=${DURATION}*30:x=0:y=0:s=1080x1920:fps=30` },
  { name: 'zoom-in-right', filter: `zoompan=z=min(zoom+0.001\\,1.3):d=${DURATION}*30:x=iw-iw/zoom:y=ih/2-(ih/zoom/2):s=1080x1920:fps=30` },
  { name: 'zoom-out-center', filter: `zoompan=z=1.4-in/(${DURATION}*30)*0.4:d=${DURATION}*30:x=iw/2-(iw/zoom/2):y=ih/2-(ih/zoom/2):s=1080x1920:fps=30` },
];

async function run() {
  mkdirSync(OUT, { recursive: true });
  console.log(`\nTest Pan/Zoom Effects`);
  console.log(`Image: ${imagePath}`);
  console.log(`Duration: ${DURATION}s per effect`);
  console.log(`Output: ${OUT}\n`);

  const videos = [];

  for (let i = 0; i < EFFECTS.length; i++) {
    const { name, filter } = EFFECTS[i];
    const outPath = join(OUT, `effect_${i + 1}_${name}.mp4`);
    console.log(`[${i + 1}/${EFFECTS.length}] ${name}...`);

    try {
      await exec(ffmpegPath, [
        '-y', '-loop', '1', '-i', imagePath,
        '-vf', filter,
        '-c:v', 'libx264', '-pix_fmt', 'yuv420p', '-t', String(DURATION),
        outPath,
      ], { timeout: 120000 });
      console.log(`  OK: ${outPath}`);
      videos.push(outPath);
    } catch (e) {
      console.error(`  FAILED: ${e.message}`);
    }
  }

  // Combine all effects into one preview
  if (videos.length > 1) {
    console.log(`\nCombining ${videos.length} effects into preview...`);
    const concatPath = join(OUT, 'concat.txt');
    writeFileSync(concatPath, videos.map(v => `file '${v}'`).join('\n'));
    const previewPath = join(OUT, 'preview_all_effects.mp4');
    await exec(ffmpegPath, [
      '-y', '-f', 'concat', '-safe', '0', '-i', concatPath,
      '-c', 'copy', previewPath,
    ], { timeout: 120000 });
    console.log(`Preview: ${previewPath}`);
  }

  console.log(`\nDone! Open files in ${OUT}`);
}

run().catch(e => { console.error(e); process.exit(1); });
