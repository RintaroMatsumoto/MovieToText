const fs = require('fs');

const vtt = fs.readFileSync(process.env.TEMP + '\\yt_video.ja.vtt', 'utf8');
const lines = vtt.split('\n');

function toSeconds(t) {
  const m = t.match(/^(\d{2}):(\d{2}):(\d{2})/);
  if (!m) return 0;
  return parseInt(m[1]) * 3600 + parseInt(m[2]) * 60 + parseInt(m[3]);
}

const cues = [];
let i = 0;
while (i < lines.length) {
  const line = lines[i].trim();
  const match = line.match(/^(\d{2}:\d{2}:\d{2}\.\d{3})\s+-->\s+(\d{2}:\d{2}:\d{2}\.\d{3})/);
  if (match) {
    const start = match[1];
    const end = match[2];
    i++;
    const textLines = [];
    while (i < lines.length && lines[i].trim() !== '') {
      let text = lines[i].trim();
      text = text.replace(/<\d{2}:\d{2}:\d{2}\.\d{3}>/g, '');
      text = text.replace(/<\/?c>/g, '');
      text = text.replace(/<v[^>]*>/g, '');
      text = text.replace(/<[^>]+>/g, '');
      if (text) textLines.push(text);
      i++;
    }
    const text = textLines.join(' ');
    if (text) cues.push({ start, end, text });
  } else {
    i++;
  }
}

// Filter out very short cues (~0.01s are the "cleaned" intermediates)
const longCues = cues.filter(c => (toSeconds(c.end) - toSeconds(c.start)) > 0.1);

// Apply prefix-based dedup
const deduped = [];
for (let j = 0; j < longCues.length; j++) {
  const c = longCues[j];
  if (deduped.length > 0) {
    const prev = deduped[deduped.length - 1];
    if (c.text.startsWith(prev.text) && c.text.length > prev.text.length) {
      deduped.pop();
    } else if (prev.text === c.text) {
      continue;
    }
  }
  deduped.push(c);
}

// For each consecutive pair, find the longest common substring (LCS) at the boundary
// The common substring is typically at the end of cue[i] AND at the start of cue[i+1]
// We need to remove that substring from cue[i]
function longestCommonSubstring(s1, s2) {
  // Find longest substring that ends in s1 and starts in s2
  // This is essentially finding the LCS in O(n*m) time
  if (!s1 || !s2) return '';
  const len1 = s1.length, len2 = s2.length;
  // We need the substring to be at the end of s1 and at the start of s2
  // So we want: s1.substr(len1-k) === s2.substr(0, k) for max k
  // But the substring can be anywhere in s1, not just at the end
  // Use a smarter approach: find the longest substring of s2 that appears in s1
  // and prefer those that are at the end of s1
  let bestLen = 0;
  let bestEnd = -1;
  // For each possible length k from min(len1, len2) down to some min
  for (let k = Math.min(len1, len2); k >= 5; k--) {
    // Check if any length-k substring of s1 equals any prefix of s2
    for (let i1 = 0; i1 + k <= len1; i1++) {
      const sub = s1.substring(i1, i1 + k);
      if (s2.startsWith(sub)) {
        // Prefer matches that are at the end of s1 (higher i1)
        if (i1 + k === len1 || k > bestLen || (k === bestLen && i1 > bestEnd)) {
          bestLen = k;
          bestEnd = i1;
          break;
        }
      }
    }
    if (bestLen > 0) break;
  }
  if (bestLen > 0) return s1.substring(bestEnd, bestEnd + bestLen);
  return '';
}

// Now process deduped array: for each cue, remove the overlap with the next cue
const trimmed = [];
for (let j = 0; j < deduped.length; j++) {
  let c = { ...deduped[j] };
  if (j + 1 < deduped.length) {
    const overlap = longestCommonSubstring(c.text, deduped[j + 1].text);
    if (overlap && c.text.endsWith(overlap)) {
      c.text = c.text.substring(0, c.text.length - overlap.length).trim();
    }
  }
  if (c.text) trimmed.push(c);
}

// Filter out music/clap markers
const finalCues = trimmed.filter(c => {
  const t = c.text.trim();
  if (!t) return false;
  if (/^\[音楽\]$/.test(t)) return false;
  if (/^\[拍手\]$/.test(t)) return false;
  if (t === '[音楽]') return false;
  if (t === '[拍手]') return false;
  return true;
});

console.log('Final cue count:', finalCues.length);

let out = '';
finalCues.forEach(c => {
  out += `[${c.start.substring(0, 8)}] ${c.text}\n`;
});

fs.writeFileSync(process.env.TEMP + '\\transcript_clean.txt', out, 'utf8');
console.log('Saved transcript_clean.txt');
console.log('File size:', fs.statSync(process.env.TEMP + '\\transcript_clean.txt').size, 'bytes');
