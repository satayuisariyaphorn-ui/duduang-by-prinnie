/**
 * Voice Agent — generates Thai voiceover using MiniMax TTS via FAL.ai
 *
 * Uses mom's cloned voice (MiniMax voice clone)
 * Falls back to default MiniMax Thai voice if no voice_id set
 */

import { writeFileSync, existsSync } from 'fs';

const FAL_KEY = process.env.FAL_API_KEY;
const MINIMAX_VOICE_ID = process.env.MINIMAX_VOICE_ID || 'Voiceeffe72d71780906562';

async function generateVoiceMiniMax(text, outputPath) {
  if (!FAL_KEY) throw new Error('Missing FAL_API_KEY');

  const body = {
    text,
    language: 'th',
  };
  if (MINIMAX_VOICE_ID) body.voice_id = MINIMAX_VOICE_ID;

  const res = await fetch('https://fal.run/fal-ai/minimax/speech-02-hd', {
    method: 'POST',
    headers: {
      'Authorization': `Key ${FAL_KEY}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(body),
  });

  if (!res.ok) {
    const err = await res.text();
    throw new Error(`MiniMax TTS ${res.status}: ${err.slice(0, 200)}`);
  }

  const data = await res.json();
  const audioUrl = data.audio?.url;
  if (!audioUrl) throw new Error('No audio URL in MiniMax response');

  const audioRes = await fetch(audioUrl);
  if (!audioRes.ok) throw new Error(`Failed to download audio: ${audioRes.status}`);

  const buffer = Buffer.from(await audioRes.arrayBuffer());
  writeFileSync(outputPath, buffer);
  return outputPath;
}

export async function generateVoice(text, outputPath, options = {}) {
  await generateVoiceMiniMax(text, outputPath);

  if (!existsSync(outputPath)) {
    throw new Error(`Voice file not created: ${outputPath}`);
  }
  return outputPath;
}

export async function generateSceneVoices(scenes, outputDir, options = {}) {
  console.log(`    Engine: MiniMax Speech-02-HD (voice: ${MINIMAX_VOICE_ID || 'default'})`);

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
