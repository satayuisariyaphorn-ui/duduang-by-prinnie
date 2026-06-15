/**
 * Generate diverse background images for ดูดวง by Prinnie clips
 *
 * Usage:
 *   node --env-file=.env scripts/generate-backgrounds.mjs
 *   node --env-file=.env scripts/generate-backgrounds.mjs --count=10
 *   node --env-file=.env scripts/generate-backgrounds.mjs --category=sea
 *
 * Uses OpenAI DALL-E 3 (1024x1792 portrait). Requires OPENAI_API_KEY in .env
 */

import { writeFileSync, mkdirSync, readdirSync } from 'fs';
import { dirname, join } from 'path';
import { fileURLToPath } from 'url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const OUT = join(__dirname, '..', 'assets', 'backgrounds');

const OPENAI_KEY = process.env.OPENAI_API_KEY;
const FAL_KEY = process.env.FAL_API_KEY;
const ENGINE = OPENAI_KEY ? 'openai' : FAL_KEY ? 'fal' : null;
if (!ENGINE) {
  console.error('Need OPENAI_API_KEY or FAL_API_KEY in .env');
  process.exit(1);
}

// ─── Brand Style Suffix ─────────────────────────────────────────────────────────
// Appended to every prompt — ensures consistent look

const STYLE = `I need a beautiful vertical background image (9:16 portrait) for a short-form astrology video clip on TikTok/Reels. The image will have a slow Ken Burns pan/zoom effect applied, so it needs to look good at slight crop. Style: real photography or photorealistic render, naturally beautiful, NOT over-produced or AI-looking, NOT mystical/fantasy/dramatic — think National Geographic or Apple wallpaper quality. No text, no letters, no watermarks, no people, no faces, no hands. The subject is:`;

// ─── Prompt Library ─────────────────────────────────────────────────────────────
// Each prompt describes a real scene — the STYLE prefix gives context to the AI

