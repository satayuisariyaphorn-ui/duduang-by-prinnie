/**
 * Generate diverse background images for ดูดวง by Prinnie clips
 *
 * Usage:
 *   node --env-file=.env scripts/generate-backgrounds.mjs
 *   node --env-file=.env scripts/generate-backgrounds.mjs --count=10
 *   node --env-file=.env scripts/generate-backgrounds.mjs --category=cosmic
 *
 * Requires FAL_API_KEY in .env
 */

import { writeFileSync, mkdirSync, readdirSync } from 'fs';
import { dirname, join } from 'path';
import { fileURLToPath } from 'url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const OUT = join(__dirname, '..', 'assets', 'backgrounds');

const FAL_KEY = process.env.FAL_API_KEY;
const FAL_MODEL = process.env.FAL_MODEL || 'fal-ai/flux/schnell';

if (!FAL_KEY) {
  console.error('Missing FAL_API_KEY in .env');
  process.exit(1);
}

// ─── Brand Style Suffix ─────────────────────────────────────────────────────────
// Appended to every prompt — ensures consistent look

const STYLE = 'vertical 9:16, professional landscape photography, high resolution, natural colors, NO text NO letters NO watermarks NO words NO people NO faces NO hands';

// ─── Prompt Library ─────────────────────────────────────────────────────────────
// Beautiful scenic views — natural, not over-produced, social-media friendly

