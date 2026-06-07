/**
 * Voice Agent — generates Thai voiceover audio using Edge TTS (free)
 *
 * Supports multiple Thai voices:
 *   - th-TH-PremwadeeNeural (female, default — warm & mystical)
 *   - th-TH-NiwatNeural (male)
 */

import { execFile, execSync } from 'child_process';
import { existsSync } from 'fs';
import { promisify } from 'util';

const exec = promisify(execFile);

function findEdgeTts() {
  const candidates = [
    process.env.EDGE_TTS_BIN,
    '/Users/bon/Library/Python/3.9/bin/edge-tts',
    '/usr/local/bin/edge-tts',
    '/usr/bin/edge-tts',
  ].filter(Boolean);
  for (const p of candidates) {
    if (existsSync(p)) return p;
  }
  try {
    return execSync('which edge-tts', { encoding: 'utf-8' }).trim();
  } catch {
    throw new Error('edge-tts not found. Install: pip3 install edge-tts');
  }
}

const EDGE_TTS_BIN = findEdgeTts();
const DEFAULT_VOICE = 'th-TH-PremwadeeNeural';

export async function generateVoice(text, outputPath, options = {}) {
  const voice = options.voice || DEFAULT_VOICE;
  const rate = options.rate || '-12%';
  const pitch = options.pitch || '-2Hz';

  const args = [
    '--text', text,
    '--voice', voice,
    `--rate=${rate}`,
    `--pitch=${pitch}`,
    '--write-media', outputPath,
  ];

  await exec(EDGE_TTS_BIN, args, { timeout: 60000 });

  if (!existsSync(outputPath)) {
    throw new Error(`Voice file not created: ${outputPath}`);
  }

  return outputPath;
}

export async function generateSceneVoices(scenes, outputDir, options = {}) {
  const results = [];

  for (const scene of scenes) {
    const filename = `scene_${scene.scene}_voice.mp3`;
    const outputPath = `${outputDir}/${filename}`;

    await generateVoice(scene.voice, outputPath, options);
    results.push({ scene: scene.scene, path: outputPath });
    console.log(`    Voice scene ${scene.scene}: ${filename}`);
  }

  return results;
}

export const AVAILABLE_VOICES = {
  'premwadee': { id: 'th-TH-PremwadeeNeural', gender: 'female', desc: 'อบอุ่น นุ่มนวล' },
  'niwat': { id: 'th-TH-NiwatNeural', gender: 'male', desc: 'หนักแน่น มั่นคง' },
};
