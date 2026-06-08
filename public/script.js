const API_BASE = window.location.hostname === 'localhost'
  ? 'http://127.0.0.1:8787'
  : '';

const elements = {
  urlInput: document.getElementById('url-input'),
  fetchBtn: document.getElementById('fetch-btn'),
  includeComments: document.getElementById('include-comments'),
  loading: document.getElementById('loading'),
  error: document.getElementById('error'),
  result: document.getElementById('result'),
  videoTitle: document.getElementById('video-title'),
  videoChannel: document.getElementById('video-channel'),
  videoDuration: document.getElementById('video-duration'),
  transcriptText: document.getElementById('transcript-text'),
  summaryText: document.getElementById('summary-text'),
  commentsText: document.getElementById('comments-text'),
  copyBtn: document.getElementById('copy-btn'),
};

let transcriptData = null;
let commentsData = null;
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

function displayResult(data) {
  transcriptData = data.transcript;
  commentsData = data.comments || null;
  videoInfo = {
    title: data.title || '不明',
    channel: data.channel || '不明',
    duration: data.duration || 0,
  };

  elements.videoTitle.textContent = videoInfo.title;
  elements.videoChannel.textContent = videoInfo.channel;
  elements.videoDuration.textContent = formatTime(videoInfo.duration);

  // タイムスタンプ付きテキスト
  const transcriptWithTimestamps = transcriptData
    .map(item => `[${formatTime(item.offset)}] ${item.text}`)
    .join('\n');
  elements.transcriptText.textContent = transcriptWithTimestamps;

  // 整形テキスト（タイムスタンプなし）
  const plainText = transcriptData.map(item => item.text).join(' ');
  elements.summaryText.textContent = plainText;

  // コメント表示
  if (commentsData && commentsData.length > 0) {
    const commentsFormatted = commentsData
      .map(c => `--- [${c.time}] ${c.author} (${c.likes}) ---\n${c.text}`)
      .join('\n\n');
    elements.commentsText.textContent = commentsFormatted;
  } else {
    elements.commentsText.textContent = 'コメントはありません';
  }
}

async function fetchTranscript() {
  const url = elements.urlInput.value.trim();
  const videoId = extractVideoId(url);
  const includeComments = elements.includeComments.checked;

  if (!videoId) {
    showError('有効なYouTube URLを入力してください');
    return;
  }

  showLoading();
  elements.fetchBtn.disabled = true;

  try {
    let apiUrl = `${API_BASE}/api/transcript?id=${videoId}`;
    if (includeComments) apiUrl += '&comments=true';

    const response = await fetch(apiUrl);
    const data = await response.json();

    if (!response.ok) {
      throw new Error(data.error || '文字起こしの取得に失敗しました');
    }

    displayResult(data);
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
  let text = transcriptData.map(item => `[${formatTime(item.offset)}] ${item.text}`).join('\n');
  if (commentsData && commentsData.length > 0) {
    text += '\n\n--- コメント ---\n\n';
    text += commentsData.map(c => `[${c.time}] ${c.author} (${c.likes})\n${c.text}`).join('\n\n');
  }
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
  if (commentsData && commentsData.length > 0) {
    md += `\n\n## コメント\n\n`;
    md += commentsData.map(c => `### ${c.author} (${c.likes}) - ${c.time}\n\n${c.text}`).join('\n\n');
  }
  downloadFile(md, 'transcript.md', 'text/markdown');
}

async function copyToClipboard() {
  if (!transcriptData) return;
  let text = transcriptData.map(item => `[${formatTime(item.offset)}] ${item.text}`).join('\n');
  if (commentsData && commentsData.length > 0) {
    text += '\n\n--- コメント ---\n\n';
    text += commentsData.map(c => `[${c.time}] ${c.author} (${c.likes})\n${c.text}`).join('\n\n');
  }

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

elements.fetchBtn.addEventListener('click', fetchTranscript);
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
