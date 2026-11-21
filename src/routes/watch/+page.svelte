<script>
	import { goto } from '$app/navigation';
	import { resolve } from '$app/paths';
	import { categoryLabels } from '$lib/sources';
	import { onMount } from 'svelte';

	const EMBED_TIMEOUT = 8000;

	let selectedId = $state('');
	/** @type {'movies' | 'shows'} */
	let selectedType = $state('movies');
	let proxyEndpoint = '';

	/** @type {Array<{ id: string, label: string, url: string, ok: boolean, status: number, latency: number }>} */
	let probed = $state([]);
	/** @type {'movies' | 'shows' | 'anime'} */
	let category = $state('movies');
	/** @type {string[]} */
	let failedIds = $state([]);
	let activeId = $state('');

	/** @type {'checking' | 'ready' | 'empty' | 'error' | 'missing' | 'disabled'} */
	let status = $state('checking');

	/** @type {Array<{ number: number, name: string, episodeCount: number }>} */
	let seasons = $state([]);
	/** @type {Array<{ number: number, name: string, airDate: string }>} */
	let episodes = $state([]);
	let season = $state(1);
	let episode = $state(1);

	let available = $derived(probed.filter((source) => source.ok && !failedIds.includes(source.id)));
	let active = $derived(available.find((source) => source.id === activeId) ?? null);

	let embedLoaded = $state(false);
	let embedTimer = 0;

	onMount(() => {
		selectedId = localStorage.getItem('selectedMediaId') ?? '';
		selectedType = localStorage.getItem('selectedMediaType') === 'shows' ? 'shows' : 'movies';
		proxyEndpoint = localStorage.getItem('proxyEndpoint') ?? '';

		if (!selectedId) {
			status = 'missing';
		} else if (selectedType === 'shows') {
			startShow();
		} else {
			checkSources();
		}

		return () => window.clearTimeout(embedTimer);
	});

	async function startShow() {
		await loadEpisodes();
		episode = episodes[0]?.number ?? 1;
		checkSources();
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
		checkSources();
	}

	/** @param {Event} event */
	function handleEpisodeChange(event) {
		episode = Number(/** @type {HTMLSelectElement} */ (event.currentTarget).value);
		checkSources();
	}

	async function checkSources() {
		status = 'checking';
		failedIds = [];
		activeId = '';

		try {
			const params = new URLSearchParams({ id: selectedId, type: selectedType });
			if (selectedType === 'shows') {
				params.set('season', String(season));
				params.set('episode', String(episode));
			}
			if (proxyEndpoint) params.set('proxy', proxyEndpoint);

			const response = await fetch(`${resolve('/api/sources')}?${params}`);

			if (!response.ok) throw new Error('Source check failed');

			const payload = await response.json();
			category = payload.category ?? selectedType;
			probed = payload.sources ?? [];
			if (payload.disabled) {
				status = 'disabled';
				return;
			}
			playBest();
		} catch {
			probed = [];
			status = 'error';
		}
	}

	function playBest() {
		const next = available[0];

		if (!next) {
			activeId = '';
			status = 'empty';
			return;
		}

		play(next.id);
	}

	/** @param {string} id */
	function play(id) {
		window.clearTimeout(embedTimer);
		activeId = id;
		status = 'ready';
		embedLoaded = false;

		embedTimer = window.setTimeout(() => {
			if (!embedLoaded) dropSource(id);
		}, EMBED_TIMEOUT);
	}

	/** @param {string} id */
	function dropSource(id) {
		if (!id || failedIds.includes(id)) return;

		window.clearTimeout(embedTimer);
		failedIds = [...failedIds, id];
		playBest();
	}

	function handleEmbedLoad() {
		embedLoaded = true;
		window.clearTimeout(embedTimer);
	}
</script>

<svelte:head>
	<title>Pyrite — Watch</title>
</svelte:head>

