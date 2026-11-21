<script>
	import { goto, invalidateAll } from '$app/navigation';
	import { base, resolve } from '$app/paths';
	import logo from '$lib/assets/pyrite.png';
	import { cubicIn, quintOut } from 'svelte/easing';

	const MEDIA_COOKIE_MAX_AGE = 60 * 60 * 24 * 365;

	/** @type {import('./$types').PageProps} */
	let { data } = $props();

	let hero = $derived(data.popular?.[0]);
	let isShows = $derived(data.mediaType === 'shows');

	/** @type {'movies' | 'shows' | null} */
	let pendingType = $state(null);
	let switching = $derived(pendingType !== null);
	let toggleType = $derived(pendingType ?? data.mediaType);
	let sections = $derived([
		{
			id: 'popular',
			label: 'Audience favorites',
			title: 'Popular',
			movies: data.popular
		},
		{
			id: 'top-rated',
			label: 'Critically loved',
			title: 'Top rated',
			movies: data.topRated
		},
		{
			id: 'discover',
			label: 'Something different',
			title: 'Discovery',
			movies: data.discover
		},
		{
			id: 'all-titles',
			label: 'The full collection',
			title: isShows ? 'All shows' : 'All movies',
			movies: data.allTitles
		}
	]);

	let searchQuery = $state('');
	let searchOpen = $state(false);
	let searchLoading = $state(false);
	let searchError = $state('');
	/** @type {Array<{ id: number, title: string, releaseDate: string, posterPath: string | null, voteAverage: number }>} */
	let searchResults = $state([]);
	let searchTimer = 0;
	/** @type {AbortController | undefined} */
	let searchController;

	function resetSearch() {
		window.clearTimeout(searchTimer);
		searchController?.abort();
		searchQuery = '';
		searchResults = [];
		searchError = '';
		searchLoading = false;
		searchOpen = false;
	}

	/** @param {string} [query] */
	async function runSearch(query = searchQuery.trim()) {
		if (query.length < 2) {
			searchResults = [];
			searchLoading = false;
			return;
		}

		searchController?.abort();
		const controller = new AbortController();
		searchController = controller;
		searchLoading = true;
		searchError = '';

		try {
			const response = await fetch(
				`${resolve('/api/search')}?q=${encodeURIComponent(query)}&type=${data.mediaType}`,
				{ signal: controller.signal }
			);

			if (!response.ok) throw new Error('Search request failed');

			const payload = await response.json();
			if (searchController === controller) {
				searchResults = payload.results ?? [];
			}
		} catch (error) {
			if (error instanceof DOMException && error.name === 'AbortError') return;

			if (searchController === controller) {
				searchError = 'Could not load results. Try again.';
				searchResults = [];
			}
		} finally {
			if (searchController === controller) {
				searchLoading = false;
			}
		}
	}

	/** @param {Event} event */
	function handleSearchInput(event) {
		const input = /** @type {HTMLInputElement} */ (event.currentTarget);
		searchQuery = input.value;
		searchOpen = true;
		searchError = '';
		window.clearTimeout(searchTimer);

		const query = searchQuery.trim();
		if (query.length < 2) {
			searchController?.abort();
			searchResults = [];
			searchLoading = false;
			return;
		}

		searchTimer = window.setTimeout(() => runSearch(query), 250);
	}

	/** @param {SubmitEvent} event */
	function handleSearchSubmit(event) {
		event.preventDefault();
		window.clearTimeout(searchTimer);
		searchOpen = true;
		runSearch();
	}

	/** @param {KeyboardEvent} event */
	function handleSearchKeydown(event) {
		if (event.key !== 'Escape') return;

		searchOpen = false;
		/** @type {HTMLInputElement} */ (event.currentTarget).blur();
	}

	const IMG = 'https://image.tmdb.org/t/p';

	/**
	 * Opens the watch page. The clicked image gets a view-transition-name so it morphs
	 * into the poster (or backdrop) slot on the watch page; we pass its exact URL along
	 * so the browser already has it cached when the morph runs.
	 *
	 * @param {{ id: number, title: string, release_date?: string, releaseDate?: string, poster_path?: string | null, posterPath?: string | null, backdrop_path?: string | null }} item
	 * @param {HTMLImageElement | null | undefined} [image]
	 * @param {'poster' | 'backdrop'} [morph]
	 */
	function openWatch(item, image, morph = 'poster') {
		const posterPath = item.poster_path ?? item.posterPath ?? null;
		const backdropPath = item.backdrop_path ?? null;
		const clickedUrl = image?.currentSrc || image?.src || null;

		const selection = {
			id: item.id,
			type: data.mediaType,
			title: item.title,
			year: (item.release_date ?? item.releaseDate ?? '').slice(0, 4),
			posterUrl:
				morph === 'poster' && clickedUrl
					? clickedUrl
					: posterPath
						? `${IMG}/w500${posterPath}`
						: null,
			backdropUrl:
				morph === 'backdrop' && clickedUrl
					? clickedUrl
					: backdropPath
						? `${IMG}/w1280${backdropPath}`
						: null
		};

		if (image) image.style.viewTransitionName = `opening-${morph}`;

		localStorage.setItem('selectedMediaId', String(item.id));
		localStorage.setItem('selectedMediaType', data.mediaType);
		localStorage.setItem('selectedMedia', JSON.stringify(selection));
		goto(resolve('/watch'));
	}

	/** @param {MouseEvent} event */
	const imageIn = (event) =>
		/** @type {HTMLElement} */ (event.currentTarget).querySelector('img') ?? undefined;

	/** @type {HTMLImageElement | undefined} */
	let heroCover = $state();

	// direction of the Movies ↔ Shows slide: shows sit to the right of movies
	let direction = $derived(data.mediaType === 'shows' ? 1 : -1);

	/**
	 * @param {HTMLElement} node
	 * @param {{ dir: number }} params
	 */
	function catalogOut(node, { dir }) {
		if (reduceMotion) return { duration: 0 };
		const from = Number(getComputedStyle(node).opacity) || 1;
		node.style.pointerEvents = 'none';
		node.style.zIndex = '0';
		return {
			duration: 280,
			easing: cubicIn,
			css: (/** @type {number} */ t, /** @type {number} */ u) =>
				`opacity:${t * from};transform:translateX(${-dir * 56 * u}px) scale(${1 - 0.02 * u});filter:blur(${4 * u}px)`
		};
	}

	/**
	 * @param {HTMLElement} node
	 * @param {{ dir: number }} params
	 */
	function catalogIn(node, { dir }) {
		if (reduceMotion) return { duration: 0 };
		return {
			delay: 90,
			duration: 560,
			easing: quintOut,
			css: (/** @type {number} */ t, /** @type {number} */ u) =>
				`opacity:${t};transform:translateX(${dir * 72 * u}px)`
		};
	}

	let reduceMotion = $state(false);
	$effect(() => {
		reduceMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
	});

	/** @param {'movies' | 'shows'} mediaType */
	async function changeMedia(mediaType) {
		if (switching || data.mediaType === mediaType) return;

		resetSearch();
		pendingType = mediaType;
		document.cookie = `mediaType=${mediaType}; path=${base || '/'}; max-age=${MEDIA_COOKIE_MAX_AGE}; samesite=lax`;

		try {
			await invalidateAll();
			// jump, don't smooth-scroll: the old catalog is already sliding away
			window.scrollTo({ top: 0, behavior: 'instant' });
		} finally {
			pendingType = null;
		}
	}

	/** @param {HTMLElement} node */
	function draggable(node) {
		let dragging = false;
		let startX = 0;
		let startScroll = 0;
		let moved = false;

		/** @param {PointerEvent} event */
		function pointerDown(event) {
			if (event.pointerType === 'mouse' && event.button !== 0) return;

			dragging = true;
			moved = false;
			startX = event.clientX;
			startScroll = node.scrollLeft;
		}

		/** @param {PointerEvent} event */
		function pointerMove(event) {
			if (!dragging) return;

			const distance = event.clientX - startX;
			if (!moved && Math.abs(distance) <= 4) return;

			if (!moved) {
				moved = true;
				node.setPointerCapture(event.pointerId);
				node.classList.add('dragging');
			}

			node.scrollLeft = startScroll - distance;
		}

		/** @param {PointerEvent} event */
		function pointerUp(event) {
			if (!dragging) return;

			dragging = false;
			if (node.hasPointerCapture(event.pointerId)) {
				node.releasePointerCapture(event.pointerId);
			}
			node.classList.remove('dragging');
			window.setTimeout(() => {
				moved = false;
			});
		}

		function pointerLeave() {
			if (dragging && !moved) dragging = false;
		}

		function pointerCancel() {
			dragging = false;
			moved = false;
			node.classList.remove('dragging');
		}

		/** @param {MouseEvent} event */
		function stopDraggedClick(event) {
			if (!moved) return;
			event.preventDefault();
			event.stopPropagation();
			moved = false;
		}

		node.addEventListener('pointerdown', pointerDown);
		node.addEventListener('pointermove', pointerMove);
		node.addEventListener('pointerup', pointerUp);
		node.addEventListener('pointerleave', pointerLeave);
		node.addEventListener('pointercancel', pointerCancel);
		node.addEventListener('click', stopDraggedClick, true);

		return {
			destroy() {
				node.removeEventListener('pointerdown', pointerDown);
				node.removeEventListener('pointermove', pointerMove);
				node.removeEventListener('pointerup', pointerUp);
				node.removeEventListener('pointerleave', pointerLeave);
				node.removeEventListener('pointercancel', pointerCancel);
				node.removeEventListener('click', stopDraggedClick, true);
			}
		};
	}
