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

/**
 * Generic TMDB GET used by the stream scrapers (no SvelteKit fetch available there).
 * @param {string} path
 * @param {Record<string, string | number | undefined | null>} [params]
 */
export function tmdb(path, params = {}) {
	const query = new URLSearchParams();
	for (const [key, value] of Object.entries(params)) {
		if (value != null) query.set(key, String(value));
	}
	const qs = query.size ? `?${query}` : '';

	return request(fetch, `${path}${qs}`);
}

/** @param {string} keywordIds */
function excludedKeywords(keywordIds) {
	return keywordIds ? `&without_keywords=${encodeURIComponent(keywordIds)}` : '';
}

/**
 * @param {typeof fetch} requestFetch
 * @param {string} [keywordIds]
 */
export function getPopularMovie(requestFetch, keywordIds = '') {
	return request(
		requestFetch,
		`/discover/movie?include_adult=false&include_video=false&language=en-US&page=1&sort_by=popularity.desc${excludedKeywords(keywordIds)}`
	);
}

/**
 * @param {typeof fetch} requestFetch
 * @param {string} [keywordIds]
 */
export function getTopRatedMovie(requestFetch, keywordIds = '') {
	return request(
		requestFetch,
		`/discover/movie?include_adult=false&include_video=false&language=en-US&page=1&sort_by=vote_average.desc&vote_count.gte=200${excludedKeywords(keywordIds)}`
	);
}

/**
 * @param {typeof fetch} requestFetch
 * @param {number} [page]
 * @param {string} [keywordIds]
 */
export function getDiscoverMovie(requestFetch, page = 1, keywordIds = '') {
	return request(
		requestFetch,
		`/discover/movie?include_adult=false&include_video=false&language=en-US&page=${page}&sort_by=popularity.desc${excludedKeywords(keywordIds)}`
	);
}

/**
 * @param {typeof fetch} requestFetch
 * @param {string} [keywordIds]
 */
export function getPopularShow(requestFetch, keywordIds = '') {
	return request(
		requestFetch,
		`/discover/tv?include_adult=false&language=en-US&page=1&sort_by=popularity.desc${excludedKeywords(keywordIds)}`
	);
}

/**
 * @param {typeof fetch} requestFetch
 * @param {string} [keywordIds]
 */
export function getTopRatedShow(requestFetch, keywordIds = '') {
	return request(
		requestFetch,
		`/discover/tv?include_adult=false&language=en-US&page=1&sort_by=vote_average.desc&vote_count.gte=200${excludedKeywords(keywordIds)}`
	);
}

/**
 * @param {typeof fetch} requestFetch
 * @param {number} [page]
 * @param {string} [keywordIds]
 */
export function getDiscoverShow(requestFetch, page = 1, keywordIds = '') {
	return request(
		requestFetch,
		`/discover/tv?include_adult=false&language=en-US&page=${page}&sort_by=popularity.desc${excludedKeywords(keywordIds)}`
	);
}

/**
 * @param {typeof fetch} requestFetch
 * @param {string} id
 * @param {'movies' | 'shows'} mediaType
 */
export function getMediaDetails(requestFetch, id, mediaType) {
	const endpoint = mediaType === 'shows' ? 'tv' : 'movie';

	return request(requestFetch, `/${endpoint}/${encodeURIComponent(id)}?language=en-US`);
}

/**
 * @param {typeof fetch} requestFetch
 * @param {string} id
 * @param {number} season
 */
export function getSeason(requestFetch, id, season) {
	return request(requestFetch, `/tv/${encodeURIComponent(id)}/season/${season}?language=en-US`);
}

/**
 * @param {typeof fetch} requestFetch
 * @param {string} query
 * @param {'movies' | 'shows'} mediaType
 */
export function searchMedia(requestFetch, query, mediaType) {
	const endpoint = mediaType === 'shows' ? 'tv' : 'movie';

	return request(
		requestFetch,
		`/search/${endpoint}?query=${encodeURIComponent(query)}&include_adult=true&language=en-US&page=1`
	);
}
