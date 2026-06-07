/**
 * Assembly Agent — merges scene videos + voice audio + captions into final MP4
 */

import { execFile } from 'child_process';
import { writeFileSync } from 'fs';
import { promisify } from 'util';
import ffmpegPath from 'ffmpeg-static';

const exec = promisify(execFile);

export async function assembleVideo({ sceneVideos, sceneVoices, srtPath, outputPath, workDir }) {
  const concatListPath = `${workDir}/concat_list.txt`;
  const videoLines = sceneVideos.map(v => `file '${v.path}'`).join('\n');
  writeFileSync(concatListPath, videoLines);

  const mergedVideoPath = `${workDir}/merged_video.mp4`;
  await exec(ffmpegPath, [
    '-y', '-f', 'concat', '-safe', '0',
    '-i', concatListPath,
    '-c', 'copy',
    mergedVideoPath,
  ], { timeout: 120000 });
  console.log('    Merged video scenes');

  const mergedAudioPath = `${workDir}/merged_audio.mp3`;
  const audioInputs = [];
  const audioFilters = [];
  sceneVoices.forEach((v, i) => {
    audioInputs.push('-i', v.path);
    audioFilters.push(`[${i}:a]`);
  });
  audioFilters.push(`concat=n=${sceneVoices.length}:v=0:a=1[outa]`);

  await exec(ffmpegPath, [
    '-y',
    ...audioInputs,
    '-filter_complex', audioFilters.join(''),
    '-map', '[outa]',
    mergedAudioPath,
  ], { timeout: 120000 });
  console.log('    Merged audio tracks');

  const subtitleFilter = srtPath
    ? `-vf subtitles=${srtPath}:force_style='FontSize=24,PrimaryColour=&H00FFFFFF,OutlineColour=&H00000000,Outline=2,Alignment=2,MarginV=120'`
    : '';

  const finalArgs = [
    '-y',
    '-i', mergedVideoPath,
    '-i', mergedAudioPath,
    '-c:v', 'libx264',
    '-c:a', 'aac',
    '-b:a', '128k',
    '-shortest',
    '-pix_fmt', 'yuv420p',
  ];

  if (srtPath) {
    finalArgs.push(
      '-vf', `subtitles=${srtPath}:force_style='FontSize=24,PrimaryColour=&H00FFFFFF,OutlineColour=&H00000000,Outline=2,Alignment=2,MarginV=120'`,
    );
  }

  finalArgs.push(outputPath);

  await exec(ffmpegPath, finalArgs, { timeout: 180000 });
  console.log(`    Final video: ${outputPath}`);

  return outputPath;
}
