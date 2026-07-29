import { TMDB } from '$env/static/private';

const API_URL = 'https://api.themoviedb.org/3';

/**
 * @param {typeof fetch} requestFetch
 * @param {string} path
 */
async function request(requestFetch, path) {
	const response = await requestFetch(`${API_URL}${path}`, {
		headers: {
			accept: 'application/json',
			Authorization: `Bearer ${TMDB}`
		}
	});

	if (!response.ok) {
		throw new Error(`TMDB request failed with status ${response.status}`);
	}

	return response.json();
}

/** @param {typeof fetch} requestFetch */
export function getPopularMovie(requestFetch) {
	return request(requestFetch, '/movie/popular?language=en-US&page=1');
}

/** @param {typeof fetch} requestFetch */
export function getTopRatedMovie(requestFetch) {
	return request(requestFetch, '/movie/top_rated?language=en-US&page=1');
}

/**
 * @param {typeof fetch} requestFetch
 * @param {number} [page]
 */
export function getDiscoverMovie(requestFetch, page = 1) {
	return request(
		requestFetch,
		`/discover/movie?include_adult=false&include_video=false&language=en-US&page=${page}&sort_by=popularity.desc`
	);
}
