import { titleSubtitles } from '$lib/server/subtitles';
import { getMediaDetails } from '$lib/server/tmdb';
import { json } from '@sveltejs/kit';

/**
 * Title-wide subtitles (not tied to one stream) plus the title's original language,
 * which the player uses to turn subtitles on by default for non-English titles.
 *
 * @type {import('./$types').RequestHandler}
 */
export async function GET({ url, fetch, setHeaders }) {
	const id = url.searchParams.get('id')?.trim() ?? '';
	const isShow = url.searchParams.get('type') === 'shows';
	if (!/^\d+$/.test(id)) return json({ error: 'numeric TMDB id required' }, { status: 400 });

	const season = Number(url.searchParams.get('season')) || 1;
	const episode = Number(url.searchParams.get('episode')) || 1;

	const [subtitles, originalLanguage] = await Promise.all([
		isShow ? titleSubtitles('tv', id, season, episode) : titleSubtitles('movie', id),
		getMediaDetails(fetch, id, isShow ? 'shows' : 'movies')
			.then((details) => String(details.original_language ?? ''))
			.catch(() => '')
	]);

	setHeaders({ 'cache-control': 'private, max-age=600' });
	return json({ originalLanguage, subtitles });
}
