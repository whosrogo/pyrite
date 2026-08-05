/** @type {Set<number>} */
export const blockedMovieIds = new Set([1728704]);

/** @type {Set<number>} */
export const blockedShowIds = new Set([]);

/** @type {Set<string>} */
const blockedTitles = new Set(
	['Some Movie Title', 'Some Show Title'].map((title) => title.trim().toLowerCase())
);

/**
 * @param {{ id: number, title: string }} item
 * @param {'movies' | 'shows'} mediaType
 */
export function isBlocked(item, mediaType) {
	const blockedIds = mediaType === 'shows' ? blockedShowIds : blockedMovieIds;

	return blockedIds.has(item.id) || blockedTitles.has(item.title.trim().toLowerCase());
}
