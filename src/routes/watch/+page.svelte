<script>
	import { goto } from '$app/navigation';
	import { resolve } from '$app/paths';
	import { onMount } from 'svelte';
	import { flip } from 'svelte/animate';
	import { cubicOut } from 'svelte/easing';
	import { fly } from 'svelte/transition';

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

	/** @param {string} value an option key, or 'off' */
	function pickSubtitle(value) {
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

		const onFullscreen = () => (isFullscreen = document.fullscreenElement === playerEl);
		document.addEventListener('fullscreenchange', onFullscreen);
		wake();

		return () => {
			search?.abort();
			stopPlayback();
			window.clearTimeout(idleTimer);
			document.removeEventListener('fullscreenchange', onFullscreen);
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

	/** @param {number} number */
	function pickEpisode(number) {
		openPanel = null;
		if (number === episode) return;
		episode = number;
		scrape();
	}

	// ---- floating player chrome: dock + panels, auto-hidden while watching ----
	const IDLE_DELAY = 2800;
	/** @type {'servers' | 'subtitles' | 'episodes' | null} */
	let openPanel = $state(null);
	let idle = $state(false);
	let paused = $state(true);
	let isFullscreen = $state(false);
	let dockHovered = false;
	let idleTimer = 0;
	/** @type {HTMLDivElement | undefined} */
	let playerEl = $state();
	/** @type {HTMLDivElement | undefined} */
	let dockEl = $state();

	let chromeHidden = $derived.by(
		() => idle && status === 'playing' && !paused && openPanel === null
	);

	function wake() {
		idle = false;
		window.clearTimeout(idleTimer);
		idleTimer = window.setTimeout(() => {
			if (!dockHovered) idle = true;
		}, IDLE_DELAY);
	}

	/** @param {'servers' | 'subtitles' | 'episodes'} name */
	function togglePanel(name) {
		openPanel = openPanel === name ? null : name;
		wake();
	}

	/** @param {PointerEvent} event */
	function handleWindowPointerDown(event) {
		if (openPanel && dockEl && !dockEl.contains(/** @type {Node} */ (event.target))) {
			openPanel = null;
		}
	}

	/** @param {KeyboardEvent} event */
	function handleWindowKeydown(event) {
		if (event.key === 'Escape' && openPanel) {
			openPanel = null;
			return;
		}
		wake();
	}

	// fullscreen the whole player (not just <video>) so the dock stays usable
	async function toggleFullscreen() {
		try {
			if (document.fullscreenElement) await document.exitFullscreen();
			else await playerEl?.requestFullscreen();
		} catch {
			// fullscreen can be refused (iframes, some mobile browsers); nothing to do
		}
	}

	/** @param {MouseEvent} event */
	function handleVideoDoubleClick(event) {
		event.preventDefault();
		toggleFullscreen();
	}

	/** Scrolls the selected row of a panel list into view when the panel opens. */
	function revealSelected(/** @type {HTMLElement} */ node) {
		node.querySelector('[aria-pressed="true"]')?.scrollIntoView({ block: 'center' });
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

<svelte:window onpointerdown={handleWindowPointerDown} onkeydown={handleWindowKeydown} />

<main>
	<button
		class="back"
		class:hidden={chromeHidden}
		type="button"
		aria-label="Back to browse"
		onclick={() => goto(resolve('/'))}
	>
		<span aria-hidden="true">←</span><span class="back-text" aria-hidden="true">Back to browse</span
		>
	</button>

	<div
		class="player"
		class:idle={chromeHidden}
		bind:this={playerEl}
		onpointermove={wake}
		onpointerdown={wake}
		role="presentation"
	>
		<!-- svelte-ignore a11y_media_has_caption -->
		<video
			bind:this={video}
			bind:paused
			class:revealed={status === 'playing'}
			controls
			controlslist="nofullscreen noremoteplayback"
			autoplay
			playsinline
			ondblclick={handleVideoDoubleClick}
		>
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
		{#if status !== 'missing'}
			<div
				class="dock"
				class:hidden={chromeHidden}
				bind:this={dockEl}
				onpointerenter={() => (dockHovered = true)}
				onpointerleave={() => (dockHovered = false)}
				role="group"
				aria-label="Player settings"
			>
				<div class="dock-bar">
					<button
						type="button"
						class="dock-button"
						class:open={openPanel === 'servers'}
						aria-expanded={openPanel === 'servers'}
						aria-controls="panel-servers"
						onclick={() => togglePanel('servers')}
					>
						<svg viewBox="0 0 24 24" aria-hidden="true"
							><path
								d="M4 5h16v5H4zM4 14h16v5H4zM7 7.5h.01M7 16.5h.01"
								fill="none"
								stroke="currentColor"
								stroke-width="2"
								stroke-linecap="round"
								stroke-linejoin="round"
							/></svg
						>
						<span class="dock-label">
							{active?.label ?? (searching ? 'Finding servers' : 'Servers')}
						</span>
						{#if active?.quality}<span class="dock-tag">{active.quality}</span>{/if}
						{#if searching}
							<span class="live-dot" title="Still searching">
								<span class="visually-hidden">still searching</span>
							</span>
						{:else if streams.length}
							<span class="dock-count">{streams.length}</span>
						{/if}
					</button>

					{#if subtitleOptions.length}
						<button
							type="button"
							class="dock-button"
							class:open={openPanel === 'subtitles'}
							class:on={!!selectedSubtitle}
							aria-expanded={openPanel === 'subtitles'}
							aria-controls="panel-subtitles"
							onclick={() => togglePanel('subtitles')}
						>
							<svg viewBox="0 0 24 24" aria-hidden="true"
								><rect
									x="3"
									y="5"
									width="18"
									height="14"
									rx="3"
									fill="none"
									stroke="currentColor"
									stroke-width="2"
								/><path
									d="M10.5 10.2a2.2 2.2 0 1 0 0 3.6M17 10.2a2.2 2.2 0 1 0 0 3.6"
									fill="none"
									stroke="currentColor"
									stroke-width="1.8"
									stroke-linecap="round"
								/></svg
							>
							<span class="dock-label">{selectedSubtitle?.label ?? 'Subtitles off'}</span>
						</button>
					{/if}

					{#if seasons.length}
						<button
							type="button"
							class="dock-button"
							class:open={openPanel === 'episodes'}
							aria-expanded={openPanel === 'episodes'}
							aria-controls="panel-episodes"
							onclick={() => togglePanel('episodes')}
						>
							<svg viewBox="0 0 24 24" aria-hidden="true"
								><path
									d="M4 6h16M4 12h16M4 18h10"
									fill="none"
									stroke="currentColor"
									stroke-width="2"
									stroke-linecap="round"
								/></svg
							>
							<span class="dock-label always">S{season} · E{episode}</span>
						</button>
					{/if}

					<button
						type="button"
						class="dock-button icon-only"
						aria-label={isFullscreen ? 'Exit fullscreen' : 'Fullscreen'}
						title={isFullscreen ? 'Exit fullscreen' : 'Fullscreen'}
						onclick={toggleFullscreen}
					>
						<svg viewBox="0 0 24 24" aria-hidden="true"
							><path
								d={isFullscreen
									? 'M9 4v5H4M15 4v5h5M9 20v-5H4M15 20v-5h5'
									: 'M4 9V4h5M20 9V4h-5M4 15v5h5M20 15v5h-5'}
								fill="none"
								stroke="currentColor"
								stroke-width="2"
								stroke-linecap="round"
								stroke-linejoin="round"
							/></svg
						>
					</button>
				</div>

				{#if openPanel === 'servers'}
					<section id="panel-servers" class="panel" aria-label="Servers">
						<header class="panel-head">
							<h2>Servers</h2>
							{#if searching}
								<span class="panel-note">
									<span class="live-dot" aria-hidden="true"></span>
									searching · {remaining} left
								</span>
							{/if}
						</header>
						{#if streams.length}
							<ul class="panel-list" use:revealSelected>
								{#each streams as stream (stream.url)}
									{@const isActive = stream.url === activeUrl}
									{@const isDead = deadUrls.includes(stream.url)}
									<li>
										<button
											type="button"
											class="row"
											class:selected={isActive}
											class:dead={isDead}
											class:trying={isActive && status === 'loading'}
											aria-pressed={isActive}
											onclick={() => play(stream.url)}
										>
											<span class="dot" aria-hidden="true"></span>
											<span class="row-label">{stream.label}</span>
											{#if preferenceRank(stream) === 0}
												<span class="last-used">last used</span>
											{/if}
											{#if stream.quality}<span class="row-meta">{stream.quality}</span>{/if}
											<span class="row-state">
												{#if isActive && status === 'playing'}Playing
												{:else if isActive && status === 'loading'}Loading
												{:else if isDead}Failed{/if}
											</span>
										</button>
									</li>
								{/each}
							</ul>
						{:else}
							<p class="panel-empty">
								{searching ? 'Looking for servers…' : 'No servers found for this title.'}
							</p>
						{/if}
						<footer class="panel-foot">
							<button type="button" class="ghost" onclick={scrape}>Search again</button>
						</footer>
					</section>
				{:else if openPanel === 'subtitles'}
					<section id="panel-subtitles" class="panel" aria-label="Subtitles">
						<header class="panel-head"><h2>Subtitles</h2></header>
						<div class="panel-list" use:revealSelected>
							<button
								type="button"
								class="row"
								class:selected={!selectedSubtitle}
								aria-pressed={!selectedSubtitle}
								onclick={() => pickSubtitle('off')}
							>
								<span class="row-label">Off</span>
							</button>
							{#if streamSubtitles.length}
								<p class="panel-group">From this server</p>
								{#each streamSubtitles as option (option.key)}
									<button
										type="button"
										class="row"
										class:selected={selectedSubtitle?.key === option.key}
										aria-pressed={selectedSubtitle?.key === option.key}
										onclick={() => pickSubtitle(option.key)}
									>
										<span class="row-label">{option.label}</span>
									</button>
								{/each}
							{/if}
							{#each titleSubtitleGroups as [name, options] (name)}
								<p class="panel-group">{name}</p>
								{#each options as option (option.key)}
									<button
										type="button"
										class="row"
										class:selected={selectedSubtitle?.key === option.key}
										aria-pressed={selectedSubtitle?.key === option.key}
										onclick={() => pickSubtitle(option.key)}
									>
										<span class="row-label">{option.label}</span>
									</button>
								{/each}
							{/each}
						</div>
						{#if selectedSubtitle?.kind === 'file'}
							<footer class="panel-foot timing" role="group" aria-label="Subtitle timing">
								<span>Timing</span>
								<button
									type="button"
									class="step"
									onclick={() => nudgeSubtitles(-0.5)}
									aria-label="Subtitles earlier">−</button
								>
								<output>{subtitleOffset > 0 ? '+' : ''}{subtitleOffset.toFixed(1)}s</output>
								<button
									type="button"
									class="step"
									onclick={() => nudgeSubtitles(0.5)}
									aria-label="Subtitles later">+</button
								>
							</footer>
						{/if}
					</section>
				{:else if openPanel === 'episodes'}
					<section id="panel-episodes" class="panel" aria-label="Episodes">
						<header class="panel-head">
							<h2>Episodes</h2>
							<select aria-label="Season" value={season} onchange={handleSeasonChange}>
								{#each seasons as item (item.number)}
									<option value={item.number}>{item.name}</option>
								{/each}
							</select>
						</header>
						<ol class="panel-list" use:revealSelected>
							{#each episodes as item (item.number)}
								<li>
									<button
										type="button"
										class="row"
										class:selected={item.number === episode}
										aria-pressed={item.number === episode}
										onclick={() => pickEpisode(item.number)}
									>
										<span class="row-num">{item.number}</span>
										<span class="row-label">{item.name}</span>
									</button>
								</li>
							{/each}
						</ol>
					</section>
				{/if}
			</div>
		{/if}
	</div>
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
		position: relative;
		height: 100svh;
		overflow: hidden;
	}

	.back {
		position: fixed;
		z-index: 30;
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
			opacity 320ms ease,
			transform 220ms var(--ease);
		animation: rise 0.6s var(--ease) 0.15s backwards;
	}

	.back:hover {
		background: var(--raised);
		transform: translateX(-2px);
	}

	/* keyboard focus: soft glow, no hard outline */
	.back:focus-visible,
	.cta:focus-visible {
		outline: none;
		box-shadow: var(--focus-ring);
	}

	.player {
		position: relative;
		width: 100%;
		height: 100%;
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

	/* ---------- floating dock + panels ---------- */

	video::cue {
		background: rgb(0 0 0 / 0.6);
		font-family: Inter, ui-sans-serif, system-ui, sans-serif;
	}

	.player.idle {
		cursor: none;
	}

	.dock {
		position: absolute;
		z-index: 20;
		top: max(1.25rem, env(safe-area-inset-top));
		left: max(1.25rem, env(safe-area-inset-left));
		display: grid;
		justify-items: start;
		gap: 0.55rem;
		max-width: calc(100% - 2.5rem);
		transition:
			opacity 320ms ease,
			transform 420ms var(--ease);
	}

	.dock.hidden,
	.back.hidden {
		opacity: 0;
		pointer-events: none;
		transform: translateY(-6px);
	}

	.dock-bar {
		display: flex;
		flex-wrap: wrap;
		align-items: center;
		gap: 0.3rem;
		padding: 0.3rem;
		border-radius: 999px;
		background: oklch(0.16 0.005 80 / 0.72);
		box-shadow:
			0 0.75rem 2rem oklch(0 0 0 / 0.4),
			inset 0 0 0 1px oklch(0.97 0.008 95 / 0.07);
		backdrop-filter: blur(16px) saturate(1.2);
	}

	.dock-button {
		display: inline-flex;
		align-items: center;
		gap: 0.45rem;
		max-width: 15rem;
		padding: 0.5rem 0.8rem;
		border: 0;
		border-radius: 999px;
		background: transparent;
		color: var(--muted);
		font: inherit;
		font-size: 0.74rem;
		font-weight: 650;
		white-space: nowrap;
		cursor: pointer;
		transition:
			background-color 160ms ease,
			color 160ms ease;
	}

	.dock-button.icon-only {
		padding: 0.5rem;
	}

	.dock-button svg {
		flex: none;
		width: 1rem;
		height: 1rem;
	}

	.dock-button:hover,
	.dock-button.open {
		background: oklch(0.97 0.008 95 / 0.09);
		color: var(--fg);
	}

	.dock-button.on svg {
		color: var(--gold);
	}

	.dock-button:focus-visible,
	.row:focus-visible,
	.ghost:focus-visible,
	.step:focus-visible,
	.panel-head select:focus-visible {
		outline: none;
		box-shadow: var(--focus-ring);
	}

	.dock-label {
		overflow: hidden;
		text-overflow: ellipsis;
	}

	.dock-tag,
	.dock-count {
		padding: 0.1rem 0.4rem;
		border-radius: 999px;
		background: oklch(0.97 0.008 95 / 0.08);
		color: var(--dim);
		font-size: 0.62rem;
		font-variant-numeric: tabular-nums;
	}

	.live-dot {
		position: relative;
		flex: none;
		width: 0.42rem;
		height: 0.42rem;
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

	.panel {
		display: flex;
		flex-direction: column;
		width: min(22rem, calc(100vw - 2.5rem));
		max-height: min(32rem, calc(100svh - 7rem));
		overflow: hidden;
		border-radius: 1.1rem;
		background: oklch(0.16 0.005 80 / 0.86);
		box-shadow:
			0 1.25rem 3rem oklch(0 0 0 / 0.5),
			inset 0 0 0 1px oklch(0.97 0.008 95 / 0.07);
		backdrop-filter: blur(20px) saturate(1.2);
		transform-origin: top left;
		animation: panel-in 220ms var(--ease);
	}

	.panel-head {
		display: flex;
		align-items: center;
		justify-content: space-between;
		gap: 0.75rem;
		padding: 0.9rem 1rem 0.6rem;
	}

	.panel-head h2 {
		margin: 0;
		color: var(--gold);
		font-size: 0.62rem;
		font-weight: 800;
		letter-spacing: 0.18em;
		text-transform: uppercase;
	}

	.panel-head select {
		max-width: 11rem;
		padding: 0.4rem 0.7rem;
		border: 0;
		border-radius: 999px;
		background: oklch(0.97 0.008 95 / 0.08);
		color: var(--fg);
		font: inherit;
		font-size: 0.72rem;
		font-weight: 600;
		cursor: pointer;
	}

	.panel-note {
		display: inline-flex;
		align-items: center;
		gap: 0.45rem;
		color: var(--dim);
		font-size: 0.66rem;
		font-variant-numeric: tabular-nums;
	}

	.panel-list {
		display: grid;
		gap: 0.1rem;
		margin: 0;
		padding: 0 0.4rem 0.5rem;
		overflow-y: auto;
		overscroll-behavior: contain;
		list-style: none;
		scrollbar-width: thin;
	}

	.panel-group {
		margin: 0.7rem 0.6rem 0.25rem;
		color: var(--dim);
		font-size: 0.6rem;
		font-weight: 800;
		letter-spacing: 0.14em;
		text-transform: uppercase;
	}

	.panel-empty {
		margin: 0;
		padding: 0.5rem 1rem 1rem;
		color: var(--muted);
		font-size: 0.78rem;
	}

	.row {
		display: flex;
		align-items: center;
		gap: 0.6rem;
		width: 100%;
		padding: 0.6rem 0.65rem;
		border: 0;
		border-radius: 0.7rem;
		background: transparent;
		color: var(--muted);
		font: inherit;
		font-size: 0.78rem;
		font-weight: 600;
		text-align: left;
		cursor: pointer;
		transition:
			background-color 140ms ease,
			color 140ms ease;
	}

	.row:hover {
		background: oklch(0.97 0.008 95 / 0.07);
		color: var(--fg);
	}

	.row.selected {
		background: var(--gold-soft);
		color: var(--fg);
	}

	.row.trying {
		animation: glow 1.2s ease-in-out infinite;
	}

	.row.dead {
		color: var(--dim);
	}

	.row.dead .row-label {
		text-decoration: line-through;
	}

	.row-label {
		flex: 1;
		min-width: 0;
		overflow: hidden;
		text-overflow: ellipsis;
		white-space: nowrap;
	}

	.row-meta,
	.row-state,
	.row-num {
		color: var(--dim);
		font-size: 0.66rem;
		font-variant-numeric: tabular-nums;
	}

	.row-num {
		min-width: 1.6rem;
	}

	.row.selected .row-state,
	.row.selected .row-num {
		color: var(--gold);
	}

	.row .dot {
		flex: none;
		width: 0.45rem;
		height: 0.45rem;
		border-radius: 50%;
		background: var(--green);
	}

	.row.dead .dot {
		background: var(--red);
	}

	.row.trying .dot {
		background: var(--gold);
	}

	.last-used {
		padding: 0.05rem 0.4rem;
		border-radius: 999px;
		background: var(--gold-soft);
		color: var(--gold);
		font-size: 0.56rem;
		font-weight: 750;
		letter-spacing: 0.04em;
		text-transform: uppercase;
	}

	.panel-foot {
		display: flex;
		align-items: center;
		justify-content: flex-end;
		gap: 0.35rem;
		padding: 0.55rem 0.75rem 0.75rem;
		border-top: 1px solid oklch(0.97 0.008 95 / 0.06);
	}

	.panel-foot.timing {
		justify-content: space-between;
		color: var(--dim);
		font-size: 0.7rem;
	}

	.panel-foot.timing span {
		margin-right: auto;
		font-weight: 700;
		letter-spacing: 0.06em;
		text-transform: uppercase;
	}

	.panel-foot output {
		min-width: 3.4em;
		color: var(--fg);
		font-variant-numeric: tabular-nums;
		text-align: center;
	}

	.ghost,
	.step {
		border: 0;
		background: oklch(0.97 0.008 95 / 0.08);
		color: var(--fg);
		font: inherit;
		cursor: pointer;
		transition: background-color 140ms ease;
	}

	.ghost {
		padding: 0.45rem 0.9rem;
		border-radius: 999px;
		font-size: 0.72rem;
		font-weight: 650;
	}

	.step {
		width: 1.9rem;
		height: 1.9rem;
		border-radius: 50%;
		font-size: 0.95rem;
	}

	.ghost:hover,
	.step:hover {
		background: oklch(0.97 0.008 95 / 0.14);
	}

	.back-text {
		margin-left: 0.4em;
	}

	/* phones: icons only, except the episode marker */
	@media (max-width: 560px) {
		.back {
			top: max(1.25rem, env(safe-area-inset-top));
			right: max(1.25rem, env(safe-area-inset-right));
			padding: 0.7rem 0.85rem;
		}

		.back-text {
			display: none;
		}

		.dock-button .dock-label:not(.always),
		.dock-tag {
			display: none;
		}

		.dock-button {
			padding: 0.5rem 0.6rem;
		}
	}

	/* ---------- keyframes ---------- */

	@keyframes rise {
		from {
			opacity: 0;
			transform: translateY(12px);
		}
	}

	@keyframes panel-in {
		from {
			opacity: 0;
			transform: translateY(-6px) scale(0.97);
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
