const API_BASE = window.location.hostname === 'localhost'
  ? 'http://127.0.0.1:8787'
  : 'https://movie-to-text-api.matsumotoinla.workers.dev';

const i18n = {
  ja: {
    pageTitle: 'SubGet - YouTube字幕取得ツール',
    subtitle: 'YouTube動画の字幕を簡単に取得',
    urlLabel: 'YouTube URLを入力してください',
    fetchBtn: '字幕を取得',
    hint: '対応形式: youtube.com/watch, youtu.be, /shorts/',
    loadingText: '取得中...',
    subtitleLang: '字幕言語:',
    tabTimestamps: 'タイムスタンプ付き',
    tabPlain: 'プレーンテキスト',
    copyBtn: '📋 クリップボードにコピー',
    footerText: 'YouTube動画の字幕をテキスト化する無料ツール',
    note1: '※ 本ツールはYouTube専用です',
    note2: '※ YouTubeの自動生成字幕を使用しています',
  },
  en: {
    pageTitle: 'SubGet - YouTube Subtitle Tool',
    subtitle: 'Easily fetch YouTube video subtitles',
    urlLabel: 'Enter YouTube URL',
    fetchBtn: 'Get Subtitles',
    hint: 'Supports: youtube.com/watch, youtu.be, /shorts/',
    loadingText: 'Loading...',
    subtitleLang: 'Subtitle:',
    tabTimestamps: 'With Timestamps',
    tabPlain: 'Plain Text',
    copyBtn: '📋 Copy to Clipboard',
    footerText: 'Free tool to extract YouTube subtitles',
    note1: '* This tool is for YouTube only',
    note2: '* Uses YouTube auto-generated captions',
  },
};

let currentLang = 'ja';
let transcriptData = null;
let videoInfo = null;
let availableLanguages = [];

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
  transcriptText: document.getElementById('transcript-text'),
  summaryText: document.getElementById('summary-text'),
  copyBtn: document.getElementById('copy-btn'),
  subtitleLangRow: document.getElementById('subtitle-lang-row'),
  subtitleLangSelect: document.getElementById('subtitle-lang-select'),
};

