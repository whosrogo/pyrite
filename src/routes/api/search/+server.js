import { searchMedia } from '$lib/server/tmdb';
import { json } from '@sveltejs/kit';

/** @type {import('./$types').RequestHandler} */
export async function GET({ fetch, url }) {
	const query = url.searchParams.get('q')?.trim() ?? '';
	const mediaType = url.searchParams.get('type') === 'shows' ? 'shows' : 'movies';

	if (query.length < 2) {
		return json({ results: [] });
	}

	const response = await searchMedia(fetch, query, mediaType);
	const results = (response.results ?? []).slice(0, 10).map(
		/** @param {Record<string, any>} item */ (item) => ({
			id: item.id,
			title: item.title ?? item.name ?? 'Untitled',
			releaseDate: item.release_date ?? item.first_air_date ?? '',
			posterPath: item.poster_path,
			voteAverage: Number(item.vote_average) || 0
		})
	);

	return json({ results });
}
