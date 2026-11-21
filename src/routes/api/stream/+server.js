import { getScrapeJob } from '$lib/server/streams';
import { json } from '@sveltejs/kit';

/**
 * Streams search progress as newline-delimited JSON so the player can show each
 * source being tried and start playing the moment the first live stream turns up.
 * See ScrapeEvent in $lib/server/streams for the event shapes.
 *
 * @type {import('./$types').RequestHandler}
 */
export function GET({ url }) {
	const id = url.searchParams.get('id')?.trim() ?? '';
	const isShow = url.searchParams.get('type') === 'shows';

	if (!/^\d+$/.test(id)) {
		return json({ error: 'numeric TMDB id required' }, { status: 400 });
	}

	const season = Number(url.searchParams.get('season')) || 1;
	const episode = Number(url.searchParams.get('episode')) || 1;
	// the viewer's last-used source, started first (ids look like "vidzee", "lookmovie")
	const rawPrefer = url.searchParams.get('prefer') ?? '';
	const prefer = /^[\w-]{1,40}$/.test(rawPrefer) ? rawPrefer : undefined;
	const job = isShow
		? getScrapeJob('tv', id, season, episode, prefer)
		: getScrapeJob('movie', id, undefined, undefined, prefer);

	const encoder = new TextEncoder();
	let closed = false;
	/** @type {(event: import('$lib/server/streams').ScrapeEvent) => void} */
	let send = () => {};

	const body = new ReadableStream({
		start(controller) {
			send = (event) => {
				if (closed) return;
				controller.enqueue(encoder.encode(`${JSON.stringify(event)}\n`));
				if (event.type === 'end') {
					closed = true;
					job.listeners.delete(send);
					controller.close();
				}
			};

			controller.enqueue(encoder.encode(`${JSON.stringify({ type: 'meta', cached: job.done })}\n`));
			for (const event of job.events) send(event);
			if (!closed) job.listeners.add(send);
		},
		cancel() {
			// the search keeps running for the cache; this viewer just stops listening
			closed = true;
			job.listeners.delete(send);
		}
	});

	return new Response(body, {
		headers: {
			'content-type': 'application/x-ndjson; charset=utf-8',
			'cache-control': 'no-store',
			'x-accel-buffering': 'no'
		}
	});
}
