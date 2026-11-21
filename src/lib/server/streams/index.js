import { PROVIDERS, scrapeAll } from './providers.js';
import { pstreamTasks } from './pstream.js';

/**
 * @typedef {{
 *   url: string,
 *   type: 'hls' | 'file',
 *   provider: string,
 *   providerName: string,
 *   source: string,
 *   quality?: string,
 *   headers?: Record<string, string>
 * }} Stream
 *
 * Progress events, in order: one `sources`, then per source an optional `checking`
 * (it returned candidates that are being liveness-checked) and exactly one `done`,
 * then a final `end`.
 * @typedef {(
 *   | { type: 'sources', sources: Array<{ id: string, name: string }> }
 *   | { type: 'checking', id: string, count: number }
 *   | { type: 'done', id: string, streams: Stream[] }
 *   | { type: 'end', found: number }
 * )} ScrapeEvent
 *
 * @typedef {{
 *   at: number,
 *   done: boolean,
 *   found: number,
 *   events: ScrapeEvent[],
 *   listeners: Set<(event: ScrapeEvent) => void>
 * }} ScrapeJob
 */

// finished searches are replayed for a while: repeat plays are instant and
// rate-limited sites get hit less. Unfinished ones are shared by every viewer.
const CACHE_TTL = 20 * 60 * 1000;
const CACHE_MAX = 200;
/** @type {Map<string, ScrapeJob>} */
const jobs = new Map();

/**
 * @param {'movie' | 'tv'} type
 * @param {string} tmdbId
 * @param {number} [season]
 * @param {number} [episode]
 * @param {string} [prefer] source id to start first (the viewer's last-used source)
 * @returns {ScrapeJob}
 */
function startJob(type, tmdbId, season, episode, prefer) {
	/** @type {ScrapeJob} */
	const job = { at: Date.now(), done: false, found: 0, events: [], listeners: new Set() };
	/** @type {Set<string>} */
	const settled = new Set();

	/** @param {ScrapeEvent} event */
	const emit = (event) => {
		if (job.done) return;
		job.events.push(event);
		for (const listener of job.listeners) listener(event);
	};

	const all = [...PROVIDERS, ...pstreamTasks(type)];
	// kick the preferred source off first so it isn't queued behind the heavy sandboxes
	const ordered = prefer
		? [...all.filter((task) => task.id === prefer), ...all.filter((task) => task.id !== prefer)]
		: all;
	const tasks = ordered.map((task) => ({
		...task,
		/** @param {...any} args */
		extract: async (...args) => {
			const streams = await task.extract(...args);
			// a task that already timed out can still return late; don't resurrect it
			if (streams?.length && !settled.has(task.id)) {
				emit({ type: 'checking', id: task.id, count: streams.length });
			}
			return streams;
		}
	}));

	emit({ type: 'sources', sources: tasks.map(({ id, name }) => ({ id, name })) });

	const finish = () => {
		emit({ type: 'end', found: job.found });
		job.done = true;
		job.at = Date.now();
		job.listeners.clear();
	};

	scrapeAll(
		type,
		tmdbId,
		season,
		episode,
		tasks,
		finish,
		/** @param {{ id: string }} task @param {Omit<Stream, 'source'>[]} streams */
		(task, streams) => {
			settled.add(task.id);
			job.found += streams.length;
			emit({
				type: 'done',
				id: task.id,
				streams: streams.map((stream) => ({ ...stream, source: task.id }))
			});
		}
	).catch(finish);

	return job;
}

/**
 * Returns the running or recently finished search for this title, starting one if
 * needed. Subscribers should replay `job.events` and then listen on `job.listeners`.
 *
 * @param {'movie' | 'tv'} type
 * @param {string} tmdbId
 * @param {number} [season]
 * @param {number} [episode]
 * @param {string} [prefer] source to start first; only matters when a new search starts
 */
export function getScrapeJob(type, tmdbId, season, episode, prefer) {
	const key = [type, tmdbId, season, episode].join(':');
	const existing = jobs.get(key);
	const fresh =
		existing && (!existing.done || (existing.found > 0 && Date.now() - existing.at < CACHE_TTL));
	if (existing && fresh) return existing;

	const job = startJob(type, tmdbId, season, episode, prefer);
	jobs.delete(key);
	jobs.set(key, job);

	if (jobs.size > CACHE_MAX) {
		for (const [oldKey, old] of jobs) {
			if (old.done) {
				jobs.delete(oldKey);
				break;
			}
		}
	}

	return job;
}