const PROMPTS = [
  // ── Ocean / Sea ──
  { cat: 'sea', name: 'wave-golden',
    prompt: 'A single ocean wave caught mid-curl during golden hour. Warm sunlight shines through the translucent water. Natural beach photography feel.' },
  { cat: 'sea', name: 'calm-dawn',
    prompt: 'A perfectly calm ocean surface at dawn with soft pastel pink and lavender sky. The horizon line is clean and simple. Very serene and peaceful.' },
  { cat: 'sea', name: 'aerial-beach',
    prompt: 'Aerial drone view looking straight down at where turquoise shallow water meets a white sand beach. The color gradient from deep blue to crystal clear is the focus.' },
  { cat: 'sea', name: 'misty-coast',
    prompt: 'A rocky coastline in early morning fog. Waves gently wash over dark rocks. Long exposure makes the water look silky smooth.' },

  // ── Mountains ──
  { cat: 'mountain', name: 'cloud-sea',
    prompt: 'Mountain peaks poking through a thick layer of clouds below, seen from above. Early morning golden light hits the peaks. Layers of ridges fade into the distance.' },
  { cat: 'mountain', name: 'mirror-lake',
    prompt: 'A crystal clear mountain lake that perfectly reflects snow-capped peaks above. Some autumn-colored trees line the shore. The water is completely still like a mirror.' },
  { cat: 'mountain', name: 'sunset-layers',
    prompt: 'Silhouetted mountain ridges layered in depth at sunset. The sky transitions from warm orange near the horizon to deep purple above. Atmospheric haze between the layers.' },
  { cat: 'mountain', name: 'rice-terraces',
    prompt: 'Lush green rice terraces carved into a hillside in Southeast Asia. Soft morning mist hangs in the valleys. The terraces form beautiful curved layers.' },

  // ── Forest ──
  { cat: 'forest', name: 'bamboo-light',
    prompt: 'A grove of tall green bamboo with shafts of warm sunlight filtering through the canopy. A narrow path leads into the distance. Peaceful and calming.' },
  { cat: 'forest', name: 'autumn-trail',
    prompt: 'A winding forest trail completely covered in golden and orange autumn leaves. Sunlight filters through the colorful canopy above. The feeling of a perfect fall day.' },
  { cat: 'forest', name: 'misty-rays',
    prompt: 'A quiet forest in the early morning with mist between the trees. Golden sun rays break through the fog in visible beams. Warm, peaceful, contemplative mood.' },

  // ── Sky ──
  { cat: 'sky', name: 'above-clouds',
    prompt: 'View from above a blanket of white clouds. Golden sunset light illuminates the cloud tops from the side. Deep blue sky above. Like looking out an airplane window at the most beautiful moment.' },
  { cat: 'sky', name: 'pastel-morning',
    prompt: 'A wide open sky at sunrise with soft pastel colors — pink, peach, and light blue. Thin wispy clouds catch the warm light. Calm and hopeful morning feeling.' },
  { cat: 'sky', name: 'light-through-storm',
    prompt: 'Dark dramatic storm clouds with a single powerful beam of golden sunlight breaking through an opening. The contrast between the dark clouds and bright light is striking.' },
  { cat: 'sky', name: 'blue-hour',
    prompt: 'A clear sky during blue hour — that moment between sunset and night. Smooth gradient from deep navy blue above to a thin warm orange line at the horizon.' },

  // ── Water ──
  { cat: 'water', name: 'jungle-waterfall',
    prompt: 'A tropical waterfall flowing into a pool surrounded by lush green jungle. Ferns and moss grow on the rocks. The water is clear and the scene feels like a hidden paradise.' },
  { cat: 'water', name: 'valley-river',
    prompt: 'A winding river cutting through a green valley, seen from a high viewpoint. Morning mist hovers over the water surface. The landscape is lush and vast.' },
  { cat: 'water', name: 'raindrops-macro',
    prompt: 'Extreme close-up of fresh raindrops sitting on a bright green leaf. Each drop acts like a tiny lens. Beautiful bokeh in the background. Clean and fresh feeling.' },
  { cat: 'water', name: 'dawn-lake',
    prompt: 'A completely still lake at the first moment of dawn. A thin layer of mist sits on the water. Warm golden light just begins to touch the far shore. Total peace.' },

  // ── Flowers / Fields ──
  { cat: 'field', name: 'lavender-sunset',
    prompt: 'Rows of lavender stretching toward the horizon during golden hour. Purple flowers contrast with warm sunset light. The rows create beautiful leading lines. Provence-like landscape.' },
  { cat: 'field', name: 'sunflowers',
    prompt: 'A field of tall sunflowers all facing toward golden hour sunlight. Warm backlight glows through the petals. The feeling is bright, warm, and optimistic.' },
  { cat: 'field', name: 'wildflowers',
    prompt: 'A meadow full of colorful wildflowers with gentle mountains in the background. Many different flower types and colors. It looks untouched and naturally beautiful. Summer feeling.' },
  { cat: 'field', name: 'lotus-morning',
    prompt: 'Pink lotus flowers floating on a calm pond with green lily pads. Soft morning light. This could be a pond in the Thai countryside. Natural and peaceful.' },

  // ── Night ──
  { cat: 'night', name: 'milkyway',
    prompt: 'The Milky Way stretching across a clear night sky. Thousands of stars visible. A dark mountain landscape sits below as a silhouette. Real astrophotography look.' },
  { cat: 'night', name: 'moonlit-lake',
    prompt: 'A bright full moon reflected in a calm lake. Moonlight creates a glowing path on the water surface. Trees are silhouetted on the shore. Quiet and magical night.' },
  { cat: 'night', name: 'desert-stars',
    prompt: 'A vast desert with sand dunes under a brilliant starry sky. The stars feel close and countless. The landscape is empty and vast. A feeling of wonder and solitude.' },

  // ── Tropical / Thai ──
  { cat: 'tropical', name: 'island-above',
    prompt: 'A small tropical island seen from directly above by drone. White sand beach ring surrounded by clear turquoise water that transitions to deep blue. Palm trees on the island.' },
  { cat: 'tropical', name: 'palm-dusk',
    prompt: 'Silhouettes of palm trees against a vivid tropical sunset. The sky has layers of orange, pink, and purple. A classic beach evening scene.' },
  { cat: 'tropical', name: 'karst-emerald',
    prompt: 'Tall limestone karst rock formations rising from emerald green water. Like Phang Nga Bay or Ha Long Bay. The rocks are dramatic and the water color is stunning.' },
  { cat: 'tropical', name: 'canopy-light',
    prompt: 'Looking straight up through a dense tropical jungle canopy. Sunlight filters through many layers of green leaves creating a natural light pattern. Lush and alive.' },

  // ── Minimal / Abstract ──
  { cat: 'minimal', name: 'sand-pattern',
    prompt: 'Natural ripple patterns formed by wind in sand. Warm sidelight creates beautiful shadows in the texture. Simple, abstract, and naturally geometric.' },
  { cat: 'minimal', name: 'lone-tree',
    prompt: 'A single tree standing alone in a wide open grassy field. Warm golden hour light. Lots of open sky. The composition is very minimal with the tree small but the subject.' },
  { cat: 'minimal', name: 'golden-fog',
    prompt: 'A thick fog bank with the warm glow of sun behind it trying to break through. Everything is soft and diffused. Almost abstract. Dreamy and mysterious.' },
  { cat: 'minimal', name: 'still-water',
    prompt: 'Perfectly still water reflecting the colors of a pastel dusk sky. The thin horizon line splits the frame. Soft pink, blue, and orange tones. Extremely calm and meditative.' },
];