</script>

<svelte:head>
	<title>Pyrite — Find your next {isShows ? 'show' : 'movie'}</title>
	<meta
		name="description"
		content={`Browse popular, top-rated, and newly discovered ${isShows ? 'shows' : 'movies'}.`}
	/>
</svelte:head>

<header class="brand">
	<img src={logo} alt="" />
	<span>PYRITE</span>
</header>

<div class="search-shell">
	<form class="search-form" role="search" onsubmit={handleSearchSubmit}>
		<label class="sr-only" for="catalog-search">Search {isShows ? 'shows' : 'movies'}</label>
		<input
			id="catalog-search"
			type="search"
			placeholder={`Search ${isShows ? 'shows' : 'movies'}`}
			autocomplete="off"
			value={searchQuery}
			aria-controls="search-results"
			oninput={handleSearchInput}
			onfocus={() => (searchOpen = true)}
			onkeydown={handleSearchKeydown}
		/>
		<button type="submit" aria-label={`Search ${isShows ? 'shows' : 'movies'}`}>
			<span class="search-icon" aria-hidden="true"></span>
		</button>
	</form>

	{#if searchOpen && searchQuery.trim().length >= 2}
		<section
			id="search-results"
			class="search-results"
			aria-label={`${isShows ? 'Show' : 'Movie'} search results`}
			aria-live="polite"
		>
			{#if searchLoading}
				<p class="search-status">Searching…</p>
			{:else if searchError}
				<p class="search-status error">{searchError}</p>
			{:else if searchResults.length}
				<div class="search-result-list">
					{#each searchResults as result (result.id)}
						<button
							type="button"
							class="search-result"
							onclick={(event) => openWatch(result, imageIn(event))}
						>
							{#if result.posterPath}
								<img
									src={`https://image.tmdb.org/t/p/w185${result.posterPath}`}
									alt=""
									loading="lazy"
								/>
							{:else}
								<div class="result-placeholder" aria-hidden="true">
									{result.title.slice(0, 1)}
								</div>
							{/if}
							<div>
								<h3>{result.title}</h3>
								<p>
									{result.releaseDate.slice(0, 4) || 'Date unavailable'} · ★
									{result.voteAverage.toFixed(1)}
								</p>
							</div>
						</button>
					{/each}
				</div>
			{:else}
				<p class="search-status">No results found.</p>
			{/if}
		</section>
	{/if}
</div>

<div class="stack">
	{#key data.mediaType}
		<div
			class="content"
			class:switching
			in:catalogIn={{ dir: direction }}
			out:catalogOut={{ dir: direction }}
		>
			{#if hero}
				<section class="hero" aria-labelledby="hero-title">
					<img
						bind:this={heroCover}
						class="hero-cover"
						src={`https://image.tmdb.org/t/p/original${hero.backdrop_path}`}
						alt={`Backdrop for ${hero.title}`}
					/>

					<button
						type="button"
						class="hero-action"
						onclick={() => openWatch(hero, heroCover, 'backdrop')}
						aria-label={`Watch ${hero.title}`}
					></button>

					<div class="hero-copy">
						<p>Featured</p>
						<h1 id="hero-title">{hero.title}</h1>
						<span>{hero.release_date?.slice(0, 4)} · ★ {hero.vote_average?.toFixed(1)}</span>
					</div>

					<div class="play-overlay" aria-hidden="true">
						<span class="play-button"><span></span></span>
					</div>
				</section>
			{/if}

			<div class="catalog">
				{#each sections as section (section.id)}
					<section class="movie-section" aria-labelledby={`${section.id}-title`}>
						<header class="section-heading">
							<div>
								<p>{section.label}</p>
								<h2 id={`${section.id}-title`}>{section.title}</h2>
							</div>
						</header>

						{#if section.id === 'all-titles'}
							<div
								class="all-movies-scroll"
								role="region"
								aria-label={`Scrollable collection of all ${isShows ? 'shows' : 'movies'}`}
							>
								<div class="all-movies-grid">
									{#each section.movies as movie, index (movie.id)}
										<button
											type="button"
											class="movie-card"
											style:--i={index}
											onclick={(event) => openWatch(movie, imageIn(event))}
										>
											<div class="poster">
												<img
													src={`https://image.tmdb.org/t/p/w500${movie.poster_path}`}
													alt={`Poster for ${movie.title}`}
													loading="lazy"
													draggable="false"
												/>
												<div class="card-play" aria-hidden="true">
													<span><i></i></span>
												</div>
											</div>
											<h3>{movie.title}</h3>
										</button>
									{/each}
								</div>
							</div>
						{:else}
							<div
								class="carousel"
								use:draggable
								role="region"
								aria-label={`${section.title} ${isShows ? 'shows' : 'movies'}`}
							>
								{#each section.movies as movie, index (movie.id)}
									<button
										type="button"
										class="movie-card"
										style:--i={index}
										onclick={(event) => openWatch(movie, imageIn(event))}
									>
										<div class="poster">
											<img
												src={`https://image.tmdb.org/t/p/w500${movie.poster_path}`}
												alt={`Poster for ${movie.title}`}
												loading="lazy"
												draggable="false"
											/>
											<div class="card-play" aria-hidden="true">
												<span><i></i></span>
											</div>
										</div>
										<h3>{movie.title}</h3>
									</button>
								{/each}
							</div>
						{/if}
					</section>
				{/each}
			</div>
		</div>
	{/key}
</div>

<nav
	class="media-toggle"
	class:shows={toggleType === 'shows'}
	class:switching
	aria-label="Choose what to browse"
	aria-busy={switching}
>
	<span class="thumb" aria-hidden="true"></span>
	<button
		type="button"
		class:active={toggleType === 'movies'}
		aria-pressed={toggleType === 'movies'}
		disabled={switching}
		onclick={() => changeMedia('movies')}>Movies</button
	>
	<button
		type="button"
		class:active={toggleType === 'shows'}
		aria-pressed={toggleType === 'shows'}
		disabled={switching}
		onclick={() => changeMedia('shows')}>Shows</button
	>
</nav>

<style>
	:global(*) {
		box-sizing: border-box;
	}

	/* palette in OKLCH: perceptually even lightness, warm-neutral greys tinted toward the gold */
	:global(:root) {
		--bg: oklch(0.14 0.004 80);
		--surface: oklch(0.19 0.005 80 / 0.82);
		--surface-solid: oklch(0.19 0.005 80);
		--raised: oklch(0.23 0.006 80);
		--poster-bg: oklch(0.21 0.005 80);
		--fg: oklch(0.97 0.008 95);
		--muted: oklch(0.97 0.008 95 / 0.56);
		--dim: oklch(0.97 0.008 95 / 0.38);
		--hairline: oklch(0.97 0.008 95 / 0.06);
		--accent: oklch(0.8 0.15 78);
		--accent-soft: oklch(0.8 0.15 78 / 0.16);
		--on-accent: oklch(0.16 0.01 78);
		--green: oklch(0.77 0.16 150);
		--red: oklch(0.71 0.17 22);
		--shadow: oklch(0 0 0 / 0.4);
		--focus-ring: 0 0 0 3px oklch(0.8 0.15 78 / 0.38);
		--gutter: clamp(1.25rem, 4vw, 4.5rem);
		--radius: 0.7rem;
		--radius-lg: 1.1rem;
		--ease: cubic-bezier(0.16, 1, 0.3, 1);
		--spring: cubic-bezier(0.34, 1.4, 0.64, 1);
	}

	:global(html) {
		background: var(--bg);
		scroll-behavior: smooth;
	}

	:global(body) {
		margin: 0;
		background: var(--bg);
		color: var(--fg);
		font-family:
			Inter,
			ui-sans-serif,
			system-ui,
			-apple-system,
			BlinkMacSystemFont,
			'Segoe UI',
			sans-serif;
	}

	.brand {
		position: absolute;
		z-index: 20;
		top: clamp(1rem, 3vw, 2rem);
		left: var(--gutter);
		display: flex;
		align-items: center;
		gap: 0.65rem;
		font-size: 0.7rem;
		font-weight: 800;
		letter-spacing: 0.26em;
		text-shadow: 0 1px 14px oklch(0 0 0 / 0.55);
		animation: rise 0.7s var(--ease) both;
	}

	.brand img {
		width: 2.1rem;
		height: 2.1rem;
		object-fit: contain;
	}

	.sr-only {
		position: absolute;
		width: 1px;
		height: 1px;
		padding: 0;
		margin: -1px;
		overflow: hidden;
		clip: rect(0, 0, 0, 0);
		white-space: nowrap;
		border: 0;
	}

	.search-shell {
		position: fixed;
		z-index: 45;
		top: clamp(1rem, 3vw, 2rem);
		right: var(--gutter);
		width: min(21rem, calc(100vw - 2rem));
		animation: rise 0.7s var(--ease) 0.08s both;
	}

	.search-form {
		display: flex;
		align-items: center;
		height: 2.75rem;
		padding-left: 1rem;
		border-radius: 999px;
		background: var(--surface);
		box-shadow: 0 0.5rem 1.75rem var(--shadow);
		backdrop-filter: blur(16px);
		transition:
			background-color 180ms ease,
			box-shadow 180ms ease;
	}

	.search-form:focus-within {
		background: oklch(0.22 0.006 80 / 0.9);
		box-shadow:
			0 0.5rem 1.75rem var(--shadow),
			var(--focus-ring);
	}

	.search-form input {
		min-width: 0;
		flex: 1;
		border: 0;
		outline: 0;
		background: transparent;
		color: var(--fg);
		font: inherit;
		font-size: 0.82rem;
	}

	.search-form input::placeholder {
		color: var(--dim);
	}

	.search-form input::-webkit-search-cancel-button {
		display: none;
	}

	.search-form button {
		display: grid;
		width: 2.75rem;
		height: 2.75rem;
		flex: 0 0 auto;
		place-items: center;
		border: 0;
		border-radius: 50%;
		background: transparent;
		color: var(--muted);
		cursor: pointer;
		transition: color 160ms ease;
	}

	.search-form button:hover {
		color: var(--fg);
	}

	.search-icon {
		position: relative;
		display: block;
		width: 0.85rem;
		height: 0.85rem;
		border: 1.6px solid currentColor;
		border-radius: 50%;
	}

	.search-icon::after {
		position: absolute;
		right: -0.32rem;
		bottom: -0.2rem;
		width: 0.44rem;
		height: 1.6px;
		background: currentColor;
		content: '';
		transform: rotate(45deg);
		transform-origin: left center;
	}

	.search-results {
		max-height: min(66svh, 34rem);
		margin-top: 0.5rem;
		padding: 0.4rem;
		overflow-y: auto;
		border-radius: var(--radius-lg);
		background: oklch(0.17 0.005 80 / 0.94);
		box-shadow: 0 1.25rem 3.5rem oklch(0 0 0 / 0.55);
		backdrop-filter: blur(20px);
		scrollbar-color: oklch(0.8 0.15 78 / 0.4) transparent;
		scrollbar-width: thin;
		transform-origin: top right;
		animation: drop-in 0.32s var(--ease) both;
	}

	.search-result-list {
		display: grid;
		gap: 0.1rem;
	}

	.search-result {
		display: grid;
		width: 100%;
		grid-template-columns: 2.6rem minmax(0, 1fr);
		align-items: center;
		gap: 0.8rem;
		min-height: 4.1rem;
		padding: 0.4rem;
		border: 0;
		border-radius: 0.55rem;
		background: transparent;
		color: inherit;
		font: inherit;
		text-align: left;
		cursor: pointer;
		transition:
			background-color 140ms ease,
			transform 220ms var(--ease);
	}

	.search-result:hover {
		background: var(--hairline);
		transform: translateX(2px);
	}

	.search-result > img,
	.result-placeholder {
		width: 2.6rem;
		height: 3.4rem;
		border-radius: 0.3rem;
		object-fit: cover;
		background: var(--poster-bg);
	}

	.result-placeholder {
		display: grid;
		place-items: center;
		color: var(--accent);
		font-size: 1rem;
		font-weight: 800;
	}

	.search-result h3 {
		margin: 0;
		overflow: hidden;
		color: var(--fg);
		font-size: 0.82rem;
		font-weight: 650;
		text-overflow: ellipsis;
		white-space: nowrap;
	}

	.search-result p,
	.search-status {
		margin: 0.3rem 0 0;
		color: var(--dim);
		font-size: 0.68rem;
		letter-spacing: 0.02em;
	}

	.search-status {
		padding: 1.1rem;
		text-align: center;
	}

	.search-status.error {
		color: oklch(0.79 0.12 30);
	}

	/* old and new catalogs share one grid cell so they can cross-slide during a switch */
	.stack {
		display: grid;
	}

	.content {
		position: relative;
		z-index: 1;
		grid-area: 1 / 1;
		width: 100%;
		min-width: 0;
		overflow: hidden;
		background: var(--bg);
		transition:
			opacity 220ms ease,
			filter 220ms ease;
	}

	.content.switching {
		opacity: 0.55;
		filter: saturate(0.6);
		pointer-events: none;
	}

	.hero {
		position: relative;
		height: 100svh;
		min-height: 34rem;
		overflow: hidden;
		cursor: pointer;
	}

	/* keyboard focus: a soft glow instead of a hard outline */
	.hero-action:focus-visible,
	.search-result:focus-visible,
	.search-form button:focus-visible,
	.media-toggle button:focus-visible {
		outline: none;
		box-shadow: var(--focus-ring);
	}

	.movie-card:focus-visible {
		outline: none;
	}

	.movie-card:focus-visible .poster {
		box-shadow:
			0 0.9rem 2.25rem oklch(0 0 0 / 0.5),
			var(--focus-ring);
		transform: translateY(-0.35rem);
	}

	.hero-action {
		position: absolute;
		z-index: 4;
		inset: 0;
		border: 0;
		background: transparent;
		cursor: pointer;
	}

	.hero-action:focus-visible {
		box-shadow: inset 0 0 0 3px oklch(0.8 0.15 78 / 0.38);
	}

	.hero::after {
		position: absolute;
		z-index: 1;
		inset: 0;
		background: linear-gradient(
			to top,
			var(--bg) 0%,
			oklch(0.14 0.004 80 / 0.78) 22%,
			oklch(0.14 0.004 80 / 0.12) 58%,
			oklch(0.14 0.004 80 / 0.4) 100%
		);
		content: '';
		pointer-events: none;
	}

	.hero-cover {
		display: block;
		width: 100%;
		height: 100%;
		object-fit: cover;
		object-position: center 30%;
		filter: saturate(0.85) brightness(0.92);
		animation: hero-zoom 2.2s var(--ease) both;
	}

	.hero-copy {
		position: absolute;
		z-index: 2;
		right: var(--gutter);
		bottom: clamp(2rem, 6vw, 4.5rem);
		width: min(34rem, calc(100% - 2.5rem));
		text-align: right;
	}

	.hero-copy > * {
		animation: rise 0.9s var(--ease) both;
	}

	.hero-copy p {
		margin: 0 0 0.6rem;
		color: var(--accent);
		font-size: 0.62rem;
		font-weight: 800;
		letter-spacing: 0.2em;
		text-transform: uppercase;
		animation-delay: 0.25s;
	}

	.hero-copy h1 {
		margin: 0;
		font-family: momcake, Inter, ui-sans-serif, system-ui, sans-serif;
		font-size: clamp(3rem, 7.5vw, 6.5rem);
		font-weight: 850;
		letter-spacing: -0.055em;
		line-height: 0.9;
		text-wrap: balance;
		animation-delay: 0.35s;
	}

	.hero-copy > span {
		display: block;
		margin-top: 0.9rem;
		color: var(--muted);
		font-size: 0.68rem;
		font-weight: 650;
		letter-spacing: 0.14em;
		text-transform: uppercase;
		animation-delay: 0.48s;
	}

	.play-overlay,
	.card-play {
		position: absolute;
		z-index: 3;
		inset: 0;
		display: grid;
		place-items: center;
		background: oklch(0.14 0.004 80 / 0.4);
		opacity: 0;
		pointer-events: none;
		transition: opacity 220ms ease;
	}

	/* play buttons: frosted disc, no ring */
	.play-button,
	.card-play > span {
		display: grid;
		place-items: center;
		border-radius: 50%;
		background: oklch(0.97 0.008 95 / 0.16);
		box-shadow: 0 0.5rem 1.5rem oklch(0 0 0 / 0.35);
		backdrop-filter: blur(8px);
		transform: scale(0.84);
		transition:
			transform 300ms var(--spring),
			background-color 200ms ease;
	}

	.play-button {
		width: 4.4rem;
		height: 4.4rem;
	}

	.play-button > span,
	.card-play i {
		width: 0;
		height: 0;
		margin-left: 0.28rem;
		border-top: 0.56rem solid transparent;
		border-bottom: 0.56rem solid transparent;
		border-left: 0.9rem solid var(--fg);
	}

	.hero:hover .play-overlay {
		opacity: 1;
	}

	.hero:hover .play-button {
		background: oklch(0.8 0.15 78 / 0.85);
		transform: scale(1);
	}

	.hero:hover .play-button > span {
		border-left-color: var(--on-accent);
	}

	.catalog {
		position: relative;
		z-index: 4;
		padding: clamp(2.5rem, 5vw, 4rem) 0 7.5rem;
	}

	/* Movies / Shows switch with a sliding thumb */
	.media-toggle {
		--option: 5.6rem;
		position: fixed;
		z-index: 50;
		bottom: max(1.25rem, env(safe-area-inset-bottom));
		left: 50%;
		display: flex;
		gap: 0.2rem;
		padding: 0.28rem;
		border-radius: 999px;
		background: var(--surface);
		box-shadow: 0 0.75rem 2.25rem oklch(0 0 0 / 0.5);
		backdrop-filter: blur(16px);
		transform: translateX(-50%);
		animation: toggle-in 0.8s var(--ease) 0.3s both;
	}

	.media-toggle .thumb {
		position: absolute;
		top: 0.28rem;
		bottom: 0.28rem;
		left: 0.28rem;
		width: var(--option);
		overflow: hidden;
		border-radius: 999px;
		background: var(--accent);
		box-shadow: 0 0.3rem 1rem oklch(0.8 0.15 78 / 0.3);
		transition: transform 480ms var(--spring);
	}

	.media-toggle.shows .thumb {
		transform: translateX(calc(var(--option) + 0.2rem));
	}

	/* while the other catalog loads, light runs across the thumb */
	.media-toggle.switching .thumb::after {
		position: absolute;
		inset: 0;
		background: linear-gradient(100deg, transparent 25%, oklch(1 0 0 / 0.55), transparent 75%);
		content: '';
		transform: translateX(-100%);
		animation: sweep 0.9s ease-in-out infinite;
	}

	.media-toggle button {
		position: relative;
		z-index: 1;
		width: var(--option);
		padding: 0.65rem 0;
		border: 0;
		border-radius: 999px;
		background: transparent;
		color: var(--muted);
		font: inherit;
		font-size: 0.72rem;
		font-weight: 700;
		letter-spacing: 0.03em;
		cursor: pointer;
		transition: color 260ms ease;
	}

	.media-toggle button:hover {
		color: var(--fg);
	}

	.media-toggle button.active {
		color: var(--on-accent);
	}

	.media-toggle button:disabled {
		cursor: progress;
	}

	.movie-section {
		padding-block: clamp(1.5rem, 3vw, 2.5rem);
	}

	.section-heading {
		display: flex;
		align-items: baseline;
		justify-content: flex-start;
		gap: 1.5rem;
		padding-inline: var(--gutter);
	}

	.section-heading p {
		margin: 0 0 0.3rem;
		color: var(--dim);
		font-size: 0.62rem;
		font-weight: 700;
		letter-spacing: 0.18em;
		text-transform: uppercase;
	}

	.section-heading h2 {
		margin: 0;
		font-size: clamp(1.45rem, 2.6vw, 2.15rem);
		font-weight: 700;
		letter-spacing: -0.035em;
		line-height: 1.05;
	}

	.carousel {
		display: grid;
		grid-auto-columns: clamp(9rem, 14vw, 12.5rem);
		grid-auto-flow: column;
		gap: clamp(0.7rem, 1.2vw, 1.05rem);
		margin-top: 1.35rem;
		padding: 0.5rem var(--gutter) 1rem;
		overflow-x: auto;
		overscroll-behavior-inline: contain;
		scroll-padding-inline: var(--gutter);
		scroll-snap-type: inline proximity;
		scrollbar-width: none;
		cursor: default;
		outline: none;
		touch-action: pan-y;
		user-select: none;
	}

	.carousel::-webkit-scrollbar {
		display: none;
	}

	:global(.carousel.dragging) {
		cursor: grabbing;
		scroll-snap-type: none;
	}

	.all-movies-scroll {
		margin: 1.35rem var(--gutter) 0;
	}

	.all-movies-grid {
		display: grid;
		grid-template-columns: repeat(auto-fill, minmax(9rem, 1fr));
		gap: clamp(1.4rem, 2.4vw, 2rem) clamp(0.7rem, 1.2vw, 1.05rem);
		padding: 0.5rem 0 1rem;
	}

	/* cards cascade in, capped so long rows don't wait forever */
	.movie-card {
		min-width: 0;
		padding: 0;
		border: 0;
		border-radius: var(--radius);
		background: transparent;
		color: inherit;
		font: inherit;
		text-align: left;
		cursor: pointer;
		scroll-snap-align: start;
		animation: card-in 0.6s var(--ease) both;
		animation-delay: calc(min(var(--i, 0), 10) * 45ms + 140ms);
	}

	.poster {
		position: relative;
		aspect-ratio: 2 / 3;
		overflow: hidden;
		border-radius: var(--radius);
		background: var(--poster-bg);
		box-shadow: 0 0.4rem 1.4rem oklch(0 0 0 / 0.34);
		transition:
			transform 340ms var(--ease),
			box-shadow 340ms var(--ease);
	}

	.poster > img {
		display: block;
		width: 100%;
		height: 100%;
		object-fit: cover;
		pointer-events: none;
		transition:
			filter 250ms ease,
			transform 600ms var(--ease);
	}

	.card-play > span {
		width: 3.1rem;
		height: 3.1rem;
	}

	.card-play i {
		margin-left: 0.2rem;
		border-top-width: 0.42rem;
		border-bottom-width: 0.42rem;
		border-left-width: 0.68rem;
	}

	.movie-card:hover .poster {
		box-shadow: 0 0.9rem 2.25rem oklch(0 0 0 / 0.5);
		transform: translateY(-0.35rem);
	}

	.poster:hover > img {
		filter: brightness(0.55);
		transform: scale(1.04);
	}

	.poster:hover .card-play {
		opacity: 1;
	}

	.poster:hover .card-play > span {
		transform: scale(1);
	}

	.movie-card:active .poster {
		transform: translateY(-0.15rem) scale(0.98);
		transition-duration: 120ms;
	}

	.movie-card h3 {
		margin: 0.75rem 0 0;
		overflow: hidden;
		color: var(--muted);
		font-size: 0.82rem;
		font-weight: 600;
		letter-spacing: -0.005em;
		line-height: 1.35;
		text-overflow: ellipsis;
		white-space: nowrap;
		transition: color 180ms ease;
	}

	.movie-card:hover h3 {
		color: var(--fg);
	}

	@keyframes rise {
		from {
			opacity: 0;
			transform: translateY(14px);
		}
	}

	@keyframes hero-zoom {
		from {
			opacity: 0;
			transform: scale(1.08);
		}
	}

	@keyframes card-in {
		from {
			opacity: 0;
			transform: translateY(18px) scale(0.97);
		}
	}

	@keyframes drop-in {
		from {
			opacity: 0;
			transform: translateY(-6px) scale(0.98);
		}
	}

	@keyframes toggle-in {
		from {
			opacity: 0;
			transform: translate(-50%, 24px);
		}
	}

	@keyframes sweep {
		to {
			transform: translateX(100%);
		}
	}

	@media (max-width: 640px) {
		:global(:root) {
			--gutter: 1.1rem;
		}

		.brand {
			top: 1rem;
		}

		.search-shell {
			top: 4.35rem;
			width: calc(100vw - 2.2rem);
		}

		.hero {
			height: 100svh;
			min-height: 30rem;
		}

		.hero-cover {
			object-position: 60% center;
		}

		.hero-copy {
			width: calc(100% - 2.2rem);
		}

		.hero-copy h1 {
			font-size: clamp(3rem, 15vw, 5rem);
		}

		.carousel {
			grid-auto-columns: 8.75rem;
		}

		.all-movies-scroll {
			max-height: 78svh;
		}

		.all-movies-grid {
			grid-template-columns: repeat(2, minmax(0, 1fr));
		}
	}

	@media (hover: none) {
		.hero .play-overlay,
		.poster .card-play {
			display: none;
		}

		.movie-card:hover .poster {
			transform: none;
		}
	}

	@media (prefers-reduced-motion: reduce) {
		:global(html) {
			scroll-behavior: auto;
		}

		.brand,
		.search-shell,
		.search-results,
		.hero-cover,
		.hero-copy > *,
		.media-toggle,
		.movie-card,
		.media-toggle .thumb::after {
			animation: none;
		}

		.content,
		.play-overlay,
		.card-play,
		.play-button,
		.card-play > span,
		.poster,
		.poster > img,
		.movie-card h3,
		.media-toggle .thumb,
		.search-result {
			transition: none;
		}

		.movie-card:hover .poster,
		.poster:hover > img {
			transform: none;
		}
	}
</style>
