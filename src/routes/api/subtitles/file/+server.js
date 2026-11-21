import { parseForwardHeaders, parsePublicUrl } from '$lib/server/net';
import { subtitleFile } from '$lib/server/subtitles';

/**
 * Serves any subtitle (SRT or VTT, any host) as clean same-origin WebVTT, so a
 * <track> element can load it. Converted files are cached on the server.
 *
 * @type {import('./$types').RequestHandler}
 */
export async function GET({ url }) {
	const target = parsePublicUrl(url.searchParams.get('url'));
	if (!target) return new Response('valid url required', { status: 400 });

	const headers = parseForwardHeaders(url.searchParams.get('headers'));
	const language = (url.searchParams.get('lang') ?? '').slice(0, 8).toLowerCase();

	try {
		const vtt = await subtitleFile(target, headers, language);
		return new Response(vtt, {
			headers: {
				'content-type': 'text/vtt; charset=utf-8',
				'cache-control': 'public, max-age=21600'
			}
		});
	} catch (error) {
		return new Response(error instanceof Error ? error.message : 'subtitle fetch failed', {
			status: 502
		});
	}
}