// ─── Generator ──────────────────────────────────────────────────────────────────

async function generateImageOpenAI(prompt, outputPath) {
  const fullPrompt = `${prompt}, ${STYLE}`;
  const res = await fetch('https://api.openai.com/v1/images/generations', {
    method: 'POST',
    headers: { 'Authorization': `Bearer ${OPENAI_KEY}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ model: 'gpt-image-1', prompt: fullPrompt, n: 1, size: '1024x1792', quality: 'medium' }),
  });
  if (!res.ok) throw new Error(`OpenAI ${res.status}: ${(await res.text()).slice(0, 300)}`);
  const data = await res.json();
  const imageUrl = data.data?.[0]?.url;
  if (!imageUrl) throw new Error('No image URL');
  const imgRes = await fetch(imageUrl);
  writeFileSync(outputPath, Buffer.from(await imgRes.arrayBuffer()));
  return outputPath;
}

async function generateImageFal(prompt, outputPath) {
  const fullPrompt = `${prompt}, ${STYLE}`;
  const FAL_MODEL = process.env.FAL_MODEL || 'fal-ai/flux/schnell';
  const res = await fetch(`https://fal.run/${FAL_MODEL}`, {
    method: 'POST',
    headers: { 'Authorization': `Key ${FAL_KEY}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ prompt: fullPrompt, image_size: 'portrait_16_9', num_images: 1 }),
  });
  if (!res.ok) throw new Error(`FAL ${res.status}: ${(await res.text()).slice(0, 200)}`);
  const data = await res.json();
  const imageUrl = data.images?.[0]?.url;
  if (!imageUrl) throw new Error('No image URL');
  const imgRes = await fetch(imageUrl);
  writeFileSync(outputPath, Buffer.from(await imgRes.arrayBuffer()));
  return outputPath;
}

async function generateImage(prompt, outputPath) {
  // Try OpenAI first, fall back to FAL
  if (OPENAI_KEY) {
    try { return await generateImageOpenAI(prompt, outputPath); } catch (e) {
      if (FAL_KEY) { console.log(`  OpenAI failed (${e.message.slice(0, 60)}), trying FAL...`); }
      else throw e;
    }
  }
  if (FAL_KEY) return await generateImageFal(prompt, outputPath);
  throw new Error('No image API available');
}

// ─── Main ───────────────────────────────────────────────────────────────────────

const args = process.argv.slice(2);
const maxCount = parseInt(args.find(a => a.startsWith('--count='))?.split('=')[1] || '0') || PROMPTS.length;
const filterCat = args.find(a => a.startsWith('--category='))?.split('=')[1];
const skipExisting = args.includes('--skip-existing');

async function main() {
  mkdirSync(OUT, { recursive: true });

  let prompts = filterCat
    ? PROMPTS.filter(p => p.cat === filterCat)
    : PROMPTS;

  prompts = prompts.slice(0, maxCount);

  const existing = new Set(readdirSync(OUT).map(f => f.replace(/\.\w+$/, '')));

  console.log(`\nGenerating ${prompts.length} background images`);
  console.log(`Output: ${OUT}\n`);

  let ok = 0, fail = 0;

  for (let i = 0; i < prompts.length; i++) {
    const { cat, name, prompt } = prompts[i];
    const filename = `${cat}-${name}.jpg`;
    const outPath = join(OUT, filename);

    if (skipExisting && existing.has(`${cat}-${name}`)) {
      console.log(`[${i + 1}/${prompts.length}] SKIP ${filename} (exists)`);
      continue;
    }

    console.log(`[${i + 1}/${prompts.length}] ${filename}`);
    console.log(`  ${prompt.slice(0, 80)}...`);

    try {
      await generateImage(prompt, outPath);
      console.log(`  OK`);
      ok++;
    } catch (e) {
      console.error(`  FAIL: ${e.message}`);
      fail++;
    }
  }

  console.log(`\nDone: ${ok} generated, ${fail} failed`);
  console.log(`Total backgrounds: ${readdirSync(OUT).filter(f => /\.(jpg|png)$/i.test(f)).length}`);
}

main().catch(e => { console.error(e); process.exit(1); });
