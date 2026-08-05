import { isBlocked } from '$lib/server/blocklist';
import {
	getDiscoverMovie,
	getDiscoverShow,
	getPopularMovie,
	getPopularShow,
	getTopRatedMovie,
	getTopRatedShow
} from '$lib/server/tmdb';

/** @type {import('./$types').PageServerLoad} */
export async function load({ fetch, url, cookies }) {
	const requested = url.searchParams.get('type') ?? cookies.get('mediaType');
	const mediaType = requested === 'shows' ? 'shows' : 'movies';
	const pageCount = 15;
	const getPopular = mediaType === 'shows' ? getPopularShow : getPopularMovie;
	const getTopRated = mediaType === 'shows' ? getTopRatedShow : getTopRatedMovie;
	const getDiscover = mediaType === 'shows' ? getDiscoverShow : getDiscoverMovie;
	const blockedKeywordIds = '325693|198385';

	const [popularResponse, topRatedResponse, ...discoverPages] = await Promise.all([
		getPopular(fetch, blockedKeywordIds),
		getTopRated(fetch, blockedKeywordIds),
		...Array.from({ length: pageCount }, (_, index) =>
			getDiscover(fetch, index + 1, blockedKeywordIds)
		)
	]);

	/** @param {Array<Record<string, any>>} results */
	const normalize = (results) =>
		results
			.filter((item) => item.poster_path && item.adult !== true)
			.map((item) => ({
				...item,
				id: item.id,
				title: item.title ?? item.name ?? 'Untitled',
				release_date: item.release_date ?? item.first_air_date ?? '',
				poster_path: item.poster_path,
				backdrop_path: item.backdrop_path,
				vote_average: item.vote_average
			}))
			.filter((item) => !isBlocked(item, mediaType));

	const popular = normalize(popularResponse.results ?? []);
	const topRated = normalize(topRatedResponse.results ?? []);
	const discover = normalize(discoverPages[0]?.results ?? []);

	const allTitles = [
		...new Map(
			discoverPages
				.flatMap((response) => normalize(response.results ?? []))
				.map((item) => [item.id, item])
		).values()
	];

	return {
		mediaType,
		popular,
		topRated,
		discover,
		allTitles
	};
}
