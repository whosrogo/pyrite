import { getPopularMovie } from '$lib/server/tmdb';
import { getDiscoverMovie } from '$lib/server/tmdb';
export async function load() {
	let popularMovies = await getPopularMovie();
	let discoverMovies = await getDiscoverMovie();
	return await popularMovies;
}
