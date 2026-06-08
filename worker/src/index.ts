interface Env {}

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

const RE_YOUTUBE = /(?:youtube\.com\/(?:[^\/]+\/.+\/|(?:v|e(?:mbed)?)\/|.*[?&]v=)|youtu\.be\/)([^"&?\/\s]{11})/i;
const USER_AGENT = 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/125.0.0.0 Safari/537.36,gzip(gfe)';
const RE_XML_TRANSCRIPT = /<text start="([^"]*)" dur="([^"]*)">([^<]*)<\/text>/g;

const INNERTUBE_API_URL = 'https://www.youtube.com/youtubei/v1/player?prettyPrint=false';
const INNERTUBE_CLIENT_VERSION = '20.10.38';
const INNERTUBE_CONTEXT = {
  client: {
    clientName: 'ANDROID',
    clientVersion: INNERTUBE_CLIENT_VERSION,
  },
};
const INNERTUBE_USER_AGENT = `com.google.android.youtube/${INNERTUBE_CLIENT_VERSION} (Linux; U; Android 14)`;

function extractVideoId(url: string): string | null {
  if (url.length === 11 && /^[a-zA-Z0-9_-]{11}$/.test(url)) {
    return url;
  }
  const match = url.match(RE_YOUTUBE);
  return match ? match[1] : null;
}

function decodeEntities(text: string): string {
  return text
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&apos;/g, "'")
    .replace(/&#x([0-9a-fA-F]+);/g, (_, hex) => String.fromCodePoint(parseInt(hex, 16)))
    .replace(/&#(\d+);/g, (_, dec) => String.fromCodePoint(parseInt(dec, 10)));
}

function parseTranscriptXml(xml: string, lang: string): TranscriptSegment[] {
  const results: TranscriptSegment[] = [];

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

  const classicResults = [...xml.matchAll(RE_XML_TRANSCRIPT)];
  return classicResults.map((r) => ({
    text: decodeEntities(r[3]),
    duration: parseFloat(r[2]) * 1000,
    offset: parseFloat(r[1]) * 1000,
  }));
}

async function fetchTranscriptFromTracks(
  captionTracks: any[],
  videoId: string,
  lang?: string
): Promise<TranscriptSegment[]> {
  const track = lang
    ? captionTracks.find((t: any) => t.languageCode === lang)
    : captionTracks.find((t: any) => t.languageCode === 'ja') || captionTracks[0];

  if (!track) throw new Error('指定された言語の字幕がありません');

  const transcriptURL = track.baseUrl;

  const response = await fetch(transcriptURL, {
    headers: { 'User-Agent': USER_AGENT },
  });

  if (!response.ok) throw new Error('字幕データの取得に失敗しました');

  const body = await response.text();
  const resultLang = lang ?? track.languageCode;
  return parseTranscriptXml(body, resultLang);
}

async function fetchViaInnerTube(videoId: string, lang?: string): Promise<TranscriptSegment[] | null> {
  try {
    const resp = await fetch(INNERTUBE_API_URL, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'User-Agent': INNERTUBE_USER_AGENT,
      },
      body: JSON.stringify({
        context: INNERTUBE_CONTEXT,
        videoId,
      }),
    });
    if (!resp.ok) return null;

    const data = await resp.json();
    const captionTracks = data?.captions?.playerCaptionsTracklistRenderer?.captionTracks;
    if (!Array.isArray(captionTracks) || captionTracks.length === 0) return null;

    return fetchTranscriptFromTracks(captionTracks, videoId, lang);
  } catch {
    return null;
  }
}

async function fetchViaWebPage(videoId: string, lang?: string): Promise<TranscriptSegment[]> {
  const videoPageResponse = await fetch(`https://www.youtube.com/watch?v=${videoId}`, {
    headers: {
      ...(lang && { 'Accept-Language': lang }),
      'User-Agent': USER_AGENT,
    },
  });

  const videoPageBody = await videoPageResponse.text();

  if (videoPageBody.includes('class="g-recaptcha"')) {
    throw new Error('YouTubeからのリクエストがブロックされました。しばらく待ってから再試行してください。');
  }
  if (!videoPageBody.includes('"playabilityStatus":')) {
    throw new Error('この動画は利用できません');
  }

  const playerResponse = parseInlineJson(videoPageBody, 'ytInitialPlayerResponse');
  const captionTracks = playerResponse?.captions?.playerCaptionsTracklistRenderer?.captionTracks;

  if (!Array.isArray(captionTracks) || captionTracks.length === 0) {
    throw new Error('この動画には字幕がありません');
  }

  return fetchTranscriptFromTracks(captionTracks, videoId, lang);
}

function parseInlineJson(html: string, globalName: string): any {
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

async function getVideoDetails(videoId: string): Promise<{ title: string; channel: string }> {
  try {
    const response = await fetch(
      `https://www.youtube.com/oembed?url=https://www.youtube.com/watch?v=${videoId}&format=json`
    );
    if (response.ok) {
      const data = await response.json();
      return { title: data.title || '不明', channel: data.author_name || '不明' };
    }
  } catch {}
  return { title: '不明', channel: '不明' };
}

function getCORSHeaders(): Record<string, string> {
  return {
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Methods': 'GET, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type',
  };
}

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    if (request.method === 'OPTIONS') {
      return new Response(null, { headers: getCORSHeaders() });
    }

    const url = new URL(request.url);

    if (url.pathname === '/api/transcript') {
      const videoIdParam = url.searchParams.get('id');
      const lang = url.searchParams.get('lang') || undefined;

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
        const [videoDetails, transcript] = await Promise.all([
          getVideoDetails(videoId),
          (async () => {
            const innerTubeResult = await fetchViaInnerTube(videoId, lang);
            if (innerTubeResult) return innerTubeResult;
            return fetchViaWebPage(videoId, lang);
          })(),
        ]);

        const result: YouTubeResponse = {
          title: videoDetails.title,
          channel: videoDetails.channel,
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

    return Response.json({ error: 'Not Found' }, { status: 404, headers: getCORSHeaders() });
  },
};
