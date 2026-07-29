import {
	getDiscoverMovie,
	getPopularMovie,
	getTopRatedMovie
} from '$lib/server/tmdb';

/** @type {import('./$types').PageServerLoad} */
export async function load({ fetch }) {
	const allMoviesPageCount = 15;

	const [popularResponse, topRatedResponse, ...discoverPages] = await Promise.all([
		getPopularMovie(fetch),
		getTopRatedMovie(fetch),
		...Array.from({ length: allMoviesPageCount }, (_, index) =>
			getDiscoverMovie(fetch, index + 1)
		)
	]);

	/**
	 * @param {Array<{ id: number, title: string, poster_path: string | null } & Record<string, any>>} movies
	 */
	const withPosters = (movies) => movies.filter((movie) => movie.poster_path);
	const popular = withPosters(popularResponse.results ?? []);
	const topRated = withPosters(topRatedResponse.results ?? []);
	const discover = withPosters(discoverPages[0]?.results ?? []);

	const allMovies = [
		...new Map(
			discoverPages
				.flatMap((response) => withPosters(response.results ?? []))
				.map((movie) => [movie.id, movie])
		).values()
	];

	return {
		popular,
		topRated,
		discover,
		allMovies
	};
}
