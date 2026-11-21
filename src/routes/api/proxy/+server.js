import { base } from '$app/paths';
import { fetchPublic, parseForwardHeaders, parsePublicUrl } from '$lib/server/net';

// Playback proxy: lets the browser play scraped streams that need a specific Referer /
// headers or lack CORS. Rewrites HLS playlists so every segment, key and sub-playlist
// also goes through here, and serves mp4 ranges in bounded chunks.

const UA =
	'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36';

const PASS_HEADERS = ['content-type', 'content-length', 'content-range', 'accept-ranges'];
const MAX_CHUNK = 8 * 1024 * 1024;

const parseHeaders = parseForwardHeaders;
const parseTarget = parsePublicUrl;

/** @type {import('./$types').RequestHandler} */
export async function GET({ url, request }) {
	const target = parseTarget(url.searchParams.get('url'));
	if (!target) return new Response('valid url required', { status: 400 });

	const rawHeaders = url.searchParams.get('headers');
	/** @type {Record<string, string>} */
	const headers = { 'User-Agent': UA, Referer: `${target.origin}/`, ...parseHeaders(rawHeaders) };

	// never pull a whole multi-GB mp4 through in one go: cap each range request
	const requestedRange = request.headers.get('range');
	const range = requestedRange?.match(/^bytes=(\d+)-(\d*)$/);
	if (range) {
		const start = Number(range[1]);
		const end = range[2]
			? Math.min(Number(range[2]), start + MAX_CHUNK - 1)
			: start + MAX_CHUNK - 1;
		headers.Range = `bytes=${start}-${end}`;
	} else if (requestedRange) {
		headers.Range = requestedRange;
	}

	let upstream;
	try {
		upstream = await fetchPublic(target, { headers, signal: request.signal });
	} catch (error) {
		return new Response(error instanceof Error ? error.message : 'upstream failed', {
			status: 502
		});
	}
	if (!upstream.ok) {
		upstream.body?.cancel();
		return new Response(null, { status: upstream.status });
	}

	const contentType = upstream.headers.get('content-type') ?? '';
	const reader = upstream.body?.getReader();
	const first = reader ? await reader.read() : { done: true, value: undefined };

	// many hosts serve playlists without .m3u8 or an mpegurl type, so sniff the first bytes
	const head = first.value ? new TextDecoder().decode(first.value.subarray(0, 16)) : '';
	const isPlaylist = contentType.includes('mpegurl') || head.trimStart().startsWith('#EXTM3U');

	if (isPlaylist) {
		/** @type {Uint8Array[]} */
		const chunks = first.value ? [first.value] : [];
		if (reader && !first.done) {
			for (let chunk = await reader.read(); !chunk.done; chunk = await reader.read()) {
				chunks.push(chunk.value);
			}
		}
		const text = new TextDecoder().decode(Buffer.concat(chunks));
		const hostToken = target.searchParams.get('token');
		const headerQuery = rawHeaders ? `&headers=${encodeURIComponent(rawHeaders)}` : '';

		/** @param {string} ref */
		const wrap = (ref) => {
			let absolute = new URL(ref, upstream.url || target).href;
			if (hostToken && !absolute.includes('token=')) {
				absolute += `${absolute.includes('?') ? '&' : '?'}token=${hostToken}`;
			}
			return `${base}/api/proxy?url=${encodeURIComponent(absolute)}${headerQuery}`;
		};

		const rewritten = text
			.replace(/^(?!#)(\S+)$/gm, (line) => wrap(line))
			.replace(/URI="([^"]+)"/g, (_match, ref) => `URI="${wrap(ref)}"`);

		return new Response(rewritten, {
			headers: {
				'content-type': 'application/vnd.apple.mpegurl',
				'cache-control': 'no-store'
			}
		});
	}

	const responseHeaders = new Headers();
	for (const name of PASS_HEADERS) {
		const value = upstream.headers.get(name);
		if (value) responseHeaders.set(name, value);
	}
	if (!contentType) responseHeaders.set('content-type', 'application/octet-stream');

	if (first.done || !reader)
		return new Response(null, { status: upstream.status, headers: responseHeaders });

	const body = new ReadableStream({
		start(controller) {
			controller.enqueue(first.value);
		},
		async pull(controller) {
			try {
				const chunk = await reader.read();
				if (chunk.done) controller.close();
				else controller.enqueue(chunk.value);
			} catch (error) {
				controller.error(error);
			}
		},
		cancel: () => reader.cancel()
	});

	return new Response(body, { status: upstream.status, headers: responseHeaders });
}
