const API_BASE = window.location.hostname === 'localhost'
  ? 'http://127.0.0.1:8787'
  : 'https://movie-to-text-api.matsumotoinla.workers.dev';

const i18n = {
  ja: {
    subtitle: 'YouTube動画の字幕を簡単に取得',
    urlLabel: 'YouTube URLを入力してください',
    fetchBtn: '字幕を取得',
    hint: '対応形式: youtube.com/watch, youtu.be, /shorts/',
    loadingText: '取得中...',
    subtitleLang: '字幕言語:',
    tabTimestamps: 'タイムスタンプ付き',
    tabPlain: 'プレーンテキスト',
    copyBtn: '📋 クリップボードにコピー',
    copied: '✅ コピーしました',
    footerText: 'YouTube動画の字幕をテキスト化する無料ツール',
    note1: '※ 本ツールはYouTube専用です',
    note2: '※ YouTubeの自動生成字幕を使用しています',
    invalidUrl: '有効なYouTube URLを入力してください',
    fetchError: '字幕の取得に失敗しました',
    copyError: 'クリップボードへのコピーに失敗しました',
    pasteError: 'クリップボードの読み取りに失敗しました',
    visitors: '訪問者数',
  },
  en: {
    subtitle: 'Easily fetch YouTube video subtitles',
    urlLabel: 'Enter YouTube URL',
    fetchBtn: 'Get Subtitles',
    hint: 'Supports: youtube.com/watch, youtu.be, /shorts/',
    loadingText: 'Loading...',
    subtitleLang: 'Subtitle:',
    tabTimestamps: 'With Timestamps',
    tabPlain: 'Plain Text',
    copyBtn: '📋 Copy to Clipboard',
    copied: '✅ Copied!',
    footerText: 'Free tool to extract YouTube subtitles',
    note1: '* This tool is for YouTube only',
    note2: '* Uses YouTube auto-generated captions',
    invalidUrl: 'Enter a valid YouTube URL',
    fetchError: 'Failed to fetch subtitles',
    copyError: 'Failed to copy to clipboard',
    pasteError: 'Failed to read clipboard',
    visitors: 'Visitors',
  },
};

let currentLang = 'ja';
let transcriptData = null;
let videoInfo = null;
let visitorCount = null;
let dropdownBuilt = false;

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

function t(key) {
  return i18n[currentLang][key] || key;
}

function applyLang(lang) {
  currentLang = lang;
  document.documentElement.lang = lang;
  document.querySelectorAll('[data-i18n]').forEach(el => {
    const key = el.dataset.i18n;
    if (i18n[lang][key]) el.textContent = i18n[lang][key];
  });
  document.querySelectorAll('.lang-btn').forEach(btn => {
    btn.classList.toggle('active', btn.dataset.lang === lang);
  });
  localStorage.setItem('subget-lang', lang);
  updateCounterDisplay();
}

function updateCounterDisplay() {
  const el = document.getElementById('visitor-counter');
  if (visitorCount !== null) {
    el.textContent = `👁 ${t('visitors')}: ${visitorCount.toLocaleString()}`;
  }
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

function populateLanguageDropdown(languages, selectedLang) {
  const select = elements.subtitleLangSelect;
  select.innerHTML = '';
  languages.forEach(l => {
    const option = document.createElement('option');
    option.value = l.languageCode;
    option.textContent = l.name;
    select.appendChild(option);
  });
  if (selectedLang) select.value = selectedLang;
  elements.subtitleLangRow.classList.remove('hidden');
}

function displayResult(data) {
  transcriptData = data.transcript;
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

  const plainText = transcriptData.map(item => item.text).join('\n');
  elements.summaryText.textContent = plainText;

  if (data.availableLanguages) {
    if (!dropdownBuilt) {
      populateLanguageDropdown(data.availableLanguages, data.selectedLang);
      dropdownBuilt = true;
    } else {
      if (data.selectedLang) elements.subtitleLangSelect.value = data.selectedLang;
      elements.subtitleLangRow.classList.remove('hidden');
    }
  }
}

async function fetchTranscript(lang) {
  const url = elements.urlInput.value.trim();
  const videoId = extractVideoId(url);

  if (!videoId) {
    showError(t('invalidUrl'));
    return;
  }

  showLoading();
  elements.fetchBtn.disabled = true;
  elements.subtitleLangRow.classList.add('hidden');
  if (!lang) dropdownBuilt = false;

  try {
    let apiUrl = `${API_BASE}/api/transcript?id=${videoId}`;
    const langParam = lang || currentLang;
    if (langParam) apiUrl += `&lang=${langParam}`;

    const response = await fetch(apiUrl);
    const data = await response.json();

    if (!response.ok) {
      throw new Error(data.error || t('fetchError'));
    }

    displayResult(data);
    showResult();
  } catch (err) {
    showError(err.message);
  } finally {
    elements.fetchBtn.disabled = false;
  }
}

function getActiveContent(withTimestamps) {
  const isPlain = document.querySelector('.tab.active')?.dataset.tab === 'summary';
  if (isPlain) {
    return transcriptData.map(item => item.text).join(' ');
  }
  return transcriptData.map(item => `[${formatTime(item.offset)}] ${item.text}`).join('\n');
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
  downloadFile(getActiveContent(), 'transcript.txt', 'text/plain');
}

function exportMD() {
  if (!transcriptData || !videoInfo) return;
  let md = `# ${videoInfo.title}\n\n`;
  md += `- ${currentLang === 'ja' ? 'チャンネル' : 'Channel'}: ${videoInfo.channel}\n\n`;
  md += `## ${currentLang === 'ja' ? '文字起こし' : 'Transcript'}\n\n`;
  md += getActiveContent();
  downloadFile(md, 'transcript.md', 'text/markdown');
}

async function copyToClipboard() {
  if (!transcriptData) return;
  const text = getActiveContent();

  try {
    await navigator.clipboard.writeText(text);
    elements.copyBtn.textContent = t('copied');
    elements.copyBtn.classList.add('copied');
    setTimeout(() => {
      elements.copyBtn.textContent = t('copyBtn');
      elements.copyBtn.classList.remove('copied');
    }, 2000);
  } catch {
    showError(t('copyError'));
  }
}

async function pasteUrl() {
  try {
    const text = await navigator.clipboard.readText();
    elements.urlInput.value = text;
    elements.urlInput.focus();
  } catch {
    showError(t('pasteError'));
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
  btn.addEventListener('click', () => {
    applyLang(btn.dataset.lang);
    document.title = currentLang === 'ja' ? 'MovieToText - YouTube字幕取得ツール' : 'MovieToText - YouTube Subtitle Tool';
  });
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
    else if (format === 'md') exportMD();
  });
});

elements.copyBtn.addEventListener('click', copyToClipboard);

const savedLang = localStorage.getItem('subget-lang') || 'ja';
applyLang(savedLang);
document.title = savedLang === 'ja' ? 'MovieToText - YouTube字幕取得ツール' : 'MovieToText - YouTube Subtitle Tool';

(async () => {
  try {
    const res = await fetch(`${API_BASE}/api/visit`);
    const data = await res.json();
    visitorCount = data.count;
    updateCounterDisplay();
  } catch {}
})();
