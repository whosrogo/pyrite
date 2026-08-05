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
		priority: 1,
		url: ({ id }) => `https://vidfast.vc/movie/${id}?autoPlay=true
`
	},
	{
		id: 'nebulaflix',
		label: 'Nebulaflix',
		priority: 2,
		url: ({ id }) => `https://nebulaflix.stream/player?mt=${id}`
	},
	{
		id: 'mapple',
		label: 'Mapple',
		priority: 3,
		url: ({ id }) => `https://mapple.uk/watch/movie/${id}`
	},
	{
		id: 'vidzee',
		label: 'Vidzee',
		priority: 4,
		url: ({ id }) => `https://player.vidzee.wtf/embed/movie/${id}`
	},
	{
		id: 'videasy',
		label: 'Videasy',
		priority: 4,
		url: ({ id }) => `https://player.videasy.net/movie/${id}`
	},
	{
		id: '111movies',
		label: '111Movies',
		priority: 4,
		url: ({ id }) => `https://111movies.net/movie/${id}`
	}
];

/** @type {Source[]} */
export const showSources = [
	{
		id: 'vidfast',
		label: 'Vidfast',
		priority: 2,
		url: ({ id, season, episode }) =>
			`https://vidfast.vc/tv/${id}/${season}/${episode}?autoPlay=true`
	},
	{
		id: 'nebulaflix',
		label: 'Nebulaflix',
		priority: 1,
		url: ({
			id,
			season,
			episode
		}) => `https://nebulaflix.stream/player?st=${id}&season=${season}&episode=${episode}
`
	},
	{
		id: 'vidzee',
		label: 'Vidzee',
		priority: 3,
		url: ({ id, season, episode }) =>
			`https://player.vidzee.wtf/embed/tv/${id}/${season}/${episode}`
	},
	{
		id: 'videasy',
		label: 'Videasy',
		priority: 4,
		url: ({ id, season, episode }) => `https://player.videasy.net/tv/${id}/${season}/${episode}`
	}
];

/** @type {Source[]} */
export const animeSources = [
	{
		id: 'vidfast',
		label: 'Vidfast',
		priority: 3,
		url: ({ id, season, episode }) =>
			`https://vidfast.vc/tv/${id}/${season}/${episode}?autoPlay=true`
	},
	{
		id: 'nebulaflix',
		label: 'Nebulaflix',
		priority: 2,
		url: ({
			id,
			season,
			episode
		}) => `https://nebulaflix.stream/player?st=${id}&season=${season}&episode=${episode}
`
	},
	{
		id: 'vidzee',
		label: 'Vidzee',
		priority: 4,
		url: ({ id, season, episode }) =>
			`https://player.vidzee.wtf/embed/tv/${id}/${season}/${episode}`
	},
	{
		id: 'videasy',
		label: 'Videasy',
		priority: 1,
		url: ({ id, season, episode }) => `https://player.videasy.net/tv/${id}/${season}/${episode}`
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
