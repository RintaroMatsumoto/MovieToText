interface Env {}

interface TranscriptSegment {
  text: string;
  offset: number;
  duration: number;
}

interface Comment {
  author: string;
  text: string;
  likes: string;
  time: string;
}

interface YouTubeResponse {
  title?: string;
  channel?: string;
  duration?: number;
  description?: string;
  transcript?: TranscriptSegment[];
  comments?: Comment[];
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

  const classicResults = [...xml.matchAll(RE_XML_TRANSCRIPT)];
  return classicResults.map((r) => ({
    text: decodeEntities(r[3]),
    duration: parseFloat(r[2]) * 1000,
    offset: parseFloat(r[1]) * 1000,
  }));
}

async function fetchTranscriptFromTracks(
  captionTracks: any[],
  lang?: string
): Promise<TranscriptSegment[]> {
  const track = lang
    ? captionTracks.find((t: any) => t.languageCode === lang)
    : captionTracks.find((t: any) => t.languageCode === 'ja') || captionTracks[0];

  if (!track) throw new Error('指定された言語の字幕がありません');

  const response = await fetch(track.baseUrl, {
    headers: { 'User-Agent': USER_AGENT },
  });

  if (!response.ok) throw new Error('字幕データの取得に失敗しました');

  const body = await response.text();
  return parseTranscriptXml(body);
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

    return fetchTranscriptFromTracks(captionTracks, lang);
  } catch {
    return null;
  }
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

interface WebPageData {
  captionTracks: any[];
  commentToken: string | null;
}

function extractCommentToken(html: string): string | null {
  const match = html.match(/var ytInitialData = ({.*?});<\/script>/s);
  if (!match) return null;

  try {
    const data = JSON.parse(match[1]);
    const contents = data?.contents?.twoColumnWatchNextResults?.results?.results?.contents;
    if (!contents) return null;

    for (const item of contents) {
      if (item.itemSectionRenderer) {
        const sectionContents = item.itemSectionRenderer.contents || [];
        for (const sc of sectionContents) {
          if (sc.continuationItemRenderer) {
            const token = sc.continuationItemRenderer?.continuationEndpoint?.continuationCommand?.token;
            if (token) return token;
          }
        }
      }
    }
  } catch {}
  return null;
}

async function fetchWebPageData(videoId: string, lang?: string): Promise<WebPageData> {
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
  const captionTracks = playerResponse?.captions?.playerCaptionsTracklistRenderer?.captionTracks || [];
  const commentToken = extractCommentToken(videoPageBody);

  return { captionTracks, commentToken };
}

async function getVideoDetails(videoId: string): Promise<{ title: string; channel: string; description: string }> {
  try {
    const response = await fetch(
      `https://www.youtube.com/oembed?url=https://www.youtube.com/watch?v=${videoId}&format=json`
    );
    if (response.ok) {
      const data = await response.json();
      return {
        title: data.title || '不明',
        channel: data.author_name || '不明',
        description: '',
      };
    }
  } catch {}
  return { title: '不明', channel: '不明', description: '' };
}

async function fetchCommentsPage(token: string): Promise<{ comments: Comment[]; nextToken: string | null }> {
  const resp = await fetch('https://www.youtube.com/youtubei/v1/next?prettyPrint=false', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'User-Agent': USER_AGENT,
    },
    body: JSON.stringify({
      context: {
        client: {
          clientName: 'WEB',
          clientVersion: '2.20250601.00.00',
        },
      },
      continuation: token,
    }),
  });

  if (!resp.ok) return { comments: [], nextToken: null };

  const data = await resp.json();
  const mutations = data?.frameworkUpdates?.entityBatchUpdate?.mutations || [];
  const actions = data?.onResponseReceivedEndpoints || [];

  let nextToken: string | null = null;
  for (const action of actions) {
    const items = action?.reloadContinuationItemsCommand?.continuationItems || [];
    for (const item of items) {
      if (item.continuationItemRenderer) {
        nextToken = item.continuationItemRenderer?.continuationEndpoint?.continuationCommand?.token || null;
      }
    }
  }

  const comments: Comment[] = [];
  for (const entity of mutations) {
    const commentPayload = entity.payload?.commentEntityPayload;
    if (commentPayload) {
      comments.push({
        author: commentPayload.author?.displayName || '',
        text: commentPayload.properties?.content?.content || '',
        likes: commentPayload.toolbar?.likeCountNotliked || '0',
        time: commentPayload.properties?.publishedTime || '',
      });
    }
  }

  return { comments, nextToken };
}

async function fetchAllCommentsFromToken(token: string, maxPages: number = 3): Promise<Comment[]> {
  let allComments: Comment[] = [];
  let currentToken: string | null = token;
  let page = 0;

  while (currentToken && page < maxPages) {
    const result = await fetchCommentsPage(currentToken);
    allComments = allComments.concat(result.comments);
    currentToken = result.nextToken;
    page++;
  }

  allComments.sort((a, b) => {
    const aNum = parseInt(a.likes.replace(/[^0-9]/g, '')) || 0;
    const bNum = parseInt(b.likes.replace(/[^0-9]/g, '')) || 0;
    return bNum - aNum;
  });

  return allComments;
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
      const includeDescription = url.searchParams.get('description') === 'true';
      const includeComments = url.searchParams.get('comments') === 'true';

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
        const videoDetails = await getVideoDetails(videoId);

        let transcript: TranscriptSegment[] | null = null;
        let commentToken: string | null = null;
        let comments: Comment[] | undefined;

        const innerTubeResult = await fetchViaInnerTube(videoId, lang);

        if (innerTubeResult) {
          transcript = innerTubeResult;
          if (includeComments) {
            try {
              const webData = await fetchWebPageData(videoId, lang);
              commentToken = webData.commentToken;
            } catch {
              commentToken = null;
            }
          }
        } else {
          const webData = await fetchWebPageData(videoId, lang);
          if (webData.captionTracks.length > 0) {
            transcript = await fetchTranscriptFromTracks(webData.captionTracks, lang);
          } else {
            throw new Error('この動画には字幕がありません');
          }
          commentToken = webData.commentToken;
        }

        if (includeComments && commentToken) {
          try {
            comments = await fetchAllCommentsFromToken(commentToken);
          } catch {
            comments = [];
          }
        }

        const result: YouTubeResponse = {
          title: videoDetails.title,
          channel: videoDetails.channel,
          description: includeDescription ? videoDetails.description : undefined,
          transcript: transcript || undefined,
          comments,
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
