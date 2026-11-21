/**
 * @typedef {'movies' | 'shows'} SourceCategory
 * @typedef {{ id: string, type: 'movies' | 'shows', season?: number, episode?: number }} Media
 * @typedef {{
 *   id: string,
 *   label: string,
 *   priority: number,
 *   enabled?: boolean,
 *   down?: boolean,
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
	{ id: 'vidspark', label: 'VidSpark', priority: 3, url: ({ id }) => `https://vidspark.to/movie/${id}` },
	{ id: 'vixsrc', label: 'VixSrc', priority: 4, url: ({ id }) => `https://vixsrc.to/movie/${id}` },
	{ id: 'vidzee', label: 'VidZee', priority: 5, url: ({ id }) => `https://player.vidzee.wtf/embed/movie/${id}` },
	{ id: 'vidrock', label: 'VidRock', priority: 6, url: ({ id }) => `https://vidrock.net/movie/${id}` },
	{ id: 'twoembed', label: '2Embed', priority: 7, url: ({ id }) => `https://vidsrc.buzz/embed/movie/${id}` },
	{ id: 'vidfast', label: 'VidFast', priority: 9, url: ({ id }) => `https://vidfast.vc/movie/${id}?autoPlay=true` },
	{ id: 'vidcore', label: 'VidCore', priority: 10, url: ({ id }) => `https://vidcore.io/movie/${id}` },
	{ id: 'vidup', label: 'VidUp', priority: 11, url: ({ id }) => `https://vidup.to/movie/${id}` }
];

/** @type {Source[]} */
export const showSources = [
	{ id: 'vidspark', label: 'VidSpark', priority: 3, url: ({ id, season, episode }) => `https://vidspark.to/tv/${id}/${season}/${episode}` },
	{ id: 'vixsrc', label: 'VixSrc', priority: 4, url: ({ id, season, episode }) => `https://vixsrc.to/tv/${id}/${season}/${episode}` },
	{ id: 'vidzee', label: 'VidZee', priority: 5, url: ({ id, season, episode }) => `https://player.vidzee.wtf/embed/tv/${id}/${season}/${episode}` },
	{ id: 'vidrock', label: 'VidRock', priority: 6, url: ({ id, season, episode }) => `https://vidrock.net/tv/${id}/${season}/${episode}` },
	{ id: 'vidnest', label: 'VidNest', priority: 8, url: ({ id, season, episode }) => `https://vidnest.fun/tv/${id}/${season}/${episode}` },
	{ id: 'vidfast', label: 'VidFast', priority: 9, url: ({ id, season, episode }) => `https://vidfast.vc/tv/${id}/${season}/${episode}?autoPlay=true` },
	{ id: 'vidcore', label: 'VidCore', priority: 10, url: ({ id, season, episode }) => `https://vidcore.io/tv/${id}/${season}/${episode}` },
	{ id: 'vidup', label: 'VidUp', priority: 11, url: ({ id, season, episode }) => `https://vidup.to/tv/${id}/${season}/${episode}` }
];

/** @type {Record<SourceCategory, Source[]>} */
export const sourcesByCategory = {
	movies: movieSources,
	shows: showSources
};

/** @type {Record<SourceCategory, string>} */
export const categoryLabels = {
	movies: 'Movie sources',
	shows: 'Show sources'
};

/** @param {Media & { category?: SourceCategory, proxy?: string }} media */
export function buildCandidates({ id, type, category, season, episode, proxy }) {
	const list = sourcesByCategory[category ?? type] ?? sourcesByCategory[type] ?? [];

	return [...list]
		.filter((source) => source.enabled !== false && !source.down)
		.sort((a, b) => a.priority - b.priority)
		.map((source) => ({
			id: source.id,
			label: source.label,
			priority: source.priority,
			url: formatURL(source.url({ id, type, season, episode }), proxy)
		}));
}
