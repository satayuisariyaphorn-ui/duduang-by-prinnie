/**
 * ดูดวง by Prinnie — Review & Approve Tool
 *
 * Review all generated clips, play audio, and approve/reject each one.
 *
 * Usage:
 *   npm run review                # review all ready clips
 *   npm run review -- --date=2026-06-07  # specific date
 *   npm run review -- --open      # auto-open each video
 */

import { readFileSync, writeFileSync, readdirSync, existsSync } from 'fs';
import { dirname, join } from 'path';
import { fileURLToPath } from 'url';
import { createInterface } from 'readline';
import { execSync } from 'child_process';

const __dirname = dirname(fileURLToPath(import.meta.url));
const OUTPUT_BASE = join(__dirname, 'pipeline-output');

const args = process.argv.slice(2);
const dateFilter = args.find(a => a.startsWith('--date='))?.split('=')[1];
const autoOpen = args.includes('--open');

function askUser(question) {
  const rl = createInterface({ input: process.stdin, output: process.stdout });
  return new Promise(resolve => {
    rl.question(question, answer => { rl.close(); resolve(answer.trim().toLowerCase()); });
  });
}

async function main() {
  console.log('\n╔══════════════════════════════════════════════════════════════╗');
  console.log('║       ดูดวง by Prinnie — Review & Approve                  ║');
  console.log('╚══════════════════════════════════════════════════════════════╝\n');

  if (!existsSync(OUTPUT_BASE)) {
    console.log('  No output found. Run batch-generate first.\n');
    return;
  }

  const dirs = readdirSync(OUTPUT_BASE, { withFileTypes: true })
    .filter(d => d.isDirectory())
    .map(d => d.name)
    .filter(d => !dateFilter || d.includes(dateFilter))
    .sort();

  const toReview = [];
  for (const dir of dirs) {
    const statusPath = join(OUTPUT_BASE, dir, 'status.json');
    const scriptPath = join(OUTPUT_BASE, dir, 'script.json');
    if (!existsSync(statusPath) || !existsSync(scriptPath)) continue;

    const status = JSON.parse(readFileSync(statusPath, 'utf-8'));
    if (status.status === 'ready_for_review') {
      const script = JSON.parse(readFileSync(scriptPath, 'utf-8'));
      toReview.push({ dir, script, statusPath });
    }
  }

  if (toReview.length === 0) {
    console.log('  No clips pending review.\n');

    const approved = dirs.filter(d => {
      const sp = join(OUTPUT_BASE, d, 'status.json');
      if (!existsSync(sp)) return false;
      return JSON.parse(readFileSync(sp, 'utf-8')).status === 'approved';
    });
    const rejected = dirs.filter(d => {
      const sp = join(OUTPUT_BASE, d, 'status.json');
      if (!existsSync(sp)) return false;
      return JSON.parse(readFileSync(sp, 'utf-8')).status === 'rejected';
    });

    if (approved.length > 0 || rejected.length > 0) {
      console.log(`  Approved: ${approved.length}`);
      console.log(`  Rejected: ${rejected.length}\n`);
    }
    return;
  }

  console.log(`  ${toReview.length} clips pending review\n`);

  let approvedCount = 0;
  let rejectedCount = 0;

  for (let i = 0; i < toReview.length; i++) {
    const { dir, script, statusPath } = toReview[i];

    console.log(`━━━ [${i + 1}/${toReview.length}] ${script.zodiac_sign} / ${script.content_type} ━━━`);
    console.log(`  ID:       ${script.video_id}`);
    console.log(`  Platform: ${script.platform}`);
    console.log(`  Duration: ${script.duration}s`);
    console.log('');
    console.log('  VOICEOVER:');
    console.log(`  ${script.voiceover_text}`);
    console.log('');
    console.log(`  CAPTION: ${script.caption}`);
    console.log(`  CTA:     ${script.cta}`);
    console.log(`  TAGS:    ${script.hashtags?.join(' ')}`);
    console.log('');

    for (const s of script.scenes) {
      console.log(`    Scene ${s.scene} [${s.type}] ${s.duration}s`);
      console.log(`      "${s.voice}"`);
    }

    if (autoOpen) {
      const finalVideo = join(OUTPUT_BASE, dir, `${dir}_final.mp4`);
      if (existsSync(finalVideo)) {
        try { execSync(`open "${finalVideo}"`, { stdio: 'ignore' }); } catch {}
      }
    }

    console.log('');
    const answer = await askUser(`  [${i + 1}/${toReview.length}] Approve? (y)es / (n)o / (s)kip / (o)pen video / (q)uit: `);

    if (answer === 'q' || answer === 'quit') {
      console.log('\n  Review paused.\n');
      break;
    }

    if (answer === 'o' || answer === 'open') {
      const finalVideo = join(OUTPUT_BASE, dir, `${dir}_final.mp4`);
      if (existsSync(finalVideo)) {
        try { execSync(`open "${finalVideo}"`, { stdio: 'ignore' }); } catch {}
      }
      const answer2 = await askUser(`  After watching — approve? (y/n): `);
      if (answer2 === 'y' || answer2 === 'yes') {
        writeFileSync(statusPath, JSON.stringify({ status: 'approved', approved_by: 'human', approved_at: new Date().toISOString() }, null, 2));
        approvedCount++;
        console.log('  APPROVED\n');
      } else {
        writeFileSync(statusPath, JSON.stringify({ status: 'rejected', approved_at: new Date().toISOString() }, null, 2));
        rejectedCount++;
        console.log('  REJECTED\n');
      }
    } else if (answer === 'y' || answer === 'yes') {
      writeFileSync(statusPath, JSON.stringify({ status: 'approved', approved_by: 'human', approved_at: new Date().toISOString() }, null, 2));
      approvedCount++;
      console.log('  APPROVED\n');
    } else if (answer === 'n' || answer === 'no') {
      writeFileSync(statusPath, JSON.stringify({ status: 'rejected', approved_at: new Date().toISOString() }, null, 2));
      rejectedCount++;
      console.log('  REJECTED\n');
    } else {
      console.log('  SKIPPED\n');
    }
  }

  console.log('━━━ Review Summary ━━━');
  console.log(`  Approved: ${approvedCount}`);
  console.log(`  Rejected: ${rejectedCount}`);
  console.log(`  Remaining: ${toReview.length - approvedCount - rejectedCount}\n`);
}

main().catch(err => {
  console.error('Review error:', err);
  process.exit(1);
});
