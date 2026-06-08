const fs = require('fs');

const raw = fs.readFileSync(process.env.TEMP + '\\yt_comments.info.json', 'utf8');
const data = JSON.parse(raw);

const rootComments = [];
const replies = [];
let totalComments = 0;

if (data.comments && Array.isArray(data.comments)) {
  data.comments.forEach(c => {
    totalComments++;
    if (c.parent === 'root' || !c.parent) {
      rootComments.push(c);
    } else {
      replies.push(c);
    }
  });
}

console.log('Total comments:', totalComments);
console.log('Root comments:', rootComments.length);
console.log('Replies:', replies.length);

// Build a map of replies by parent id
const repliesByParent = {};
replies.forEach(r => {
  if (!repliesByParent[r.parent]) repliesByParent[r.parent] = [];
  repliesByParent[r.parent].push(r);
});

// Sort root comments by like_count desc
rootComments.sort((a, b) => (b.like_count || 0) - (a.like_count || 0));

let out = '';
rootComments.forEach(c => {
  out += `\n--- [${c._time_text || ''}] ${c.author} (👍 ${c.like_count || 0}) ---\n`;
  out += c.text + '\n';
  if (repliesByParent[c.id]) {
    repliesByParent[c.id].forEach(r => {
      out += `  ↳ [${r._time_text || ''}] ${r.author} (👍 ${r.like_count || 0}): ${r.text}\n`;
    });
  }
});

fs.writeFileSync(process.env.TEMP + '\\comments_formatted.txt', out, 'utf8');
console.log('Saved to comments_formatted.txt');
console.log('File size:', fs.statSync(process.env.TEMP + '\\comments_formatted.txt').size, 'bytes');
