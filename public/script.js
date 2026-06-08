const CORS_PROXY = 'https://api.allorigins.win/raw?url=';

const elements = {
  urlInput: document.getElementById('url-input'),
  fetchBtn: document.getElementById('fetch-btn'),
  pasteBtn: document.getElementById('paste-btn'),
  clearBtn: document.getElementById('clear-btn'),
  loading: document.getElementById('loading'),
  error: document.getElementById('error'),
  result: document.getElementById('result'),
  videoTitle: document.getElementById('video-title'),
  videoChannel: document.getElementById('video-channel'),
  videoDuration: document.getElementById('video-duration'),
  transcriptText: document.getElementById('transcript-text'),
  summaryText: document.getElementById('summary-text'),
  copyBtn: document.getElementById('copy-btn'),
};

let transcriptData = null;
let videoInfo = null;

function extractVideoId(url) {
  const patterns = [
    /(?:youtube\.com\/watch\?v=|youtu\.be\/|youtube\.com\/shorts\/)([a-zA-Z0-9_-]{11})/,
    /^([a-zA-Z0-9_-]{11})$/
  ];
  for (const pattern of patterns) {
    const match = url.match(pattern);
    if (match) return match[1];
  }
  return null;
}

function formatTime(seconds) {
  const h = Math.floor(seconds / 3600);
  const m = Math.floor((seconds % 3600) / 60);
  const s = Math.floor(seconds % 60);
  if (h > 0) {
    return `${h}:${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`;
  }
  return `${m}:${String(s).padStart(2, '0')}`;
}

function formatTimeSRT(seconds) {
  const h = Math.floor(seconds / 3600);
  const m = Math.floor((seconds % 3600) / 60);
  const s = Math.floor(seconds % 60);
  const ms = Math.round((seconds % 1) * 1000);
  return `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')},${String(ms).padStart(3, '0')}`;
}

function formatTimeVTT(seconds) {
  const h = Math.floor(seconds / 3600);
  const m = Math.floor((seconds % 3600) / 60);
  const s = Math.floor(seconds % 60);
  const ms = Math.round((seconds % 1) * 1000);
  return `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}.${String(ms).padStart(3, '0')}`;
}

function showLoading() {
  elements.loading.classList.remove('hidden');
  elements.error.classList.add('hidden');
  elements.result.classList.add('hidden');
}

function showError(message) {
  elements.loading.classList.add('hidden');
  elements.error.textContent = message;
  elements.error.classList.remove('hidden');
  elements.result.classList.add('hidden');
}

function showResult() {
  elements.loading.classList.add('hidden');
  elements.error.classList.add('hidden');
  elements.result.classList.remove('hidden');
}

function decodeEntities(text) {
  const el = document.createElement('textarea');
  el.innerHTML = text;
  return el.value;
}

function parseInlineJson(html, globalName) {
  const startToken = `var ${globalName} = `;
  const startIndex = html.indexOf(startToken);
  if (startIndex === -1) return null;

  const jsonStart = startIndex + startToken.length;
  let depth = 0;
  for (let i = jsonStart; i < html.length; i++) {
    if (html[i] === '{') depth++;
    else if (html[i] === '}') {
      depth--;
      if (depth === 0) {
        try {
          return JSON.parse(html.slice(jsonStart, i + 1));
        } catch {
          return null;
        }
      }
    }
  }
  return null;
}

function parseTranscriptXml(xml) {
  const results = [];

  const pRegex = /<p\s+t="(\d+)"\s+d="(\d+)"[^>]*>([\s\S]*?)<\/p>/g;
  let match;
  while ((match = pRegex.exec(xml)) !== null) {
    const startMs = parseInt(match[1], 10);
    const durMs = parseInt(match[2], 10);
    const inner = match[3];
    let text = '';
    const sRegex = /<s[^>]*>([^<]*)<\/s>/g;
    let sMatch;
    while ((sMatch = sRegex.exec(inner)) !== null) {
      text += sMatch[1];
    }
    if (!text) {
      text = inner.replace(/<[^>]+>/g, '');
    }
    text = decodeEntities(text).trim();
    if (text) {
      results.push({ text, duration: durMs, offset: startMs });
    }
  }
  if (results.length > 0) return results;

  const classicResults = [...xml.matchAll(/<text start="([^"]*)" dur="([^"]*)">([^<]*)<\/text>/g)];
  return classicResults.map((r) => ({
    text: decodeEntities(r[3]),
    duration: parseFloat(r[2]) * 1000,
    offset: parseFloat(r[1]) * 1000,
  }));
}

async function fetchWithProxy(url) {
  const resp = await fetch(CORS_PROXY + encodeURIComponent(url));
  if (!resp.ok) throw new Error(`取得に失敗しました (${resp.status})`);
  return resp.text();
}

