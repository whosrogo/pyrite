<script>
	import { goto } from '$app/navigation';
	import logo from '$lib/assets/pyrite.png';

	/** @type {import('./$types').PageProps} */
	let { data } = $props();

	let hero = $derived(data.popular?.[0]);
	let isShows = $derived(data.mediaType === 'shows');
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
				`/api/search?q=${encodeURIComponent(query)}&type=${data.mediaType}`,
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

	/** @param {number} id */
	function openWatch(id) {
		const selection = {
			id,
			type: data.mediaType
		};

		localStorage.setItem('selectedMediaId', String(id));
		localStorage.setItem('selectedMediaType', data.mediaType);
		localStorage.setItem('selectedMedia', JSON.stringify(selection));
		goto('/watch');
	}

	/** @param {'movies' | 'shows'} mediaType */
	function changeMedia(mediaType) {
		if (data.mediaType === mediaType) return;

		resetSearch();
		goto(mediaType === 'shows' ? '?type=shows' : '/', {
			keepFocus: true,
			noScroll: true
		});
	}

	/**
	 * Adds mouse, touch, and keyboard scrolling to a carousel.
	 * @param {HTMLElement} node
	 */
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
			node.setPointerCapture(event.pointerId);
			node.classList.add('dragging');
		}

		/** @param {PointerEvent} event */
		function pointerMove(event) {
			if (!dragging) return;

			const distance = event.clientX - startX;
			if (Math.abs(distance) > 4) moved = true;
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
		node.addEventListener('pointercancel', pointerUp);
		node.addEventListener('click', stopDraggedClick, true);

		return {
			destroy() {
				node.removeEventListener('pointerdown', pointerDown);
				node.removeEventListener('pointermove', pointerMove);
				node.removeEventListener('pointerup', pointerUp);
				node.removeEventListener('pointercancel', pointerUp);
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
		<label class="sr-only" for="catalog-search"
			>Search {isShows ? 'shows' : 'movies'}</label
		>
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
							onclick={() => openWatch(result.id)}
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

<div class="content">
	{#if hero}
		<section class="hero" aria-labelledby="hero-title">
			<img
				class="hero-cover"
				src={`https://image.tmdb.org/t/p/original${hero.backdrop_path}`}
				alt={`Backdrop for ${hero.title}`}
			/>

			<button
				type="button"
				class="hero-action"
				onclick={() => openWatch(hero.id)}
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
							{#each section.movies as movie (movie.id)}
								<button
									type="button"
									class="movie-card"
									onclick={() => openWatch(movie.id)}
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
						{#each section.movies as movie (movie.id)}
							<button
								type="button"
								class="movie-card"
								onclick={() => openWatch(movie.id)}
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

<nav class="media-toggle" aria-label="Choose what to browse">
	<button
		type="button"
		class:active={!isShows}
		aria-pressed={!isShows}
		onclick={() => changeMedia('movies')}>Movies</button
	>
	<button
		type="button"
		class:active={isShows}
		aria-pressed={isShows}
		onclick={() => changeMedia('shows')}>Shows</button
	>
</nav>

<style>
	:global(*) {
		box-sizing: border-box;
	}

	:global(html) {
		background: #090909;
		scroll-behavior: smooth;
	}

	:global(body) {
		margin: 0;
		background: #090909;
		color: #f7f5ef;
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
		left: clamp(1rem, 4vw, 4rem);
		display: flex;
		align-items: center;
		gap: 0.7rem;
		font-size: 0.72rem;
		font-weight: 850;
		letter-spacing: 0.24em;
	}

	.brand img {
		width: 2.3rem;
		height: 2.3rem;
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
		right: clamp(1rem, 4vw, 4rem);
		width: min(22rem, calc(100vw - 2rem));
	}

	.search-form {
		display: flex;
		align-items: center;
		height: 2.8rem;
		padding-left: 1rem;
		border-radius: 999px;
		background: rgba(18, 18, 18, 0.94);
		box-shadow: 0 0.6rem 2rem rgba(0, 0, 0, 0.28);
	}

	.search-form input {
		min-width: 0;
		flex: 1;
		border: 0;
		outline: 0;
		background: transparent;
		color: #fff;
		font: inherit;
		font-size: 0.82rem;
	}

	.search-form input::placeholder {
		color: rgba(255, 255, 255, 0.48);
	}

	.search-form input::-webkit-search-cancel-button {
		display: none;
	}

	.search-form button {
		display: grid;
		width: 2.8rem;
		height: 2.8rem;
		flex: 0 0 auto;
		place-items: center;
		border: 0;
		border-radius: 50%;
		background: transparent;
		color: #fff;
		cursor: pointer;
	}

	.search-form button:hover {
		background: rgba(255, 255, 255, 0.08);
	}

	.search-form button:focus-visible,
	.search-form input:focus-visible {
		outline: 2px solid #efb33d;
		outline-offset: 2px;
	}

	.search-icon {
		position: relative;
		display: block;
		width: 0.9rem;
		height: 0.9rem;
		border: 1.7px solid currentColor;
		border-radius: 50%;
	}

	.search-icon::after {
		position: absolute;
		right: -0.34rem;
		bottom: -0.2rem;
		width: 0.45rem;
		height: 1.7px;
		background: currentColor;
		content: '';
		transform: rotate(45deg);
		transform-origin: left center;
	}

	.search-results {
		max-height: min(66svh, 34rem);
		margin-top: 0.55rem;
		padding: 0.45rem;
		overflow-y: auto;
		border-radius: 1rem;
		background: rgba(14, 14, 14, 0.98);
		box-shadow: 0 1.2rem 3.5rem rgba(0, 0, 0, 0.5);
		scrollbar-color: rgba(239, 179, 61, 0.5) transparent;
		scrollbar-width: thin;
	}

	.search-result-list {
		display: grid;
		gap: 0.15rem;
	}

	.search-result {
		display: grid;
		width: 100%;
		grid-template-columns: 2.8rem minmax(0, 1fr);
		align-items: center;
		gap: 0.8rem;
		min-height: 4.35rem;
		padding: 0.4rem;
		border: 0;
		border-radius: 0.7rem;
		background: transparent;
		color: inherit;
		font: inherit;
		text-align: left;
		cursor: pointer;
	}

	.search-result:hover {
		background: rgba(255, 255, 255, 0.055);
	}

	.search-result > img,
	.result-placeholder {
		width: 2.8rem;
		height: 3.65rem;
		border-radius: 0.35rem;
		object-fit: cover;
		background: #252525;
	}

	.result-placeholder {
		display: grid;
		place-items: center;
		color: #efb33d;
		font-size: 1rem;
		font-weight: 800;
	}

	.search-result h3 {
		margin: 0;
		overflow: hidden;
		color: rgba(255, 255, 255, 0.94);
		font-size: 0.83rem;
		font-weight: 680;
		text-overflow: ellipsis;
		white-space: nowrap;
	}

	.search-result p,
	.search-status {
		margin: 0.35rem 0 0;
		color: rgba(255, 255, 255, 0.48);
		font-size: 0.67rem;
		letter-spacing: 0.02em;
	}

	.search-status {
		padding: 1rem;
		text-align: center;
	}

	.search-status.error {
		color: #ff9d8f;
	}

	.content {
		position: relative;
		width: 100%;
		overflow: hidden;
		background: #090909;
	}

	.hero {
		position: relative;
		height: 100svh;
		min-height: 36rem;
		overflow: hidden;
		cursor: pointer;
	}

	.hero-action:focus-visible,
	.search-result:focus-visible,
	.movie-card:focus-visible {
		outline: 2px solid #efb33d;
		outline-offset: 3px;
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
		outline-offset: -4px;
	}

	.hero::after {
		position: absolute;
		z-index: 1;
		inset: 0;
		background: rgba(0, 0, 0, 0.22);
		box-shadow: inset 0 -14rem 10rem -8rem #090909;
		content: '';
		pointer-events: none;
	}

	.hero-cover {
		display: block;
		width: 100%;
		height: 100%;
		object-fit: cover;
		object-position: center 30%;
		filter: saturate(0.76) brightness(0.78) contrast(1.05);
	}

	.hero-copy {
		position: absolute;
		z-index: 2;
		right: clamp(1.25rem, 6vw, 6rem);
		bottom: clamp(2rem, 7vw, 5.5rem);
		width: min(36rem, calc(100% - 2.5rem));
		text-align: right;
		transition:
			opacity 220ms ease,
			transform 220ms ease;
	}

	.hero-copy p,
	.section-heading p {
		margin: 0 0 0.45rem;
		color: #efb33d;
		font-size: 0.65rem;
		font-weight: 800;
		letter-spacing: 0.18em;
		text-transform: uppercase;
	}

	.hero-copy h1 {
		margin: 0;
		font-family: momcake, Inter, ui-sans-serif, system-ui, sans-serif;
		font-size: clamp(3.5rem, 9vw, 8rem);
		font-weight: 850;
		letter-spacing: -0.06em;
		line-height: 0.86;
		text-wrap: balance;
	}

	.hero-copy > span {
		display: block;
		margin-top: 1rem;
		color: rgba(255, 255, 255, 0.62);
		font-size: 0.72rem;
		font-weight: 700;
		letter-spacing: 0.12em;
		text-transform: uppercase;
	}

	.play-overlay,
	.card-play {
		position: absolute;
		z-index: 3;
		inset: 0;
		display: grid;
		place-items: center;
		background: rgba(0, 0, 0, 0.46);
		opacity: 0;
		pointer-events: none;
		transition: opacity 220ms ease;
	}

	.play-button,
	.card-play > span {
		display: grid;
		place-items: center;
		border: 1px solid rgba(255, 255, 255, 0.78);
		border-radius: 50%;
		background: rgba(8, 8, 8, 0.58);
		transform: scale(0.82);
		transition: transform 260ms cubic-bezier(0.16, 1, 0.3, 1);
	}

	.play-button {
		width: 5rem;
		height: 5rem;
	}

	.play-button > span,
	.card-play i {
		width: 0;
		height: 0;
		margin-left: 0.3rem;
		border-top: 0.62rem solid transparent;
		border-bottom: 0.62rem solid transparent;
		border-left: 1rem solid white;
	}

	.hero:hover .play-overlay {
		opacity: 1;
	}

	.hero:hover .play-button {
		transform: scale(1);
	}

	.catalog {
		position: relative;
		z-index: 4;
		padding: clamp(3rem, 7vw, 6rem) 0 9rem;
	}

	.media-toggle {
		position: fixed;
		z-index: 50;
		bottom: max(1.25rem, env(safe-area-inset-bottom));
		left: 50%;
		display: flex;
		gap: 0.25rem;
		padding: 0.3rem;
		border-radius: 999px;
		background: rgba(20, 20, 20, 0.94);
		box-shadow: 0 0.8rem 2.5rem rgba(0, 0, 0, 0.42);
		transform: translateX(-50%);
	}

	.media-toggle button {
		min-width: 5.5rem;
		padding: 0.72rem 1.1rem;
		border: 0;
		border-radius: 999px;
		background: transparent;
		color: rgba(255, 255, 255, 0.6);
		font: inherit;
		font-size: 0.72rem;
		font-weight: 750;
		letter-spacing: 0.04em;
		cursor: pointer;
		transition:
			background-color 180ms ease,
			color 180ms ease;
	}

	.media-toggle button:hover {
		color: #fff;
	}

	.media-toggle button.active {
		background: #efb33d;
		color: #0a0a0a;
	}

	.media-toggle button:focus-visible {
		outline: 2px solid #fff;
		outline-offset: 2px;
	}

	.movie-section {
		padding: clamp(2.5rem, 6vw, 5rem) 0;
	}

	.section-heading {
		display: flex;
		align-items: end;
		justify-content: flex-start;
		gap: 2rem;
		padding: 0 clamp(1rem, 4vw, 4rem);
	}

	.section-heading h2 {
		margin: 0;
		font-size: clamp(2rem, 4.2vw, 4rem);
		font-weight: 760;
		letter-spacing: -0.055em;
		line-height: 0.94;
	}

	.carousel {
		display: grid;
		grid-auto-columns: clamp(9.5rem, 16vw, 14rem);
		grid-auto-flow: column;
		gap: clamp(0.8rem, 1.5vw, 1.25rem);
		margin-top: 1.75rem;
		padding: 0 clamp(1rem, 4vw, 4rem) 1rem;
		overflow-x: auto;
		overscroll-behavior-inline: contain;
		scroll-padding-inline: clamp(1rem, 4vw, 4rem);
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
		margin: 1.75rem clamp(1rem, 4vw, 4rem) 0;
		padding-right: 0.6rem;
	}

	.all-movies-grid {
		display: grid;
		grid-template-columns: repeat(auto-fill, minmax(9.5rem, 1fr));
		gap: clamp(1.8rem, 3vw, 2.6rem) clamp(0.8rem, 1.5vw, 1.25rem);
		padding-bottom: 1rem;
	}

	.movie-card {
		min-width: 0;
		padding: 0;
		border: 0;
		background: transparent;
		color: inherit;
		font: inherit;
		text-align: left;
		cursor: pointer;
		scroll-snap-align: start;
	}

	.poster {
		cursor: pointer;

		position: relative;
		aspect-ratio: 2 / 3;
		overflow: hidden;
		background: #171717;
	}

	.poster > img {
		display: block;
		width: 100%;
		height: 100%;
		object-fit: cover;
		pointer-events: none;
		transition: filter 250ms ease;
	}

	.card-play > span {
		width: 3.4rem;
		height: 3.4rem;
	}

	.card-play i {
		margin-left: 0.2rem;
		border-top-width: 0.45rem;
		border-bottom-width: 0.45rem;
		border-left-width: 0.72rem;
	}

	.poster:hover > img {
		filter: brightness(0.58);
	}

	.poster:hover .card-play {
		opacity: 1;
	}

	.poster:hover .card-play > span {
		transform: scale(1);
	}

	.movie-card h3 {
		margin: 0.8rem 0 0;
		overflow: hidden;
		color: rgba(255, 255, 255, 0.88);
		font-size: 0.86rem;
		font-weight: 620;
		letter-spacing: -0.01em;
		line-height: 1.35;
		text-overflow: ellipsis;
		white-space: nowrap;
	}

	@media (max-width: 640px) {
		.brand {
			top: 1rem;
			left: 1rem;
		}

		.search-shell {
			top: 4.5rem;
			right: 1rem;
			width: calc(100vw - 2rem);
		}

		.hero {
			height: 100svh;
			min-height: 30rem;
		}

		.hero-cover {
			object-position: 60% center;
		}

		.hero-copy {
			right: 1rem;
			bottom: 2rem;
			width: calc(100% - 2rem);
		}

		.hero-copy h1 {
			font-size: clamp(3.2rem, 16vw, 5.5rem);
		}

		.carousel {
			grid-auto-columns: 9.25rem;
		}

		.all-movies-scroll {
			max-height: 78svh;
			margin-inline: 1rem;
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
	}

	@media (prefers-reduced-motion: reduce) {
		:global(html) {
			scroll-behavior: auto;
		}

		.hero-copy,
		.play-overlay,
		.card-play,
		.play-button,
		.card-play > span,
		.poster > img {
			transition: none;
		}
	}
</style>
