import { categorizeMedia, getMediaDetails } from '$lib/server/tmdb';
import { buildCandidates } from '$lib/sources';
import { json } from '@sveltejs/kit';

const PROBE_TIMEOUT = 4000;

/**
 * @param {typeof fetch} requestFetch
 * @param {string} url
 */
async function probe(requestFetch, url) {
	const controller = new AbortController();
	const timer = setTimeout(() => controller.abort(), PROBE_TIMEOUT);
	const startedAt = Date.now();

	try {
		let response = await requestFetch(url, {
			method: 'HEAD',
			redirect: 'follow',
			signal: controller.signal
		});

		if (response.status === 405 || response.status === 501) {
			response = await requestFetch(url, {
				method: 'GET',
				headers: { range: 'bytes=0-0' },
				redirect: 'follow',
				signal: controller.signal
			});
		}

		return { ok: response.ok, status: response.status, latency: Date.now() - startedAt };
	} catch {
		return { ok: false, status: 0, latency: Number.MAX_SAFE_INTEGER };
	} finally {
		clearTimeout(timer);
	}
}

/**
 * @param {typeof fetch} requestFetch
 * @param {string | null} requested
 * @param {string} id
 * @param {'movies' | 'shows'} mediaType
 */
async function resolveCategory(requestFetch, requested, id, mediaType) {
	if (requested === 'anime' || requested === 'movies' || requested === 'shows') {
		return requested;
	}

	try {
		return categorizeMedia(await getMediaDetails(requestFetch, id, mediaType), mediaType);
	} catch {
		return mediaType;
	}
}

/** @type {import('./$types').RequestHandler} */
export async function GET({ fetch, url }) {
	const id = url.searchParams.get('id')?.trim() ?? '';
	const mediaType = url.searchParams.get('type') === 'shows' ? 'shows' : 'movies';

	if (!id) {
		return json({ category: mediaType, sources: [], available: [], best: null });
	}

	const category = await resolveCategory(fetch, url.searchParams.get('category'), id, mediaType);
	const candidates = buildCandidates({ id, type: mediaType, category });
	const results = await Promise.all(
		candidates.map(async (candidate) => ({
			...candidate,
			...(await probe(fetch, candidate.url))
		}))
	);

	const available = results
		.filter((result) => result.ok)
		.sort((a, b) => a.priority - b.priority || a.latency - b.latency);

	return json({
		category,
		sources: results,
		available,
		best: available[0] ?? null
	});
}
