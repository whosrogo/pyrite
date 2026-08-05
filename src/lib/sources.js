/**
 * @typedef {'movies' | 'shows' | 'anime'} SourceCategory
 * @typedef {{ id: string, type: 'movies' | 'shows' }} Media
 * @typedef {{
 *   id: string,
 *   label: string,
 *   priority: number,
 *   url: (media: Media) => string
 * }} Source
 */

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
		id: 'tubi',
		label: 'Tubi',
		priority: 1,
		url: ({ id }) => `https://example.com/tubi/shows/${id}`
	},
	{
		id: 'pluto',
		label: 'Pluto TV',
		priority: 2,
		url: ({ id }) => `https://example.com/pluto/shows/${id}`
	},
	{
		id: 'roku',
		label: 'Roku Channel',
		priority: 3,
		url: ({ id }) => `https://example.com/roku/shows/${id}`
	},
	{
		id: 'hoopla',
		label: 'Hoopla',
		priority: 4,
		url: ({ id }) => `https://example.com/hoopla/shows/${id}`
	}
];

/** @type {Source[]} */
export const animeSources = [
	{
		id: 'crunchyroll',
		label: 'Crunchyroll',
		priority: 1,
		url: ({ id, type }) => `https://example.com/crunchyroll/anime/${type}/${id}`
	},
	{
		id: 'retrocrush',
		label: 'RetroCrush',
		priority: 2,
		url: ({ id, type }) => `https://example.com/retrocrush/anime/${type}/${id}`
	},
	{
		id: 'tubi-anime',
		label: 'Tubi Anime',
		priority: 3,
		url: ({ id, type }) => `https://example.com/tubi/anime/${type}/${id}`
	},
	{
		id: 'pluto-anime',
		label: 'Pluto Anime',
		priority: 4,
		url: ({ id, type }) => `https://example.com/pluto/anime/${type}/${id}`
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

/** @param {Media & { category?: SourceCategory }} media */
export function buildCandidates({ id, type, category }) {
	const list = sourcesByCategory[category ?? type] ?? sourcesByCategory[type];

	return [...list]
		.sort((a, b) => a.priority - b.priority)
		.map((source) => ({
			id: source.id,
			label: source.label,
			priority: source.priority,
			url: source.url({ id, type })
		}));
}
