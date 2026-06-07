/**
 * Voice Agent — generates Thai voiceover audio
 *
 * Uses ElevenLabs (mom's cloned voice) if API key is set,
 * falls back to Edge TTS (free) otherwise.
 */

import { execFile, execSync } from 'child_process';
import { existsSync, writeFileSync } from 'fs';
import { promisify } from 'util';

const exec = promisify(execFile);

const ELEVENLABS_KEY = process.env.ELEVENLABS_API_KEY;
const ELEVENLABS_VOICE = process.env.ELEVENLABS_VOICE_ID || '8eNH5E5PK5o9E5l2mGYe';

async function generateVoiceElevenLabs(text, outputPath) {
  const res = await fetch(`https://api.elevenlabs.io/v1/text-to-speech/${ELEVENLABS_VOICE}`, {
    method: 'POST',
    headers: {
      'xi-api-key': ELEVENLABS_KEY,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      text,
      model_id: 'eleven_multilingual_v2',
      voice_settings: { stability: 0.5, similarity_boost: 0.75 },
    }),
  });

  if (!res.ok) {
    const err = await res.text();
    throw new Error(`ElevenLabs ${res.status}: ${err.slice(0, 200)}`);
  }

  const buffer = Buffer.from(await res.arrayBuffer());
  writeFileSync(outputPath, buffer);
  return outputPath;
}

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
    return null;
  }
}

async function generateVoiceEdgeTTS(text, outputPath) {
  const bin = findEdgeTts();
  if (!bin) throw new Error('No TTS engine available. Set ELEVENLABS_API_KEY or install edge-tts.');

  await exec(bin, [
    '--text', text,
    '--voice', 'th-TH-PremwadeeNeural',
    '--rate=-12%',
    '--pitch=-2Hz',
    '--write-media', outputPath,
  ], { timeout: 60000 });

  return outputPath;
}

export async function generateVoice(text, outputPath, options = {}) {
  if (ELEVENLABS_KEY) {
    await generateVoiceElevenLabs(text, outputPath);
  } else {
    await generateVoiceEdgeTTS(text, outputPath);
  }

  if (!existsSync(outputPath)) {
    throw new Error(`Voice file not created: ${outputPath}`);
  }
  return outputPath;
}

export async function generateSceneVoices(scenes, outputDir, options = {}) {
  const engine = ELEVENLABS_KEY ? 'ElevenLabs' : 'Edge TTS';
  console.log(`    Engine: ${engine}`);

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
