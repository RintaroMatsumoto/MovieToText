const fs = require('fs');

const TEMP = process.env.TEMP;

const transcript = fs.readFileSync(TEMP + '\\transcript_clean.txt', 'utf8');
const comments = fs.readFileSync(TEMP + '\\comments_formatted.txt', 'utf8');
const infoJson = JSON.parse(fs.readFileSync(TEMP + '\\yt_info.json', 'utf8'));

const dur = infoJson.duration || 0;
const hours = Math.floor(dur / 3600);
const minutes = Math.floor((dur % 3600) / 60);
const seconds = dur % 60;
const durStr = hours > 0
  ? hours + ':' + String(minutes).padStart(2, '0') + ':' + String(seconds).padStart(2, '0')
  : minutes + ':' + String(seconds).padStart(2, '0');

const uploadDate = infoJson.upload_date || '';
const dateStr = uploadDate ? uploadDate.substring(0, 4) + '-' + uploadDate.substring(4, 6) + '-' + uploadDate.substring(6, 8) : '不明';

let md = '';

md += '# ' + infoJson.title + '\n\n';

md += '## 動画情報\n\n';
md += '- **チャンネル**: ' + (infoJson.channel || infoJson.uploader) + '\n';
md += '- **アップロード日**: ' + dateStr + '\n';
md += '- **再生時間**: ' + durStr + '\n';
md += '- **再生回数**: ' + (infoJson.view_count || 0).toLocaleString() + ' 回\n';
md += '- **高評価数**: ' + (infoJson.like_count || 0).toLocaleString() + ' 件\n';
md += '- **URL**: https://www.youtube.com/watch?v=' + infoJson.id + '\n\n';

md += '## 概要欄（説明欄）\n\n';
md += '```\n';
md += (infoJson.description || '').trim();
md += '\n```\n\n';

md += '## チャプター\n\n';
const descText = infoJson.description || '';
const chapterMatch = descText.match(/★チャプター\n([\s\S]+?)$/);
if (chapterMatch) {
  const chapters = chapterMatch[1].split('\n').filter(l => l.trim() && /^\d{2}:\d{2}/.test(l.trim()));
  chapters.forEach(ch => {
    const cm = ch.trim().match(/^(\d{2}:\d{2})\s+(.+)$/);
    if (cm) {
      md += '- `' + cm[1] + '` ' + cm[2] + '\n';
    }
  });
  md += '\n';
}

const tags = infoJson.tags || [];
if (tags.length > 0) {
  md += '## タグ\n\n';
  tags.forEach(t => md += '#' + t + ' ');
  md += '\n\n';
}

md += '## 文字起こし（自動生成字幕）\n\n';
md += '> この文字起こしはYouTubeの自動生成字幕（日本語）をベースにしています。発音が似通っているため誤字が含まれている可能性があります。\n\n';
md += '```\n';
md += transcript;
md += '```\n\n';

md += '## コメント\n\n';
md += '> YouTubeコメント（上位順・返信込み）\n\n';
md += '```\n';
md += comments;
md += '```\n\n';

md += '---\n\n';
md += '**文字起こし日時**: ' + new Date().toISOString() + '\n';
md += '**文字起こしツール**: yt-dlp + Node.js (自動処理)\n';
md += '**動画ID**: ' + infoJson.id + '\n';

const safeTitle = (infoJson.title || 'youtube_transcript').replace(/[\\/:*?"<>|]/g, '_');
const outputPath = 'C:\\Users\\GoldRush\\Desktop\\' + safeTitle + '.md';
fs.writeFileSync(outputPath, md, 'utf8');
console.log('Saved markdown to:', outputPath);
console.log('File size:', fs.statSync(outputPath).size, 'bytes');