<main>
	<button class="back" type="button" onclick={() => goto(resolve('/'))}>← Back to browse</button>

	<div class="player">
		{#if active}
			{#key active.id}
				<iframe
					src={active.url}
					title={`${active.label} player`}
					frameborder="0"
					allow="autoplay; encrypted-media; fullscreen"
					allowfullscreen
					onload={handleEmbedLoad}
					onerror={() => dropSource(active.id)}
				></iframe>
			{/key}
		{/if}

		{#if status !== 'ready' || !embedLoaded}
			<div class="overlay" aria-live="polite">
				{#if status === 'checking'}
					<p>Checking sources…</p>
				{:else if status === 'ready'}
					<p>Loading {active?.label}…</p>
				{:else if status === 'missing'}
					<p>No title selected.</p>
					<button type="button" onclick={() => goto(resolve('/'))}>Browse titles</button>
				{:else if status === 'error'}
					<p>Could not reach the source check.</p>
					<button type="button" onclick={checkSources}>Try again</button>
				{:else if status === 'disabled'}
						<p class="error">All sources are disabled.</p>
					{:else}
					<p>No working source for this title right now.</p>
					<button type="button" onclick={checkSources}>Check again</button>
				{/if}
			</div>
		{/if}
	</div>

	{#if seasons.length}
		<nav class="episodes" aria-label="Season and episode">
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
		</nav>
	{/if}

	{#if available.length}
		<nav class="sources" aria-label={categoryLabels[category]}>
			<p class="sources-label">{categoryLabels[category]}</p>
			{#each available as source (source.id)}
				<button
					type="button"
					class:active={source.id === activeId}
					onclick={() => play(source.id)}
				>
					<span class="dot" aria-hidden="true"></span>
					{source.label}
				</button>
			{/each}
		</nav>
	{/if}
</main>

<style>
	:global(body) {
		margin: 0;
		background: #090909;
		color: #f7f5ef;
		font-family: Inter, ui-sans-serif, system-ui, sans-serif;
	}

	main {
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
		background: #181818;
		color: #fff;
		font: inherit;
		font-size: 0.78rem;
		cursor: pointer;
	}

	.back:hover {
		background: #242424;
	}

	.back:focus-visible,
	.overlay button:focus-visible,
	.sources button:focus-visible {
		outline: 2px solid #efb33d;
		outline-offset: 2px;
	}

	.player {
		position: relative;
		width: 100%;
		height: 100%;
		background: #000;
	}

	iframe {
		display: block;
		width: 100%;
		height: 100%;
		border: 0;
	}

	.overlay {
		position: absolute;
		inset: 0;
		display: grid;
		align-content: center;
		justify-items: center;
		gap: 1rem;
		background: #090909;
		text-align: center;
	}

	.overlay p {
		margin: 0;
		color: rgba(255, 255, 255, 0.68);
		font-size: 0.85rem;
		letter-spacing: 0.02em;
	}

	.overlay p.error {
		color: #ff6b6b;
	}

	.overlay button {
		padding: 0.7rem 1.2rem;
		border: 0;
		border-radius: 999px;
		background: #efb33d;
		color: #0a0a0a;
		font: inherit;
		font-size: 0.75rem;
		font-weight: 750;
		cursor: pointer;
	}

	.episodes {
		display: flex;
		flex-wrap: wrap;
		justify-content: center;
		gap: 0.6rem;
		padding: 1rem 1rem 0;
		background: #090909;
	}

	.episodes label {
		display: flex;
		align-items: center;
		gap: 0.55rem;
		min-width: 0;
		color: rgba(255, 255, 255, 0.4);
		font-size: 0.62rem;
		font-weight: 800;
		letter-spacing: 0.16em;
		text-transform: uppercase;
	}

	.episodes select {
		max-width: 16rem;
		padding: 0.55rem 0.9rem;
		border: 1px solid rgba(255, 255, 255, 0.1);
		border-radius: 999px;
		background: #181818;
		color: rgba(255, 255, 255, 0.86);
		font: inherit;
		font-size: 0.74rem;
		font-weight: 600;
		text-overflow: ellipsis;
		cursor: pointer;
	}

	.episodes select:focus-visible {
		outline: 2px solid #efb33d;
		outline-offset: 2px;
	}

	.sources {
		display: flex;
		flex-wrap: wrap;
		align-items: center;
		justify-content: center;
		gap: 0.4rem;
		padding: 1rem 1rem max(1rem, env(safe-area-inset-bottom));
		background: #090909;
	}

	.sources-label {
		width: 100%;
		margin: 0 0 0.35rem;
		color: #efb33d;
		font-size: 0.62rem;
		font-weight: 800;
		letter-spacing: 0.18em;
		text-align: center;
		text-transform: uppercase;
	}

	.sources button {
		display: flex;
		align-items: center;
		gap: 0.5rem;
		padding: 0.6rem 1rem;
		border: 0;
		border-radius: 999px;
		background: #181818;
		color: rgba(255, 255, 255, 0.72);
		font: inherit;
		font-size: 0.74rem;
		font-weight: 650;
		cursor: pointer;
	}

	.sources button.active {
		background: #efb33d;
		color: #0a0a0a;
	}

	.dot {
		width: 0.42rem;
		height: 0.42rem;
		border-radius: 50%;
		background: #5ad07a;
	}

	.sources button.active .dot {
		background: #0a0a0a;
	}

</style>