async function fetchTranscript() {
  const url = elements.urlInput.value.trim();
  const videoId = extractVideoId(url);

  if (!videoId) {
    showError('有効なYouTube URLを入力してください');
    return;
  }

  showLoading();
  elements.fetchBtn.disabled = true;

  try {
    // Step 1: YouTubeページを取得
    const html = await fetchWithProxy(`https://www.youtube.com/watch?v=${videoId}`);

    if (html.includes('class="g-recaptcha"')) {
      throw new Error('YouTubeからのリクエストがブロックされました。しばらく待ってから再試行してください。');
    }

    // Step 2: 動画情報と字幕URLを抽出
    const playerResponse = parseInlineJson(html, 'ytInitialPlayerResponse');
    if (!playerResponse) {
      throw new Error('動画情報を取得できませんでした');
    }

    const captionTracks = playerResponse?.captions?.playerCaptionsTracklistRenderer?.captionTracks;
    if (!Array.isArray(captionTracks) || captionTracks.length === 0) {
      throw new Error('この動画には字幕がありません');
    }

    // Step 3: 日本語優先で字幕を選択
    const track = captionTracks.find(t => t.languageCode === 'ja')
      || captionTracks.find(t => t.languageCode?.startsWith('ja'))
      || captionTracks[0];

    // Step 4: 字幕XMLを取得
    const captionXml = await fetchWithProxy(track.baseUrl);

    // Step 5: パース
    const transcript = parseTranscriptXml(captionXml);
    if (!transcript.length) {
      throw new Error('字幕データが空です');
    }

    // Step 6: 動画情報
    const title = playerResponse?.videoDetails?.title || '不明';
    const channel = playerResponse?.videoDetails?.author || '不明';
    const duration = parseInt(playerResponse?.videoDetails?.lengthSeconds || '0', 10);

    videoInfo = { title, channel, duration };
    transcriptData = transcript;

    elements.videoTitle.textContent = title;
    elements.videoChannel.textContent = channel;
    elements.videoDuration.textContent = formatTime(duration);

    const transcriptWithTimestamps = transcript
      .map(item => `[${formatTime(item.offset)}] ${item.text}`)
      .join('\n');
    elements.transcriptText.textContent = transcriptWithTimestamps;

    const plainText = transcript.map(item => item.text).join(' ');
    elements.summaryText.textContent = plainText;

    showResult();
  } catch (err) {
    showError(err.message);
  } finally {
    elements.fetchBtn.disabled = false;
  }
}

function downloadFile(content, filename, type) {
  const blob = new Blob([content], { type });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  a.click();
  URL.revokeObjectURL(url);
}

function exportTXT() {
  if (!transcriptData) return;
  const text = transcriptData.map(item => `[${formatTime(item.offset)}] ${item.text}`).join('\n');
  downloadFile(text, 'transcript.txt', 'text/plain');
}

function exportSRT() {
  if (!transcriptData) return;
  const srt = transcriptData.map((item, i) => {
    const start = formatTimeSRT(item.offset);
    const end = formatTimeSRT(item.offset + item.duration);
    return `${i + 1}\n${start} --> ${end}\n${item.text}`;
  }).join('\n\n');
  downloadFile(srt, 'transcript.srt', 'text/plain');
}

function exportVTT() {
  if (!transcriptData) return;
  const cues = transcriptData.map(item => {
    const start = formatTimeVTT(item.offset);
    const end = formatTimeVTT(item.offset + item.duration);
    return `${start} --> ${end}\n${item.text}`;
  }).join('\n\n');
  const vtt = `WEBVTT\n\n${cues}`;
  downloadFile(vtt, 'transcript.vtt', 'text/vtt');
}

function exportMD() {
  if (!transcriptData || !videoInfo) return;
  let md = `# ${videoInfo.title}\n\n`;
  md += `- チャンネル: ${videoInfo.channel}\n`;
  md += `- 再生時間: ${formatTime(videoInfo.duration)}\n\n`;
  md += `## 文字起こし\n\n`;
  md += transcriptData.map(item => `**[${formatTime(item.offset)}]** ${item.text}`).join('\n\n');
  downloadFile(md, 'transcript.md', 'text/markdown');
}

async function copyToClipboard() {
  if (!transcriptData) return;
  const text = transcriptData.map(item => `[${formatTime(item.offset)}] ${item.text}`).join('\n');

  try {
    await navigator.clipboard.writeText(text);
    elements.copyBtn.textContent = '✅ コピーしました';
    elements.copyBtn.classList.add('copied');
    setTimeout(() => {
      elements.copyBtn.textContent = '📋 クリップボードにコピー';
      elements.copyBtn.classList.remove('copied');
    }, 2000);
  } catch {
    showError('クリップボードへのコピーに失敗しました');
  }
}

async function pasteUrl() {
  try {
    const text = await navigator.clipboard.readText();
    elements.urlInput.value = text;
    elements.urlInput.focus();
  } catch {
    showError('クリップボードの読み取りに失敗しました');
  }
}

function clearUrl() {
  elements.urlInput.value = '';
  elements.urlInput.focus();
  elements.error.classList.add('hidden');
}

elements.fetchBtn.addEventListener('click', fetchTranscript);
elements.pasteBtn.addEventListener('click', pasteUrl);
elements.clearBtn.addEventListener('click', clearUrl);
elements.urlInput.addEventListener('keydown', (e) => {
  if (e.key === 'Enter') fetchTranscript();
});

document.querySelectorAll('.tab').forEach(tab => {
  tab.addEventListener('click', () => {
    document.querySelectorAll('.tab').forEach(t => t.classList.remove('active'));
    document.querySelectorAll('.tab-content').forEach(c => c.classList.remove('active'));
    tab.classList.add('active');
    document.getElementById(`tab-${tab.dataset.tab}`).classList.add('active');
  });
});

document.querySelectorAll('.export-btn').forEach(btn => {
  btn.addEventListener('click', () => {
    const format = btn.dataset.format;
    if (format === 'txt') exportTXT();
    else if (format === 'srt') exportSRT();
    else if (format === 'vtt') exportVTT();
    else if (format === 'md') exportMD();
  });
});

elements.copyBtn.addEventListener('click', copyToClipboard);
