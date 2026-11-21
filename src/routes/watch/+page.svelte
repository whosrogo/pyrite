<script>
	import { goto } from '$app/navigation';
	import { resolve } from '$app/paths';
	import { onMount } from 'svelte';
	import { flip } from 'svelte/animate';
	import { cubicOut } from 'svelte/easing';
	import { fly, scale } from 'svelte/transition';

	// no playback within this long counts as a failure and moves on to the next stream
	const STALL_TIMEOUT = 15000;
	const MAX_TRAIL = 6;
	// the source that last played: tried first, and autoplay waits this long for it
	const PREFERRED_KEY = 'preferredSource';
	const PREFERRED_WAIT = 7000;

	/**
	 * @typedef {{
	 *   url: string,
	 *   type: 'hls' | 'file',
	 *   provider: string,
	 *   providerName: string,
	 *   source: string,
	 *   quality?: string,
	 *   headers?: Record<string, string>,
	 *   captions?: Caption[]
	 * }} RawStream
	 * @typedef {{ url: string, language: string, label: string, headers?: Record<string, string> }} Caption
	 * @typedef {{
	 *   key: string,
	 *   label: string,
	 *   language: string,
	 *   group: 'stream' | 'title',
	 *   kind: 'file' | 'hls',
	 *   url?: string,
	 *   headers?: Record<string, string>,
	 *   index?: number
	 * }} SubtitleOption
	 * @typedef {RawStream & { label: string }} Stream
	 * @typedef {{ id: string, name: string, state: 'searching' | 'checking' | 'found' | 'none', count: number, order: number }} SourceProgress
	 * @typedef {'searching' | 'checking' | 'found' | 'none' | 'trying' | 'failed' | 'playing'} SourceView
	 * @typedef {{ key: number, url: string, label: string, result: 'trying' | 'failed' | 'playing' }} Attempt
	 */

	let selectedId = $state('');
	/** @type {'movies' | 'shows'} */
	let selectedType = $state('movies');

	/** @type {SourceProgress[]} */
	let sources = $state([]);
	/** @type {RawStream[]} */
	let rawStreams = [];
	/** @type {Stream[]} */
	let streams = $state([]);
	/** @type {string[]} */
	let deadUrls = $state([]);
	let activeUrl = $state('');
	let active = $derived(streams.find((stream) => stream.url === activeUrl) ?? null);
	/** @type {Attempt[]} */
	let attempts = $state([]);
	let attemptKey = 0;

	let searching = $state(false);
	let cached = $state(false);
	/** whether a failed stream falls through to the next one (off after a manual pick) */
	let autoAdvance = true;

	/** @type {'searching' | 'loading' | 'playing' | 'waiting' | 'empty' | 'failed' | 'error' | 'missing'} */
	let status = $state('searching');

	/** @type {Array<{ number: number, name: string, episodeCount: number }>} */
	let seasons = $state([]);
	/** @type {Array<{ number: number, name: string, airDate: string }>} */
	let episodes = $state([]);
	let season = $state(1);
	let episode = $state(1);

	/** @type {HTMLVideoElement | undefined} */
	let video = $state();
	/** @type {typeof import('hls.js').default | null} */
	let Hls = null;
	/** @type {import('hls.js').default | null} */
	let hls = null;
	/** @type {AbortController | null} */
	let playback = null;
	/** @type {AbortController | null} */
	let search = null;
	let stallTimer = 0;
	let playToken = 0;
	let scrapeToken = 0;
	let flipDuration = $state(450);

	/** @type {{ source: string, providerName?: string } | null} */
	let preferred = $state(null);
	let preferredDeadline = 0;
	let preferredTimer = 0;

	/** @param {{ source: string, providerName: string }} stream lower is tried first */
	function preferenceRank(stream) {
		if (!preferred || stream.source !== preferred.source) return 2;
		return stream.providerName === preferred.providerName ? 0 : 1;
	}

	let preferredProgress = $derived(
		preferred ? (sources.find((source) => source.id === preferred?.source) ?? null) : null
	);

	/**
	 * True while the first autoplay is held back for the last-used source: it hasn't
	 * answered yet, the wait hasn't run out, and none of its streams has failed.
	 */
	function holdingForPreferred() {
		if (!preferredProgress || status !== 'searching') return false;
		if (preferredProgress.state !== 'searching' && preferredProgress.state !== 'checking')
			return false;
		return Date.now() < preferredDeadline;
	}

	/** @param {Stream} stream */
	function rememberSource(stream) {
		preferred = { source: stream.source, providerName: stream.providerName };
		localStorage.setItem(PREFERRED_KEY, JSON.stringify(preferred));
	}

	// ---- subtitles ----
	const SUBTITLE_PREF = 'subtitleLanguage';
	/** @type {Caption[]} */
	let titleSubtitles = $state([]);
	let originalLanguage = $state('');
	/** @type {Array<{ index: number, name: string, lang: string }>} */
	let hlsTracks = $state([]);
	/** an explicit pick from the menu this episode ('' = automatic) */
	let manualSubtitle = $state('');
	/** @type {string[]} */
	let failedSubtitles = $state([]);
	let subtitleOffset = $state(0);
	/** @type {HTMLTrackElement | null} */
	let trackElement = null;
	/** @type {WeakMap<VTTCue | TextTrackCue, { start: number, end: number }>} */
	let cueTimes = new WeakMap();
	let subtitlePref = $state('');

	/** @param {string} code */
	const languageName = (code) => {
		try {
			return new Intl.DisplayNames(['en'], { type: 'language' }).of(code) ?? code;
		} catch {
			return code;
		}
	};

	/** @type {SubtitleOption[]} */
	let subtitleOptions = $derived.by(() => {
		/** @type {SubtitleOption[]} */
		const options = [];
		const seen = new Set();
		for (const caption of active?.captions ?? []) {
			if (seen.has(caption.url)) continue;
			seen.add(caption.url);
			options.push({
				key: `s:${caption.url}`,
				label: caption.label || languageName(caption.language) || 'Unknown',
				language: caption.language,
				group: 'stream',
				kind: 'file',
				url: caption.url,
				headers: caption.headers
			});
		}
		for (const track of hlsTracks) {
			options.push({
				key: `h:${track.index}`,
				label: track.name || languageName(track.lang) || `Track ${track.index + 1}`,
				language: (track.lang ?? '').slice(0, 2).toLowerCase(),
				group: 'stream',
				kind: 'hls',
				index: track.index
			});
		}
		for (const caption of titleSubtitles) {
			if (seen.has(caption.url)) continue;
			seen.add(caption.url);
			options.push({
				key: `t:${caption.url}`,
				label: caption.label,
				language: caption.language,
				group: 'title',
				kind: 'file',
				url: caption.url
			});
		}
		return options.filter((option) => !failedSubtitles.includes(option.key));
	});

	// stream-attached subtitles first (already synced to that file), then the title-wide ones
	let selectedSubtitle = $derived.by(() => {
		if (manualSubtitle === 'off') return null;
		const manual = subtitleOptions.find((option) => option.key === manualSubtitle);
		if (manual) return manual;

		if (subtitlePref === 'off') return null;
		const wanted = subtitlePref || (originalLanguage && originalLanguage !== 'en' ? 'en' : '');
		if (!wanted) return null;
		return (
			subtitleOptions.find((option) => option.language === wanted && option.group === 'stream') ??
			subtitleOptions.find((option) => option.language === wanted) ??
			null
		);
	});

	let streamSubtitles = $derived(subtitleOptions.filter((option) => option.group === 'stream'));
	let titleSubtitleGroups = $derived.by(() => {
		/** @type {Map<string, SubtitleOption[]>} */
		const groups = new Map();
		for (const option of subtitleOptions) {
			if (option.group !== 'title') continue;
			const name = option.label.replace(/\s+\d+$/, '');
			groups.set(name, [...(groups.get(name) ?? []), option]);
		}
		// the viewer's likely languages first
		const first = ['English', languageName(subtitlePref || 'en')];
		return [...groups].sort(
			([a], [b]) => Number(first.includes(b)) - Number(first.includes(a)) || a.localeCompare(b)
		);
	});

	/** @param {SubtitleOption} option */
	function subtitleSrc(option) {
		const params = new URLSearchParams({ url: option.url ?? '', lang: option.language });
		if (option.headers) params.set('headers', JSON.stringify(option.headers));
		return `${resolve('/api/subtitles/file')}?${params}`;
	}

	/** @param {Event} event */
	function handleSubtitleChange(event) {
		const value = /** @type {HTMLSelectElement} */ (event.currentTarget).value;
		manualSubtitle = value;
		const option = subtitleOptions.find((item) => item.key === value);
		subtitlePref = value === 'off' ? 'off' : (option?.language ?? subtitlePref);
		if (subtitlePref) localStorage.setItem(SUBTITLE_PREF, subtitlePref);
	}

	/** @param {TextTrack | null | undefined} track */
	function applyOffset(track) {
		for (const cue of track?.cues ?? []) {
			let base = cueTimes.get(cue);
			if (!base) {
				base = { start: cue.startTime, end: cue.endTime };
				cueTimes.set(cue, base);
			}
			cue.startTime = Math.max(0, base.start + subtitleOffset);
			cue.endTime = Math.max(0, base.end + subtitleOffset);
		}
	}

	/** @param {Event} event */
	function handleTrackLoad(event) {
		const element = /** @type {HTMLTrackElement} */ (event.currentTarget);
		trackElement = element;
		element.track.mode = 'showing';
		applyOffset(element.track);
	}

	/** @param {string} key */
	function handleTrackError(key) {
		if (!failedSubtitles.includes(key)) failedSubtitles = [...failedSubtitles, key];
	}

	/** @param {number} delta */
	function nudgeSubtitles(delta) {
		subtitleOffset = Math.round((subtitleOffset + delta) * 10) / 10;
	}

	$effect(() => {
		subtitleOffset;
		applyOffset(trackElement?.track);
	});

	// HLS-embedded tracks are switched through hls.js rather than a <track> element
	$effect(() => {
		const option = selectedSubtitle;
		hlsTracks;
		if (!hls) return;
		if (option?.kind === 'hls' && option.index !== undefined) {
			hls.subtitleTrack = option.index;
			hls.subtitleDisplay = true;
		} else {
			hls.subtitleDisplay = false;
			hls.subtitleTrack = -1;
		}
	});

	/** @param {number} token */
	async function loadSubtitles(token) {
		const params = new URLSearchParams({ id: selectedId, type: selectedType });
		if (selectedType === 'shows') {
			params.set('season', String(season));
			params.set('episode', String(episode));
		}
		try {
			const response = await fetch(`${resolve('/api/subtitles')}?${params}`);
			if (!response.ok) throw new Error('Subtitle lookup failed');
			const payload = await response.json();
			if (token !== scrapeToken) return;
			titleSubtitles = payload.subtitles ?? [];
			originalLanguage = payload.originalLanguage ?? '';
		} catch {
			if (token === scrapeToken) titleSubtitles = [];
		}
	}

	let settledCount = $derived(
		sources.filter((source) => source.state === 'found' || source.state === 'none').length
	);
	let progress = $derived(sources.length ? settledCount / sources.length : 0);
	let remaining = $derived(sources.length - settledCount);

	/** @type {Record<SourceView, number>} */
	const VIEW_RANK = {
		trying: 0,
		playing: 0,
		found: 1,
		checking: 2,
		searching: 3,
		failed: 4,
		none: 5
	};

	/**
	 * @param {SourceProgress} source
	 * @returns {SourceView}
	 */
	function viewOf(source) {
		if (active?.source === source.id) {
			if (status === 'loading') return 'trying';
			if (status === 'playing') return 'playing';
		}
		if (source.state !== 'found') return source.state;

		const own = streams.filter((stream) => stream.source === source.id);
		return own.length && own.every((stream) => deadUrls.includes(stream.url)) ? 'failed' : 'found';
	}

	// the source being tried floats to the front, finds next, dead ends sink to the back
	let radar = $derived(
		sources
			.map((source) => ({ ...source, view: viewOf(source) }))
			.sort(
				(a, b) =>
					VIEW_RANK[a.view] - VIEW_RANK[b.view] ||
					Number(b.id === preferred?.source) - Number(a.id === preferred?.source) ||
					a.order - b.order
			)
	);

	let headline = $derived.by(() => {
		switch (status) {
			case 'searching':
				if (preferredProgress && streams.length && holdingForPreferred()) {
					return `Checking ${preferredProgress.name} first`;
				}
				return sources.length ? `Searching ${sources.length} sources` : 'Starting the search';
			case 'loading':
				return `Trying ${active?.label ?? 'stream'}${active?.quality ? ` · ${active.quality}` : ''}`;
			case 'waiting':
				return 'Waiting on slower sources';
			case 'failed':
				return autoAdvance
					? 'Every stream failed'
					: `${attempts.at(-1)?.label ?? 'That stream'} couldn't play`;
			case 'empty':
				return 'No working stream found';
			case 'error':
				return 'Could not reach the stream finder';
			default:
				return '';
		}
	});

	let busy = $derived(status === 'searching' || status === 'loading' || status === 'waiting');

	/**
	 * Title artwork handed over by the browse page, so the opening animation can morph
	 * the clicked poster/backdrop into place before any data loads.
	 * @type {{ title?: string, year?: string, posterUrl?: string | null, backdropUrl?: string | null } | null}
	 */
	let meta = $state(null);

	/** The overlay lifting off like a curtain once the video starts. */
	function curtain(/** @type {HTMLElement} */ _node) {
		if (flipDuration === 0) return { duration: 0 };
		return {
			duration: 650,
			easing: cubicOut,
			css: (/** @type {number} */ t, /** @type {number} */ u) =>
				`opacity:${t};transform:scale(${1 + 0.04 * u});filter:blur(${10 * u}px)`
		};
	}

	onMount(() => {
		selectedId = localStorage.getItem('selectedMediaId') ?? '';
		selectedType = localStorage.getItem('selectedMediaType') === 'shows' ? 'shows' : 'movies';
		try {
			const stored = JSON.parse(localStorage.getItem('selectedMedia') ?? 'null');
			if (stored && String(stored.id) === selectedId) meta = stored;
		} catch {
			meta = null;
		}
		if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) flipDuration = 0;
		subtitlePref = localStorage.getItem(SUBTITLE_PREF) ?? '';
		try {
			const saved = JSON.parse(localStorage.getItem(PREFERRED_KEY) ?? 'null');
			if (saved && typeof saved.source === 'string') preferred = saved;
		} catch {
			preferred = null;
		}

		const ready = import('hls.js').then((module) => (Hls = module.default));

		if (!selectedId) {
			status = 'missing';
		} else if (selectedType === 'shows') {
			startShow(ready);
		} else {
			ready.finally(scrape);
		}

		return () => {
			search?.abort();
			stopPlayback();
		};
	});

	/** @param {Promise<unknown>} ready */
	async function startShow(ready) {
		await loadEpisodes();
		episode = episodes[0]?.number ?? 1;
		await ready.catch(() => {});
		scrape();
	}

	/** @param {number} [requested] */
	async function loadEpisodes(requested) {
		const params = new URLSearchParams({ id: selectedId });
		if (requested) params.set('season', String(requested));

		try {
			const response = await fetch(`${resolve('/api/episodes')}?${params}`);

			if (!response.ok) throw new Error('Episode lookup failed');

			const payload = await response.json();
			seasons = payload.seasons ?? [];
			episodes = payload.episodes ?? [];
			season = payload.season ?? 1;
		} catch {
			seasons = [];
			episodes = [];
		}
	}

	/** @param {Event} event */
	async function handleSeasonChange(event) {
		const next = Number(/** @type {HTMLSelectElement} */ (event.currentTarget).value);
		if (next === season) return;

		await loadEpisodes(next);
		episode = episodes[0]?.number ?? 1;
		scrape();
	}

	/** @param {Event} event */
	function handleEpisodeChange(event) {
		episode = Number(/** @type {HTMLSelectElement} */ (event.currentTarget).value);
		scrape();
	}

	/** @param {{ quality?: string }} stream */
	const qualityNumber = (stream) => parseInt(stream.quality ?? '') || 0;

	/**
	 * One button per server, keeping its highest quality; unlabeled mirrors stay separate.
	 * @param {RawStream[]} list
	 * @returns {Stream[]}
	 */
	function groupStreams(list) {
		/** @type {Map<string, RawStream>} */
		const best = new Map();
		for (const stream of list) {
			const key = `${stream.providerName}:${stream.type}${stream.quality ? '' : `:${stream.url}`}`;
			const current = best.get(key);
			if (!current || qualityNumber(stream) > qualityNumber(current)) best.set(key, stream);
		}

		/** @type {Record<string, number>} */
		const count = {};
		return [...best.values()]
			.map((stream) => {
				count[stream.providerName] = (count[stream.providerName] ?? 0) + 1;
				const suffix = count[stream.providerName] > 1 ? ` ${count[stream.providerName]}` : '';
				return { ...stream, label: `${stream.providerName}${suffix}` };
			})
			.sort((a, b) => preferenceRank(a) - preferenceRank(b));
	}

	async function scrape() {
		const token = ++scrapeToken;
		search?.abort();
		search = new AbortController();
		stopPlayback();

		sources = [];
		rawStreams = [];
		streams = [];
		deadUrls = [];
		attempts = [];
		activeUrl = '';
		autoAdvance = true;
		cached = false;
		searching = true;
		status = 'searching';
		titleSubtitles = [];
		manualSubtitle = '';
		failedSubtitles = [];
		subtitleOffset = 0;
		loadSubtitles(token);

		window.clearTimeout(preferredTimer);
		preferredDeadline = Date.now() + PREFERRED_WAIT;
		if (preferred) {
			// if the last-used source is still quiet when the wait runs out, play the rest
			preferredTimer = window.setTimeout(() => token === scrapeToken && advance(), PREFERRED_WAIT);
		}

		const params = new URLSearchParams({ id: selectedId, type: selectedType });
		if (selectedType === 'shows') {
			params.set('season', String(season));
			params.set('episode', String(episode));
		}
		if (preferred) params.set('prefer', preferred.source);

		try {
			const response = await fetch(`${resolve('/api/stream')}?${params}`, {
				signal: search.signal
			});
			if (!response.ok || !response.body) throw new Error('Stream search failed');

			const reader = response.body.pipeThrough(new TextDecoderStream()).getReader();
			let buffer = '';
			for (;;) {
				const { done, value } = await reader.read();
				if (done) break;
				buffer += value;
				let newline;
				while ((newline = buffer.indexOf('\n')) >= 0) {
					const line = buffer.slice(0, newline).trim();
					buffer = buffer.slice(newline + 1);
					if (line && token === scrapeToken) handleEvent(JSON.parse(line));
				}
			}
		} catch {
			if (token !== scrapeToken) return;
			if (!streams.length) {
				searching = false;
				status = 'error';
				return;
			}
		}

		if (token !== scrapeToken) return;
		searching = false;
		advance();
	}

	/** @param {any} event */
	function handleEvent(event) {
		switch (event.type) {
			case 'meta':
				cached = Boolean(event.cached);
				break;
			case 'sources':
				sources = event.sources.map(
					/** @param {{ id: string, name: string }} source @param {number} order */
					(source, order) => ({ ...source, state: 'searching', count: 0, order })
				);
				break;
			case 'checking': {
				const source = sources.find((item) => item.id === event.id);
				if (source?.state === 'searching') {
					source.state = 'checking';
					source.count = event.count;
				}
				break;
			}
			case 'done': {
				const source = sources.find((item) => item.id === event.id);
				if (source) {
					source.state = event.streams.length ? 'found' : 'none';
					source.count = event.streams.length;
				}
				if (event.streams.length) {
					rawStreams = [...rawStreams, ...event.streams];
					streams = groupStreams(rawStreams);
					advance();
				}
				break;
			}
			case 'end':
				searching = false;
				advance();
				break;
		}
	}

	/** Starts the next untried stream if nothing is in flight, or settles the outcome. */
	function advance() {
		if (status !== 'searching' && status !== 'waiting') return;
		// hold the first play for the last-used source (the timer set in scrape() re-runs this)
		if (holdingForPreferred()) return;

		const next = streams.find((stream) => !deadUrls.includes(stream.url));
		if (next) {
			play(next.url, true);
		} else if (searching) {
			status = streams.length ? 'waiting' : 'searching';
		} else {
			status = streams.length ? 'failed' : 'empty';
		}
	}

	/** @param {Stream} stream */
	function proxyUrl(stream) {
		const params = new URLSearchParams({ url: stream.url });
		if (stream.headers) params.set('headers', JSON.stringify(stream.headers));
		return `${resolve('/api/proxy')}?${params}`;
	}

	function stopPlayback() {
		playToken++;
		window.clearTimeout(stallTimer);
		playback?.abort();
		playback = null;
		hls?.destroy();
		hls = null;
		hlsTracks = [];
		trackElement = null;
		if (video) {
			video.pause();
			video.removeAttribute('src');
			video.load();
		}
	}

	/**
	 * @param {string} url
	 * @param {Attempt['result']} result
	 */
	function markAttempt(url, result) {
		const attempt = attempts.findLast((item) => item.url === url);
		if (attempt) attempt.result = result;
	}

	/**
	 * @param {string} url
	 * @param {boolean} [auto] fall through to the next stream on failure
	 */
	function play(url, auto = false) {
		const stream = streams.find((item) => item.url === url);
		if (!stream || !video) return;

		stopPlayback();
		const token = playToken;
		const media = video;
		activeUrl = url;
		autoAdvance = auto;
		status = 'loading';
		attempts = [
			...attempts,
			{ key: ++attemptKey, url, label: stream.label, result: /** @type {const} */ ('trying') }
		].slice(-MAX_TRAIL);

		playback = new AbortController();
		const { signal } = playback;

		let failed = false;
		const fail = () => {
			if (failed || token !== playToken) return;
			failed = true;
			window.clearTimeout(stallTimer);
			markAttempt(url, 'failed');
			if (!deadUrls.includes(url)) deadUrls = [...deadUrls, url];

			if (auto) {
				status = 'waiting';
				advance();
			} else {
				status = 'failed';
			}
		};

		stallTimer = window.setTimeout(fail, STALL_TIMEOUT);
		media.addEventListener(
			'playing',
			() => {
				if (token !== playToken) return;
				window.clearTimeout(stallTimer);
				markAttempt(url, 'playing');
				status = 'playing';
				rememberSource(stream);
			},
			{ signal }
		);
		// clearing the previous source can queue an error with no MediaError attached
		media.addEventListener('error', () => media.error && fail(), { signal });

		const src = proxyUrl(stream);
		if (stream.type === 'hls' && Hls?.isSupported()) {
			const instance = new Hls();
			instance.on(Hls.Events.MANIFEST_PARSED, () => media.play().catch(() => {}));
			instance.on(Hls.Events.ERROR, (_event, data) => data.fatal && fail());
			instance.on(Hls.Events.SUBTITLE_TRACKS_UPDATED, (_event, data) => {
				if (token !== playToken) return;
				hlsTracks = data.subtitleTracks.map((track, index) => ({
					index,
					name: track.name ?? '',
					lang: track.lang ?? ''
				}));
			});
			instance.loadSource(src);
			instance.attachMedia(media);
			hls = instance;
		} else {
			media.src = src;
			media.play().catch(() => {});
		}
	}
