interface Env {
  VISITOR_COUNTER: KVNamespace;
}

interface TranscriptSegment {
  text: string;
  offset: number;
  duration: number;
}

interface LanguageInfo {
  languageCode: string;
  name: string;
}

const RE_YOUTUBE = /(?:youtube\.com\/(?:[^\/]+\/.+\/|(?:v|e(?:mbed)?)\/|.*[?&]v=)|youtu\.be\/)([^"&?\/\s]{11})/i;
const USER_AGENT = 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_4) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/85.0.4183.83 Safari/537.36,gzip(gfe)';
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

function parseTranscriptXml(xml: string): TranscriptSegment[] {
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

  const classicResults = [...xml.matchAll(/<text start="([^"]*)" dur="([^"]*)">([^<]*)<\/text>/g)];
  return classicResults.map((r) => ({
    text: decodeEntities(r[3]),
    duration: parseFloat(r[2]) * 1000,
    offset: parseFloat(r[1]) * 1000,
  }));
}

const LANGUAGE_NAMES: Record<string, string> = {
  ja: '日本語',
  en: 'English',
  'de-DE': 'Deutsch',
  'pt-BR': 'Português (Brasil)',
  'es-419': 'Español (Latinoamérica)',
  fr: 'Français',
  ko: '한국어',
  'zh-Hans': '中文（简体）',
  'zh-Hant': '中文（繁體）',
  it: 'Italiano',
  ru: 'Русский',
};

function getAvailableLanguages(captionTracks: any[]): LanguageInfo[] {
  const seen = new Set<string>();
  const result: LanguageInfo[] = [];
  for (const t of captionTracks) {
    if (seen.has(t.languageCode)) continue;
    seen.add(t.languageCode);
    result.push({
      languageCode: t.languageCode,
      name: LANGUAGE_NAMES[t.languageCode]
        || (typeof t.name === 'string' ? t.name : t.name?.simpleText)
        || t.languageCode,
    });
  }
  return result;
}

async function fetchTranscriptFromTracks(captionTracks: any[], lang?: string): Promise<{ segments: TranscriptSegment[]; selectedLang: string }> {
  const track = lang
    ? captionTracks.find((t: any) => t.languageCode === lang) || captionTracks[0]
    : captionTracks[0];

  const response = await fetch(track.baseUrl, {
    headers: { 'User-Agent': USER_AGENT },
  });

  if (!response.ok) throw new Error('字幕データの取得に失敗しました');

  return { segments: parseTranscriptXml(await response.text()), selectedLang: track.languageCode };
}

async function fetchViaInnerTube(videoId: string, lang?: string): Promise<{
  transcript: TranscriptSegment[];
  title: string;
  channel: string;
  availableLanguages: LanguageInfo[];
  selectedLang: string;
} | null> {
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

    const { segments, selectedLang } = await fetchTranscriptFromTracks(captionTracks, lang);
    const details = data?.videoDetails || {};
    const availableLanguages = getAvailableLanguages(captionTracks);
    return {
      transcript: segments,
      title: details.title || '不明',
      channel: details.author || '不明',
      availableLanguages,
      selectedLang,
    };
  } catch {
    return null;
  }
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

      const innerTube = await fetchViaInnerTube(videoId, lang);
      if (!innerTube) {
        return Response.json(
          { error: '字幕は取得できませんでした' },
          { status: 404, headers: getCORSHeaders() }
        );
      }
      return Response.json(innerTube, { headers: getCORSHeaders() });
    }

    if (url.pathname === '/api/visit') {
      const count = await env.VISITOR_COUNTER.get('visits');
      const newCount = (parseInt(count || '0', 10) || 0) + 1;
      await env.VISITOR_COUNTER.put('visits', String(newCount));
      return Response.json({ count: newCount }, { headers: getCORSHeaders() });
    }

    return Response.json({ error: 'Not Found' }, { status: 404, headers: getCORSHeaders() });
  },
};
