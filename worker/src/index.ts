interface Env {
  // 環境変数がある場合はここに定義
}

interface TranscriptSegment {
  text: string;
  offset: number;
  duration: number;
}

interface YouTubeResponse {
  title?: string;
  channel?: string;
  duration?: number;
  transcript?: TranscriptSegment[];
  error?: string;
}

// YouTube URLから動画IDを抽出
function extractVideoId(url: string): string | null {
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

// InnerTube APIから字幕情報を取得
async function getCaptionsInfo(videoId: string): Promise<any> {
  const url = 'https://www.youtube.com/youtubei/v1/player?prettyPrint=false';

  const body = {
    context: {
      client: {
        clientName: 'WEB',
        clientVersion: '2.20240101.00.00',
      },
    },
    videoId: videoId,
  };

  const response = await fetch(url, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
    },
    body: JSON.stringify(body),
  });

  if (!response.ok) {
    throw new Error(`YouTube API error: ${response.status}`);
  }

  return response.json();
}

// 字幕データを取得
async function fetchTranscript(captionsUrl: string): Promise<TranscriptSegment[]> {
  const response = await fetch(captionsUrl, {
    headers: {
      'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
    },
  });

  if (!response.ok) {
    throw new Error(`Failed to fetch captions: ${response.status}`);
  }

  const text = await response.text();
  return parseVTT(text);
}

// VTT形式を解析
function parseVTT(vtt: string): TranscriptSegment[] {
  const lines = vtt.split('\n');
  const segments: TranscriptSegment[] = [];

  let i = 0;
  while (i < lines.length) {
    const line = lines[i].trim();
    const match = line.match(/^(\d{2}:\d{2}:\d{2}\.\d{3})\s+-->\s+(\d{2}:\d{2}:\d{2}\.\d{3})/);

    if (match) {
      const start = parseTimestamp(match[1]);
      const end = parseTimestamp(match[2]);
      i++;

      const textLines: string[] = [];
      while (i < lines.length && lines[i].trim() !== '') {
        let text = lines[i].trim();
        text = text.replace(/<[^>]+>/g, '');
        if (text) textLines.push(text);
        i++;
      }

      const text = textLines.join(' ');
      if (text) {
        segments.push({
          text,
          offset: start,
          duration: end - start,
        });
      }
    } else {
      i++;
    }
  }

  return segments;
}

// タイムスタンプを秒に変換
function parseTimestamp(ts: string): number {
  const match = ts.match(/^(\d{2}):(\d{2}):(\d{2})\.(\d{3})$/);
  if (!match) return 0;

  const hours = parseInt(match[1], 10);
  const minutes = parseInt(match[2], 10);
  const seconds = parseInt(match[3], 10);
  const ms = parseInt(match[4], 10);

  return hours * 3600 + minutes * 60 + seconds + ms / 1000;
}

// 動画の詳細情報を取得
async function getVideoDetails(videoId: string): Promise<{ title: string; channel: string; duration: number }> {
  const url = `https://www.youtube.com/oembed?url=https://www.youtube.com/watch?v=${videoId}&format=json`;

  try {
    const response = await fetch(url);
    if (response.ok) {
      const data = await response.json();
      return {
        title: data.title || '不明',
        channel: data.author_name || '不明',
        duration: 0,
      };
    }
  } catch {
    // oEmbedが失敗しても字幕取得は続行
  }

  return { title: '不明', channel: '不明', duration: 0 };
}

// CORSヘッダー
function getCORSHeaders(): Record<string, string> {
  return {
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Methods': 'GET, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type',
  };
}

// メインハンドラー
export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    // OPTIONSリクエスト対応
    if (request.method === 'OPTIONS') {
      return new Response(null, { headers: getCORSHeaders() });
    }

    const url = new URL(request.url);

    // APIルート
    if (url.pathname === '/api/transcript') {
      const videoIdParam = url.searchParams.get('id');

      if (!videoIdParam) {
        return Response.json(
          { error: 'idパラメータが必要です' },
          { status: 400, headers: getCORSHeaders() }
        );
      }

      const videoId = extractVideoId(videoIdParam);
      if (!videoId) {
        return Response.json(
          { error: '有効なYouTube URLまたは動画IDを入力してください' },
          { status: 400, headers: getCORSHeaders() }
        );
      }

      try {
        // 動画情報を取得
        const [videoDetails, captionsInfo] = await Promise.all([
          getVideoDetails(videoId),
          getCaptionsInfo(videoId),
        ]);

        // 字幕トラックを検索
        const captionTracks =
          captionsInfo?.captions?.playerCaptionsTracklistRenderer?.captionTracks;

        if (!captionTracks || captionTracks.length === 0) {
          return Response.json(
            { error: 'この動画には字幕がありません' },
            { status: 404, headers: getCORSHeaders() }
          );
        }

        // 日本語字幕を優先、なければ最初の字幕を使用
        let selectedTrack =
          captionTracks.find((t: any) => t.languageCode === 'ja') ||
          captionTracks[0];

        let captionsUrl = selectedTrack.baseUrl;

        // VTT形式を要求
        if (!captionsUrl.includes('fmt=')) {
          captionsUrl += '&fmt=vtt';
        }

        // 字幕を取得
        const transcript = await fetchTranscript(captionsUrl);

        // 動画の長さを取得（InnerTube APIから）
        const duration =
          captionsInfo?.videoDetails?.lengthSeconds
            ? parseInt(captionsInfo.videoDetails.lengthSeconds, 10)
            : videoDetails.duration;

        const result: YouTubeResponse = {
          title: captionsInfo?.videoDetails?.title || videoDetails.title,
          channel:
            captionsInfo?.videoDetails?.author || videoDetails.channel,
          duration,
          transcript,
        };

        return Response.json(result, { headers: getCORSHeaders() });
      } catch (err: any) {
        console.error('Transcript fetch error:', err);
        return Response.json(
          { error: err.message || '文字起こしの取得に失敗しました' },
          { status: 500, headers: getCORSHeaders() }
        );
      }
    }

    // 404
    return Response.json(
      { error: 'Not Found' },
      { status: 404, headers: getCORSHeaders() }
    );
  },
};
