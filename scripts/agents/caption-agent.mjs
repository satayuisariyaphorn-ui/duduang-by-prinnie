/**
 * Caption Agent — generates SRT subtitle file from scene data
 */

export function generateSRT(scenes) {
  let srt = '';
  let startMs = 0;

  for (const scene of scenes) {
    const endMs = startMs + (scene.duration * 1000);
    const startTime = formatSRTTime(startMs);
    const endTime = formatSRTTime(endMs);
    const text = scene.caption_text || scene.voice;

    srt += `${scene.scene}\n`;
    srt += `${startTime} --> ${endTime}\n`;
    srt += `${text}\n\n`;

    startMs = endMs;
  }

  return srt.trim();
}

function formatSRTTime(ms) {
  const hours = Math.floor(ms / 3600000);
  const minutes = Math.floor((ms % 3600000) / 60000);
  const seconds = Math.floor((ms % 60000) / 1000);
  const millis = ms % 1000;
  return `${pad(hours)}:${pad(minutes)}:${pad(seconds)},${pad3(millis)}`;
}

function pad(n) { return String(n).padStart(2, '0'); }
function pad3(n) { return String(n).padStart(3, '0'); }