function extractVideoId(url) {
  const patterns = [
    /(?:youtube\.com\/watch\?v=|youtu\.be\/|youtube\.com\/shorts\/)([a-zA-Z0-9_-]{11})/,
    /^([a-zA-Z0-9_-]{11})$/,
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

function applyLang(lang) {
  currentLang = lang;
  const t = i18n[lang];
  document.documentElement.lang = lang;
  document.querySelectorAll('[data-i18n]').forEach(el => {
    const key = el.dataset.i18n;
    if (t[key]) el.textContent = t[key];
  });
  document.querySelectorAll('.lang-btn').forEach(btn => {
    btn.classList.toggle('active', btn.dataset.lang === lang);
  });
  localStorage.setItem('subget-lang', lang);
}

function showLoading() {
  elements.loading.classList.remove('hidden');
  elements.error.classList.add('hidden');
  elements.result.classList.add('hidden');
  elements.subtitleLangRow.classList.add('hidden');
}

function showError(message) {
  elements.loading.classList.add('hidden');
  elements.error.textContent = message;
  elements.error.classList.remove('hidden');
  elements.result.classList.add('hidden');
  elements.subtitleLangRow.classList.add('hidden');
}

function showResult() {
  elements.loading.classList.add('hidden');
  elements.error.classList.add('hidden');
  elements.result.classList.remove('hidden');
}

function populateLanguageDropdown(languages) {
  availableLanguages = languages || [];
  const select = elements.subtitleLangSelect;
  select.innerHTML = '';
  languages.forEach(l => {
    const option = document.createElement('option');
    option.value = l.languageCode;
    option.textContent = l.name;
    select.appendChild(option);
  });
  elements.subtitleLangRow.classList.remove('hidden');
}

function displayResult(data) {
  transcriptData = data.transcript;
  availableLanguages = data.availableLanguages || [];

  videoInfo = {
    title: data.title || 'Unknown',
    channel: data.channel || 'Unknown',
  };

  elements.videoTitle.textContent = videoInfo.title;
  elements.videoChannel.textContent = videoInfo.channel;

  const transcriptWithTimestamps = transcriptData
    .map(item => `[${formatTime(item.offset)}] ${item.text}`)
    .join('\n');
  elements.transcriptText.textContent = transcriptWithTimestamps;

  const plainText = transcriptData.map(item => item.text).join(' ');
  elements.summaryText.textContent = plainText;

  populateLanguageDropdown(availableLanguages);
}

async function fetchTranscript(lang) {
  const url = elements.urlInput.value.trim();
  const videoId = extractVideoId(url);
  const subtitleLang = lang || elements.subtitleLangSelect.value;

  if (!videoId) {
    showError(currentLang === 'ja' ? '有効なYouTube URLを入力してください' : 'Enter a valid YouTube URL');
    return;
  }

  showLoading();
  elements.fetchBtn.disabled = true;

  try {
    let apiUrl = `${API_BASE}/api/transcript?id=${videoId}`;
    if (subtitleLang) apiUrl += `&lang=${subtitleLang}`;

    const response = await fetch(apiUrl);
    const data = await response.json();

    if (!response.ok) {
      throw new Error(data.error || 'Failed to fetch subtitles');
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
  md += `- ${currentLang === 'ja' ? 'チャンネル' : 'Channel'}: ${videoInfo.channel}\n\n`;
  md += `## ${currentLang === 'ja' ? '文字起こし' : 'Transcript'}\n\n`;
  md += transcriptData.map(item => `**[${formatTime(item.offset)}]** ${item.text}`).join('\n\n');
  downloadFile(md, 'transcript.md', 'text/markdown');
}

async function copyToClipboard() {
  if (!transcriptData) return;
  const text = transcriptData.map(item => `[${formatTime(item.offset)}] ${item.text}`).join('\n');

  try {
    await navigator.clipboard.writeText(text);
    elements.copyBtn.textContent = currentLang === 'ja' ? '✅ コピーしました' : '✅ Copied!';
    elements.copyBtn.classList.add('copied');
    setTimeout(() => {
      elements.copyBtn.textContent = i18n[currentLang].copyBtn;
      elements.copyBtn.classList.remove('copied');
    }, 2000);
  } catch {
    showError(currentLang === 'ja' ? 'コピーに失敗しました' : 'Copy failed');
  }
}

async function pasteUrl() {
  try {
    const text = await navigator.clipboard.readText();
    elements.urlInput.value = text;
    elements.urlInput.focus();
  } catch {
    showError(currentLang === 'ja' ? '貼り付けに失敗しました' : 'Paste failed');
  }
}

function clearUrl() {
  elements.urlInput.value = '';
  elements.urlInput.focus();
  elements.error.classList.add('hidden');
}

elements.fetchBtn.addEventListener('click', () => fetchTranscript());
elements.pasteBtn.addEventListener('click', pasteUrl);
elements.clearBtn.addEventListener('click', clearUrl);
elements.urlInput.addEventListener('keydown', (e) => {
  if (e.key === 'Enter') fetchTranscript();
});
elements.subtitleLangSelect.addEventListener('change', () => fetchTranscript(elements.subtitleLangSelect.value));

document.querySelectorAll('.lang-btn').forEach(btn => {
  btn.addEventListener('click', () => applyLang(btn.dataset.lang));
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

const savedLang = localStorage.getItem('subget-lang') || 'ja';
applyLang(savedLang);

(async () => {
  try {
    const res = await fetch(`${API_BASE}/api/visit`);
    const data = await res.json();
    document.getElementById('visitor-counter').textContent =
      `👁 ${currentLang === 'ja' ? '訪問者数' : 'Visitors'}: ${data.count.toLocaleString()}`;
  } catch {}
})();