</script>

<svelte:head>
	<title>Pyrite — {meta?.title ?? 'Watch'}</title>
</svelte:head>

<main>
	<button class="back" type="button" onclick={() => goto(resolve('/'))}>← Back to browse</button>

	<div class="player">
		<!-- svelte-ignore a11y_media_has_caption -->
		<video bind:this={video} class:revealed={status === 'playing'} controls autoplay playsinline>
			{#if selectedSubtitle?.kind === 'file'}
				{@const subtitle = selectedSubtitle}
				{#key `${subtitle.key}|${activeUrl}`}
					<track
						kind="subtitles"
						src={subtitleSrc(subtitle)}
						srclang={subtitle.language || undefined}
						label={subtitle.label}
						default
						onload={handleTrackLoad}
						onerror={() => handleTrackError(subtitle.key)}
					/>
				{/key}
			{/if}
		</video>

		{#if status !== 'playing'}
			<div class="overlay" out:curtain>
				{#if meta?.backdropUrl}
					<img class="backdrop" src={meta.backdropUrl} alt="" />
				{/if}
				<div class="overlay-scroll">
					<div class="finder">
						{#if meta?.title}
							<div class="title-card">
								{#if meta.posterUrl}
									<img class="title-poster" src={meta.posterUrl} alt="" />
								{/if}
								<div class="title-copy">
									<p class="kicker">
										{selectedType === 'shows' ? 'Show' : 'Movie'}{meta.year
											? ` · ${meta.year}`
											: ''}
										{#if selectedType === 'shows' && seasons.length}
											· S{season} E{episode}
										{/if}
									</p>
									<h1>{meta.title}</h1>
								</div>
							</div>
						{/if}
						{#if status === 'missing'}
							<p class="headline">No title selected.</p>
							<button class="cta" type="button" onclick={() => goto(resolve('/'))}>
								Browse titles
							</button>
						{:else}
							<div class="heading" aria-live="polite">
								<p
									class="headline"
									class:busy
									class:bad={status === 'error' || status === 'failed' || status === 'empty'}
								>
									{headline}
								</p>
								<p class="subline">
									{#if sources.length}
										{settledCount} of {sources.length} sources checked · {streams.length}
										{streams.length === 1 ? 'stream' : 'streams'} found
										{#if cached}<span class="tag">recent search</span>{/if}
									{:else if status === 'error'}
										Check your connection and try again.
									{:else}
										Contacting sources…
									{/if}
								</p>
							</div>

							<div
								class="progress"
								class:running={searching}
								role="progressbar"
								aria-label="Sources checked"
								aria-valuemin="0"
								aria-valuemax={sources.length}
								aria-valuenow={settledCount}
							>
								<span style:width="{progress * 100}%"></span>
							</div>

							{#if attempts.length}
								<ol class="trail" aria-label="Streams tried">
									{#each attempts as attempt (attempt.key)}
										<li class={attempt.result} in:fly={{ x: 14, duration: 260 }}>
											<span class="mark" aria-hidden="true"></span>
											{attempt.label}
											<span class="visually-hidden">— {attempt.result}</span>
										</li>
									{/each}
								</ol>
							{/if}

							{#if radar.length}
								<ul class="radar" aria-label="Sources">
									{#each radar as source (source.id)}
										<li
											class="chip {source.view}"
											style:--delay="{(source.order % 9) * 0.11}s"
											animate:flip={{ duration: flipDuration }}
										>
											<span class="indicator" aria-hidden="true"></span>
											<span class="name">{source.name}</span>
											{#if source.id === preferred?.source}
												<span class="last-used">last used</span>
											{/if}
											{#if source.view === 'checking'}
												<span class="meta">verifying {source.count}</span>
											{:else if source.view === 'trying'}
												<span class="meta">trying</span>
											{:else if source.count && source.view !== 'none'}
												<span class="meta">{source.count}</span>
											{/if}
											<span class="visually-hidden">— {source.view}</span>
										</li>
									{/each}
								</ul>
							{/if}

							{#if !busy}
								<button class="cta" type="button" onclick={scrape}>
									{status === 'error' ? 'Try again' : 'Search again'}
								</button>
							{/if}
						{/if}
					</div>
				</div>
			</div>
		{/if}
	</div>

	{#if seasons.length || subtitleOptions.length}
		<nav class="episodes" aria-label="Season, episode and subtitles">
			{#if seasons.length}
				<label>
					<span>Season</span>
					<select value={season} onchange={handleSeasonChange}>
						{#each seasons as item (item.number)}
							<option value={item.number}>{item.name}</option>
						{/each}
					</select>
				</label>

				<label>
					<span>Episode</span>
					<select value={episode} onchange={handleEpisodeChange}>
						{#each episodes as item (item.number)}
							<option value={item.number}>{item.number}. {item.name}</option>
						{/each}
					</select>
				</label>
			{/if}

			{#if subtitleOptions.length}
				<label>
					<span>Subtitles</span>
					<select value={selectedSubtitle?.key ?? 'off'} onchange={handleSubtitleChange}>
						<option value="off">Off</option>
						{#if streamSubtitles.length}
							<optgroup label="From this server">
								{#each streamSubtitles as option (option.key)}
									<option value={option.key}>{option.label}</option>
								{/each}
							</optgroup>
						{/if}
						{#each titleSubtitleGroups as [name, options] (name)}
							<optgroup label={name}>
								{#each options as option (option.key)}
									<option value={option.key}>{option.label}</option>
								{/each}
							</optgroup>
						{/each}
					</select>
				</label>

				{#if selectedSubtitle?.kind === 'file'}
					<div class="sub-offset" role="group" aria-label="Subtitle timing">
						<button
							type="button"
							onclick={() => nudgeSubtitles(-0.5)}
							aria-label="Subtitles earlier">−</button
						>
						<span>{subtitleOffset > 0 ? '+' : ''}{subtitleOffset.toFixed(1)}s</span>
						<button type="button" onclick={() => nudgeSubtitles(0.5)} aria-label="Subtitles later"
							>+</button
						>
					</div>
				{/if}
			{/if}
		</nav>
	{/if}

	{#if streams.length}
		<nav class="sources" aria-label="Servers">
			<p class="sources-label">
				Servers
				{#if searching && status === 'playing'}
					<span class="live" transition:scale={{ duration: 200 }}>
						<span class="live-dot" aria-hidden="true"></span>
						still searching · {remaining} left
					</span>
				{/if}
			</p>
			{#each streams as stream (stream.url)}
				<button
					type="button"
					in:scale={{ start: 0.6, duration: 260 }}
					class:active={stream.url === activeUrl}
					class:trying={stream.url === activeUrl && status === 'loading'}
					class:dead={deadUrls.includes(stream.url)}
					class:preferred={preferenceRank(stream) === 0}
					title={preferenceRank(stream) === 0 ? 'Last used server' : undefined}
					onclick={() => play(stream.url)}
				>
					<span class="dot" aria-hidden="true"></span>
					{stream.label}
					{#if stream.quality}<span class="quality">{stream.quality}</span>{/if}
				</button>
			{/each}
		</nav>
	{/if}
</main>

<style>
	:global(body) {
		margin: 0;
		background: oklch(0.14 0.004 80);
		color: oklch(0.97 0.008 95);
		font-family: Inter, ui-sans-serif, system-ui, sans-serif;
	}

	/* OKLCH palette (matches the browse page) */
	main {
		--bg: oklch(0.14 0.004 80);
		--surface: oklch(0.19 0.005 80);
		--raised: oklch(0.24 0.006 80);
		--fg: oklch(0.97 0.008 95);
		--muted: oklch(0.97 0.008 95 / 0.62);
		--dim: oklch(0.97 0.008 95 / 0.42);
		--gold: oklch(0.8 0.15 78);
		--gold-soft: oklch(0.8 0.15 78 / 0.16);
		--on-gold: oklch(0.16 0.01 78);
		--green: oklch(0.77 0.16 150);
		--green-soft: oklch(0.77 0.16 150 / 0.14);
		--red: oklch(0.71 0.17 22);
		--red-soft: oklch(0.71 0.17 22 / 0.12);
		--focus-ring: 0 0 0 3px oklch(0.8 0.15 78 / 0.38);
		--ease: cubic-bezier(0.16, 1, 0.3, 1);
		display: grid;
		min-height: 100svh;
		grid-template-rows: 1fr auto;
	}

	.back {
		position: fixed;
		z-index: 10;
		top: 1.5rem;
		right: 1.5rem;
		padding: 0.75rem 1rem;
		border: 0;
		border-radius: 999px;
		background: oklch(0.19 0.005 80 / 0.8);
		box-shadow: 0 0.5rem 1.5rem oklch(0 0 0 / 0.35);
		backdrop-filter: blur(12px);
		color: var(--fg);
		font: inherit;
		font-size: 0.78rem;
		cursor: pointer;
		transition:
			background-color 160ms ease,
			transform 220ms var(--ease);
		animation: rise 0.6s var(--ease) 0.15s both;
	}

	.back:hover {
		background: var(--raised);
		transform: translateX(-2px);
	}

	/* keyboard focus: soft glow, no hard outline */
	.back:focus-visible,
	.cta:focus-visible,
	.sources button:focus-visible,
	.episodes select:focus-visible {
		outline: none;
		box-shadow: var(--focus-ring);
	}

	.player {
		position: relative;
		width: 100%;
		height: 100%;
		min-height: 60svh;
		overflow: hidden;
		background: oklch(0 0 0);
	}

	video {
		position: absolute;
		inset: 0;
		display: block;
		width: 100%;
		height: 100%;
		background: oklch(0 0 0);
		opacity: 0;
		transform: scale(0.985);
		transition:
			opacity 0.9s ease,
			transform 1.1s var(--ease);
	}

	video.revealed {
		opacity: 1;
		transform: none;
	}

	/* ---------- source finder overlay ---------- */

	/* the overlay clips the drifting backdrop; scrolling happens in an inner layer so the
	   scaled image never creates scrollbars */
	.overlay {
		position: absolute;
		inset: 0;
		overflow: hidden;
		background:
			radial-gradient(60rem 30rem at 50% 0%, oklch(0.8 0.15 78 / 0.07), transparent 70%), var(--bg);
	}

	/* the title's backdrop, slowly drifting behind the search */
	.backdrop {
		position: absolute;
		inset: 0;
		width: 100%;
		height: 100%;
		object-fit: cover;
		opacity: 0.22;
		filter: blur(2px) saturate(0.8);
		mask-image: linear-gradient(to bottom, oklch(0 0 0) 30%, transparent 95%);
		pointer-events: none;
		view-transition-name: opening-backdrop;
		animation: drift 18s ease-in-out infinite alternate;
	}

	.overlay-scroll {
		position: absolute;
		inset: 0;
		display: grid;
		place-items: center;
		overflow-x: hidden;
		overflow-y: auto;
		padding: 4.5rem 1.25rem 1.5rem;
	}

	.finder {
		position: relative;
		display: grid;
		justify-items: center;
		gap: 1.1rem;
		width: min(100%, 48rem);
		text-align: center;
	}

	.title-card {
		display: flex;
		align-items: center;
		gap: 1.1rem;
		margin-bottom: 0.4rem;
		text-align: left;
	}

	.title-poster {
		width: clamp(4.5rem, 9vw, 6.5rem);
		aspect-ratio: 2 / 3;
		border-radius: 0.6rem;
		object-fit: cover;
		box-shadow: 0 1rem 2.5rem oklch(0 0 0 / 0.5);
		view-transition-name: opening-poster;
	}

	.title-copy > * {
		animation: rise 0.7s var(--ease) both;
	}

	.kicker {
		margin: 0 0 0.35rem;
		color: var(--gold);
		font-size: 0.62rem;
		font-weight: 800;
		letter-spacing: 0.18em;
		text-transform: uppercase;
		animation-delay: 0.12s;
	}

	.title-copy h1 {
		margin: 0;
		font-family: momcake, Inter, ui-sans-serif, system-ui, sans-serif;
		font-size: clamp(1.8rem, 4.5vw, 3rem);
		font-weight: 850;
		letter-spacing: -0.045em;
		line-height: 0.95;
		text-wrap: balance;
		animation-delay: 0.2s;
	}

	.heading {
		display: grid;
		gap: 0.4rem;
		animation: rise 0.6s var(--ease) 0.28s both;
	}

	.headline {
		margin: 0;
		color: var(--fg);
		font-size: 1.05rem;
		font-weight: 700;
		letter-spacing: 0.01em;
	}

	.headline.bad {
		color: var(--red);
	}

	/* animated trailing dots while something is happening */
	.headline.busy::after {
		content: '';
		display: inline-block;
		width: 1.2em;
		text-align: left;
		animation: dots 1.2s steps(4, end) infinite;
	}

	.subline {
		margin: 0;
		color: var(--dim);
		font-size: 0.74rem;
		font-variant-numeric: tabular-nums;
	}

	.tag {
		margin-left: 0.4rem;
		padding: 0.1rem 0.45rem;
		border-radius: 999px;
		background: oklch(0.97 0.008 95 / 0.08);
		font-size: 0.64rem;
	}

	.progress {
		position: relative;
		width: min(100%, 22rem);
		height: 3px;
		overflow: hidden;
		border-radius: 999px;
		background: oklch(0.97 0.008 95 / 0.08);
		animation: rise 0.6s var(--ease) 0.34s both;
	}

	.progress span {
		position: absolute;
		inset: 0 auto 0 0;
		border-radius: inherit;
		background: var(--gold);
		transition: width 0.45s ease;
	}

	.progress.running::after {
		content: '';
		position: absolute;
		inset: 0;
		background: linear-gradient(90deg, transparent, oklch(1 0 0 / 0.55), transparent);
		transform: translateX(-100%);
		animation: sweep 1.4s ease-in-out infinite;
	}

	/* attempt trail: VidSrc → VixSrc */
	.trail {
		display: flex;
		flex-wrap: wrap;
		justify-content: center;
		align-items: center;
		gap: 0.35rem;
		margin: 0;
		padding: 0;
		list-style: none;
	}

	.trail li {
		display: flex;
		align-items: center;
		gap: 0.4rem;
		padding: 0.3rem 0.7rem;
		border-radius: 999px;
		background: var(--surface);
		color: var(--muted);
		font-size: 0.7rem;
		font-weight: 650;
	}

	.trail li + li::before {
		content: '→';
		color: oklch(0.97 0.008 95 / 0.25);
		text-decoration: none;
	}

	.trail .mark {
		position: relative;
		width: 0.45rem;
		height: 0.45rem;
		border-radius: 50%;
	}

	.trail .trying {
		background: var(--gold-soft);
		color: var(--fg);
	}

	.trail .trying .mark {
		background: var(--gold);
	}

	.trail .trying .mark::after {
		content: '';
		position: absolute;
		inset: 0;
		border-radius: 50%;
		background: var(--gold);
		animation: ping 1.1s ease-out infinite;
	}

	.trail .failed {
		color: var(--dim);
		text-decoration: line-through;
		animation: shake 0.38s ease;
	}

	.trail .failed .mark {
		background: var(--red);
	}

	.trail .playing {
		background: var(--green-soft);
	}

	.trail .playing .mark {
		background: var(--green);
	}

	/* source radar: state is carried by tint + indicator, no outlines */
	.radar {
		display: flex;
		flex-wrap: wrap;
		justify-content: center;
		gap: 0.4rem;
		margin: 0;
		padding: 0;
		list-style: none;
	}

	.chip {
		position: relative;
		display: flex;
		align-items: center;
		gap: 0.45rem;
		overflow: hidden;
		padding: 0.42rem 0.75rem;
		border-radius: 999px;
		background: var(--surface);
		color: var(--muted);
		font-size: 0.7rem;
		font-weight: 600;
		white-space: nowrap;
		transition:
			opacity 0.4s ease,
			color 0.3s ease,
			background-color 0.3s ease;
		animation: chip-in 0.45s var(--ease) both;
		animation-delay: calc(var(--delay) * 0.6 + 0.3s);
	}

	.indicator {
		position: relative;
		flex: none;
		width: 0.55rem;
		height: 0.55rem;
		border-radius: 50%;
	}

	.meta {
		color: var(--dim);
		font-size: 0.62rem;
		font-variant-numeric: tabular-nums;
	}

	/* searching: spinner + light sweeping across the chip */
	.chip.searching::after {
		content: '';
		position: absolute;
		inset: 0;
		background: linear-gradient(
			100deg,
			transparent 30%,
			oklch(0.97 0.008 95 / 0.06),
			transparent 70%
		);
		transform: translateX(-100%);
		animation: sweep 1.8s ease-in-out infinite;
		animation-delay: var(--delay);
	}

	.chip.searching .indicator {
		background: conic-gradient(var(--fg) 0 25%, oklch(0.97 0.008 95 / 0.18) 25% 100%);
		mask: radial-gradient(circle, transparent 42%, oklch(0 0 0) 46%);
		animation: spin 0.8s linear infinite;
		animation-delay: var(--delay);
	}

	/* checking: returned candidates, now verifying they are alive */
	.chip.checking {
		background: var(--gold-soft);
		color: var(--fg);
	}

	.chip.checking .indicator {
		background: var(--gold);
		animation: breathe 0.9s ease-in-out infinite;
	}

	/* found: live streams */
	.chip.found {
		background: var(--green-soft);
		color: var(--fg);
		animation: pop 0.42s cubic-bezier(0.3, 1.6, 0.5, 1);
	}

	.chip.found .indicator,
	.chip.playing .indicator {
		background: var(--green);
	}

	.chip.found .meta {
		color: var(--green);
	}

	/* trying: the source whose stream is loading right now */
	.chip.trying {
		background: oklch(0.8 0.15 78 / 0.24);
		color: var(--fg);
		animation: glow 1.2s ease-in-out infinite;
	}

	.chip.trying .indicator {
		background: var(--gold);
	}

	.chip.trying .indicator::after {
		content: '';
		position: absolute;
		inset: 0;
		border-radius: 50%;
		background: var(--gold);
		animation: ping 1.1s ease-out infinite;
	}

	.chip.trying .meta {
		color: var(--gold);
	}

	.chip.playing {
		background: oklch(0.77 0.16 150 / 0.24);
		color: var(--fg);
	}

	/* failed: found streams, none of them played */
	.chip.failed {
		background: var(--red-soft);
		color: var(--dim);
		animation: shake 0.38s ease;
	}

	.chip.failed .name {
		text-decoration: line-through;
	}

	.chip.failed .indicator {
		background: var(--red);
	}

	/* none: came back empty */
	.chip.none {
		opacity: 0.3;
	}

	.chip.none .indicator {
		background: oklch(0.97 0.008 95 / 0.3);
	}

	.cta {
		padding: 0.7rem 1.2rem;
		border: 0;
		border-radius: 999px;
		background: var(--gold);
		color: var(--on-gold);
		font: inherit;
		font-size: 0.75rem;
		font-weight: 750;
		cursor: pointer;
		transition:
			transform 220ms var(--ease),
			filter 160ms ease;
	}

	.cta:hover {
		filter: brightness(1.06);
		transform: translateY(-1px);
	}

	.visually-hidden {
		position: absolute;
		width: 1px;
		height: 1px;
		overflow: hidden;
		clip-path: inset(50%);
		white-space: nowrap;
	}

	/* ---------- episode + server bars ---------- */

	.episodes {
		display: flex;
		flex-wrap: wrap;
		justify-content: center;
		gap: 0.6rem;
		padding: 1rem 1rem 0;
		background: var(--bg);
	}

	.episodes label {
		display: flex;
		align-items: center;
		gap: 0.55rem;
		min-width: 0;
		color: var(--dim);
		font-size: 0.62rem;
		font-weight: 800;
		letter-spacing: 0.16em;
		text-transform: uppercase;
	}

	.episodes select {
		max-width: 16rem;
		padding: 0.55rem 0.9rem;
		border: 0;
		border-radius: 999px;
		background: var(--surface);
		color: oklch(0.97 0.008 95 / 0.86);
		font: inherit;
		font-size: 0.74rem;
		font-weight: 600;
		text-overflow: ellipsis;
		cursor: pointer;
		transition: background-color 160ms ease;
	}

	.episodes select:hover {
		background: var(--raised);
	}

	.sub-offset {
		display: flex;
		align-items: center;
		gap: 0.2rem;
		padding: 0.2rem;
		border-radius: 999px;
		background: var(--surface);
		color: oklch(0.97 0.008 95 / 0.86);
		font-size: 0.7rem;
		font-variant-numeric: tabular-nums;
	}

	.sub-offset span {
		min-width: 3.2em;
		text-align: center;
	}

	.sub-offset button {
		width: 1.8rem;
		height: 1.8rem;
		border: 0;
		border-radius: 50%;
		background: transparent;
		color: inherit;
		font: inherit;
		font-size: 0.9rem;
		cursor: pointer;
	}

	.sub-offset button:hover {
		background: var(--raised);
	}

	video::cue {
		background: rgb(0 0 0 / 0.6);
		font-family: Inter, ui-sans-serif, system-ui, sans-serif;
	}

	.sources {
		display: flex;
		flex-wrap: wrap;
		align-items: center;
		justify-content: center;
		gap: 0.4rem;
		padding: 1rem 1rem max(1rem, env(safe-area-inset-bottom));
		background: var(--bg);
	}

	.sources-label {
		display: flex;
		align-items: center;
		justify-content: center;
		gap: 0.6rem;
		width: 100%;
		margin: 0 0 0.35rem;
		color: var(--gold);
		font-size: 0.62rem;
		font-weight: 800;
		letter-spacing: 0.18em;
		text-transform: uppercase;
	}

	.live {
		display: inline-flex;
		align-items: center;
		gap: 0.4rem;
		padding: 0.2rem 0.55rem;
		border-radius: 999px;
		background: oklch(0.97 0.008 95 / 0.06);
		color: var(--dim);
		font-size: 0.6rem;
		font-weight: 650;
		letter-spacing: 0.04em;
		text-transform: none;
	}

	.live-dot {
		position: relative;
		width: 0.4rem;
		height: 0.4rem;
		border-radius: 50%;
		background: var(--gold);
	}

	.live-dot::after {
		content: '';
		position: absolute;
		inset: 0;
		border-radius: 50%;
		background: var(--gold);
		animation: ping 1.1s ease-out infinite;
	}

	.sources button {
		display: flex;
		align-items: center;
		gap: 0.5rem;
		padding: 0.6rem 1rem;
		border: 0;
		border-radius: 999px;
		background: var(--surface);
		color: var(--muted);
		font: inherit;
		font-size: 0.74rem;
		font-weight: 650;
		cursor: pointer;
		transition:
			background-color 200ms ease,
			color 200ms ease,
			transform 220ms var(--ease);
	}

	.sources button:hover {
		background: var(--raised);
		color: var(--fg);
	}

	.sources button:active {
		transform: scale(0.96);
	}

	.sources button.active {
		background: var(--gold);
		color: var(--on-gold);
	}

	.sources button.trying {
		animation: glow 1.2s ease-in-out infinite;
	}

	.sources button.dead {
		opacity: 0.45;
		text-decoration: line-through;
	}

	.sources button.preferred:not(.active) {
		box-shadow: inset 0 0 0 1px rgba(239, 179, 61, 0.45);
	}

	.last-used {
		padding: 0.05rem 0.4rem;
		border-radius: 999px;
		background: rgba(239, 179, 61, 0.16);
		color: var(--gold);
		font-size: 0.56rem;
		font-weight: 750;
		letter-spacing: 0.04em;
		text-transform: uppercase;
	}

	.dot {
		width: 0.42rem;
		height: 0.42rem;
		border-radius: 50%;
		background: var(--green);
	}

	.sources button.dead .dot {
		background: var(--red);
	}

	.sources button.active .dot {
		background: var(--on-gold);
	}

	.quality {
		opacity: 0.6;
		font-size: 0.66rem;
	}

	/* ---------- keyframes ---------- */

	@keyframes rise {
		from {
			opacity: 0;
			transform: translateY(12px);
		}
	}

	@keyframes chip-in {
		from {
			opacity: 0;
			transform: translateY(8px) scale(0.92);
		}
	}

	@keyframes drift {
		from {
			transform: scale(1.06) translate3d(-1%, 0, 0);
		}
		to {
			transform: scale(1.12) translate3d(1%, -1%, 0);
		}
	}

	@keyframes spin {
		to {
			transform: rotate(360deg);
		}
	}

	@keyframes sweep {
		to {
			transform: translateX(100%);
		}
	}

	@keyframes breathe {
		50% {
			opacity: 0.35;
			transform: scale(0.75);
		}
	}

	@keyframes ping {
		from {
			opacity: 0.75;
			transform: scale(1);
		}
		to {
			opacity: 0;
			transform: scale(2.6);
		}
	}

	@keyframes pop {
		0% {
			transform: scale(0.85);
		}
		100% {
			transform: scale(1);
		}
	}

	@keyframes glow {
		50% {
			box-shadow: 0 0 0 4px oklch(0.8 0.15 78 / 0.18);
		}
	}

	@keyframes shake {
		20%,
		60% {
			transform: translateX(-3px);
		}
		40%,
		80% {
			transform: translateX(3px);
		}
	}

	@keyframes dots {
		0% {
			content: '';
		}
		25% {
			content: '.';
		}
		50% {
			content: '..';
		}
		75% {
			content: '...';
		}
	}

	@media (prefers-reduced-motion: reduce) {
		main *,
		main *::before,
		main *::after {
			animation: none !important;
			transition: none !important;
		}

		video {
			transform: none;
		}
	}
</style>
