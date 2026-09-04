/**
 * @typedef {'movies' | 'shows' | 'anime'} SourceCategory
 * @typedef {{ id: string, type: 'movies' | 'shows', season?: number, episode?: number }} Media
 * @typedef {{
 *   id: string,
 *   label: string,
 *   priority: number,
 *   url: (media: Media) => string
 * }} Source
 */

export const DEFAULT_PROXY_ENDPOINT = 'https://v7.galxy.it.com/api';

/**
 * @param {string} target
 * @param {string} [endpoint]
 */
export function formatURL(target, endpoint) {
	if (!endpoint) return target;

	const encoded = encodeURIComponent(target);

	if (endpoint.includes('{url}')) {
		return endpoint.replace(/\$?\{url\}/g, encoded);
	}

	return `${endpoint}${endpoint.includes('?') ? '&' : '?'}url=${encoded}`;
}

/** @type {Source[]} */
export const movieSources = [
	{
		id: 'vidfast',
		label: 'Vidfast',
		priority: 6,
		url: ({ id }) => `https://tinyurl.com/3tv998w5/movie/${id}?autoPlay=true
`
	},
	{
		id: 'nebulaflix',
		label: 'Nebulaflix',
		priority: 5,
		url: ({ id }) => `https://tinyurl.com/44yxvzku/player?mt=${id}`
	},
	{
		id: 'mapple',
		label: 'Mapple',
		priority: 4,
		url: ({ id }) => `https://tinyurl.com/mtr5drt8/watch/movie/${id}`
	},
	{
		id: 'vidzee',
		label: 'Vidzee',
		priority: 3,
		url: ({ id }) => `https://tinyurl.com/4mm3msn9/embed/movie/${id}`
	},
	{
		id: 'videasy',
		label: 'Videasy',
		priority: 2,
		url: ({ id }) => `https://tinyurl.com/bdek4j5w/movie/${id}`
	},
	{
		id: '111movies',
		label: '111Movies',
		priority: 1,
		url: ({ id }) => `https://tinyurl.com/y8t5bx23/movie/${id}`
	}
];

/** @type {Source[]} */
export const showSources = [
	{
		id: 'vidfast',
		label: 'Vidfast',
		priority: 7,
		url: ({ id, season, episode }) =>
			`https://tinyurl.com/3tv998w5/tv/${id}/${season}/${episode}?autoPlay=true`
	},
	{
		id: 'nebulaflix',
		label: 'Nebulaflix',
		priority: 1,
		url: ({
			id,
			season,
			episode
		}) => `https://tinyurl.com/44yxvzku/player?st=${id}&season=${season}&episode=${episode}
`
	},
	{
		id: '111movies',
		label: '111movies',
		priority: 2,
		url: ({ id, season, episode }) => `https://tinyurl.com/y8t5bx23/tv/${id}/${season}/${episode}`
	},
	{
		id: 'vidzee',
		label: 'Vidzee',
		priority: 3,
		url: ({ id, season, episode }) =>
			`https://tinyurl.com/4mm3msn9/embed/tv/${id}/${season}/${episode}`
	},
	{
		id: 'videasy',
		label: 'Videasy',
		priority: 6,
		url: ({ id, season, episode }) => `https://tinyurl.com/bdek4j5w/tv/${id}/${season}/${episode}`
	}
];

/** @type {Source[]} */
export const animeSources = [
	{
		id: 'vidfast',
		label: 'Vidfast',
		priority: 3,
		url: ({ id, season, episode }) =>
			`https://tinyurl.com/3tv998w5/tv/${id}/${season}/${episode}?autoPlay=true`
	},
	{
		id: 'nebulaflix',
		label: 'Nebulaflix',
		priority: 2,
		url: ({
			id,
			season,
			episode
		}) => `https://tinyurl.com/44yxvzku/player?st=${id}&season=${season}&episode=${episode}
`
	},
	{
		id: '111movies',
		label: '111movies',
		priority: 5,
		url: ({ id, season, episode }) => `https://tinyurl.com/y8t5bx23/tv/${id}/${season}/${episode}`
	},
	{
		id: 'vidzee',
		label: 'Vidzee',
		priority: 4,
		url: ({ id, season, episode }) =>
			`https://tinyurl.com/4mm3msn9/embed/tv/${id}/${season}/${episode}`
	},
	{
		id: 'videasy',
		label: 'Videasy',
		priority: 1,
		url: ({ id, season, episode }) => `https://tinyurl.com/bdek4j5w/tv/${id}/${season}/${episode}`
	}
];

/** @type {Record<SourceCategory, Source[]>} */
export const sourcesByCategory = {
	movies: movieSources,
	shows: showSources,
	anime: animeSources
};

/** @type {Record<SourceCategory, string>} */
export const categoryLabels = {
	movies: 'Movie sources',
	shows: 'Show sources',
	anime: 'Anime sources'
};

/** @param {Media & { category?: SourceCategory, proxy?: string }} media */
export function buildCandidates({ id, type, category, season, episode, proxy }) {
	const list = sourcesByCategory[category ?? type] ?? sourcesByCategory[type];

	return [...list]
		.sort((a, b) => a.priority - b.priority)
		.map((source) => ({
			id: source.id,
			label: source.label,
			priority: source.priority,
			url: formatURL(source.url({ id, type, season, episode }), proxy)
		}));
}