const PROMPTS = [
  // ── Ocean / Sea ──
  { cat: 'sea', name: 'wave-sunset',
    prompt: 'ocean wave curling at golden hour, warm sunlight through the water, foam and spray, beach photography' },
  { cat: 'sea', name: 'calm-sea-horizon',
    prompt: 'perfectly calm ocean at dawn, pastel pink and blue sky, clean horizon line, minimal serene seascape' },
  { cat: 'sea', name: 'aerial-turquoise',
    prompt: 'aerial drone view of turquoise tropical water meeting white sand beach, gradient from deep blue to clear shallow' },
  { cat: 'sea', name: 'rocky-coast-mist',
    prompt: 'misty rocky coastline, waves crashing on dark rocks, long exposure silky water, moody morning fog' },

  // ── Mountains / Hills ──
  { cat: 'mountain', name: 'foggy-peaks',
    prompt: 'mountain peaks emerging from sea of clouds, early morning golden light, layered mountain ridges fading into distance' },
  { cat: 'mountain', name: 'alpine-lake',
    prompt: 'crystal clear alpine lake perfectly reflecting snow-capped mountains, autumn colored trees on shore, mirror-still water' },
  { cat: 'mountain', name: 'sunset-ridge',
    prompt: 'mountain ridge silhouette at sunset, orange and purple sky, layered mountain ranges, warm atmospheric haze' },
  { cat: 'mountain', name: 'rice-terrace',
    prompt: 'green rice terraces on hillside in morning mist, layered paddy fields, Southeast Asian landscape, soft warm light' },

  // ── Forest / Trees ──
  { cat: 'forest', name: 'bamboo-grove',
    prompt: 'tall bamboo grove with sunlight filtering through, green canopy overhead, peaceful path, Japanese garden atmosphere' },
  { cat: 'forest', name: 'autumn-path',
    prompt: 'forest path covered in golden autumn leaves, warm sunlight through orange and red canopy, fall season' },
  { cat: 'forest', name: 'morning-mist-trees',
    prompt: 'forest with morning mist between trees, golden sun rays breaking through fog, warm peaceful atmosphere' },
  { cat: 'forest', name: 'mangrove-water',
    prompt: 'mangrove forest with roots in still water, green reflections, tropical wetland, calm natural beauty' },

  // ── Sky / Clouds ──
  { cat: 'sky', name: 'cotton-clouds',
    prompt: 'aerial view above white fluffy cloud layer, golden sunset light from side, blue sky above, airplane window perspective' },
  { cat: 'sky', name: 'pink-sunrise',
    prompt: 'pastel pink and orange sunrise sky, soft gradient clouds, wide open sky, calm morning colors' },
  { cat: 'sky', name: 'storm-light',
    prompt: 'dramatic storm clouds with single beam of golden sunlight breaking through, contrast of dark and light, powerful sky' },
  { cat: 'sky', name: 'twilight-gradient',
    prompt: 'clear sky at blue hour twilight, smooth gradient from deep blue to warm orange at horizon, minimal and clean' },

  // ── Water / Rivers ──
  { cat: 'water', name: 'waterfall-jungle',
    prompt: 'tropical waterfall in lush green jungle, smooth flowing water, ferns and moss, natural paradise' },
  { cat: 'water', name: 'river-bend',
    prompt: 'winding river through green valley from high viewpoint, morning mist over water, lush landscape' },
  { cat: 'water', name: 'rain-drops-leaf',
    prompt: 'macro close-up of rain drops on green leaf, water beading on surface, fresh after rain, bokeh background' },
  { cat: 'water', name: 'lake-morning',
    prompt: 'still lake at early morning, thin mist over water surface, warm first light touching far shore, peaceful dawn' },

  // ── Flowers / Fields ──
  { cat: 'field', name: 'lavender-rows',
    prompt: 'rows of lavender field stretching to horizon, purple flowers in warm sunset light, Provence style landscape' },
  { cat: 'field', name: 'sunflower-golden',
    prompt: 'field of sunflowers facing golden hour sun, warm backlight through petals, summer feeling, bright and happy' },
  { cat: 'field', name: 'wildflower-meadow',
    prompt: 'colorful wildflower meadow with mountains in background, variety of flowers, natural untouched beauty, summer' },
  { cat: 'field', name: 'lotus-pond',
    prompt: 'pink lotus flowers on calm pond, green lily pads, soft morning light, Thai countryside, natural beauty' },

  // ── Night / Stars ──
  { cat: 'night', name: 'milkyway-clear',
    prompt: 'clear Milky Way across night sky, thousands of stars, dark mountain landscape below, astrophotography' },
  { cat: 'night', name: 'moon-over-lake',
    prompt: 'full moon reflected in calm lake, moonlight path on water, trees silhouetted, quiet night scene' },
  { cat: 'night', name: 'starry-desert',
    prompt: 'starry night sky over desert sand dunes, stars reflecting warm tones, vast empty landscape, solitude and wonder' },

  // ── Tropical / Southeast Asian ──
  { cat: 'tropical', name: 'island-aerial',
    prompt: 'small tropical island from above, white sand surrounded by turquoise water, palm trees, paradise beach drone shot' },
  { cat: 'tropical', name: 'palm-sunset',
    prompt: 'palm tree silhouettes against colorful tropical sunset, orange pink purple sky, beach evening' },
  { cat: 'tropical', name: 'karst-islands',
    prompt: 'limestone karst islands in emerald green water, Phang Nga Bay style, dramatic rock formations, Thai seascape' },
  { cat: 'tropical', name: 'jungle-canopy',
    prompt: 'looking up through dense tropical jungle canopy, sunlight filtering through green leaves, lush overhead view' },

  // ── Soft / Minimal ──
  { cat: 'minimal', name: 'sand-ripples',
    prompt: 'natural ripple patterns in sand, warm sidelight creating shadows, abstract natural texture, zen simplicity' },
  { cat: 'minimal', name: 'single-tree',
    prompt: 'single tree standing alone in open field, warm golden hour light, wide negative space, minimalist landscape' },
  { cat: 'minimal', name: 'fog-horizon',
    prompt: 'thick fog with faint warm glow of sun behind it, minimalist nothing-scape, soft diffused light, dreamy atmosphere' },
  { cat: 'minimal', name: 'calm-reflection',
    prompt: 'perfectly still water reflecting sky colors at dusk, thin horizon line dividing frame, pastel tones, serene' },
];

// ─── Generator ──────────────────────────────────────────────────────────────────

async function generateImage(prompt, outputPath) {
  const fullPrompt = `${prompt}, ${STYLE}`;

  const res = await fetch(`https://fal.run/${FAL_MODEL}`, {
    method: 'POST',
    headers: {
      'Authorization': `Key ${FAL_KEY}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      prompt: fullPrompt,
      image_size: 'portrait_16_9',
      num_images: 1,
    }),
  });

  if (!res.ok) {
    const err = await res.text();
    throw new Error(`FAL ${res.status}: ${err.slice(0, 200)}`);
  }

  const data = await res.json();
  const imageUrl = data.images?.[0]?.url;
  if (!imageUrl) throw new Error('No image URL in response');

  const imgRes = await fetch(imageUrl);
  if (!imgRes.ok) throw new Error(`Download failed: ${imgRes.status}`);

  const buffer = Buffer.from(await imgRes.arrayBuffer());
  writeFileSync(outputPath, buffer);
  return outputPath;
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
