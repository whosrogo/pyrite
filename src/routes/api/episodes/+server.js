import { getMediaDetails, getSeason } from '$lib/server/tmdb';
import { json } from '@sveltejs/kit';

/** @type {import('./$types').RequestHandler} */
export async function GET({ fetch, url }) {
	const id = url.searchParams.get('id')?.trim() ?? '';

	if (!id) {
		return json({ season: 1, seasons: [], episodes: [] });
	}

	const details = await getMediaDetails(fetch, id, 'shows');
	const seasons = (details.seasons ?? [])
		.filter(/** @param {Record<string, any>} item */ (item) => item.episode_count > 0)
		.map(
			/** @param {Record<string, any>} item */ (item) => ({
				number: item.season_number,
				name: item.name ?? `Season ${item.season_number}`,
				episodeCount: item.episode_count
			})
		);

	const requested = Number(url.searchParams.get('season'));
	const fallback = seasons.find(/** @param {{ number: number }} item */ (item) => item.number > 0);
	const season = seasons.some(
		/** @param {{ number: number }} item */ (item) => item.number === requested
	)
		? requested
		: (fallback?.number ?? seasons[0]?.number ?? 1);

	const detail = await getSeason(fetch, id, season);
	const episodes = (detail.episodes ?? []).map(
		/** @param {Record<string, any>} item */ (item) => ({
			number: item.episode_number,
			name: item.name ?? `Episode ${item.episode_number}`,
			airDate: item.air_date ?? ''
		})
	);

	return json({ season, seasons, episodes });
}
