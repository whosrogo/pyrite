<script>
	import logo from '$lib/assets/pyrite.png';

	/** @type {import('./$types').PageProps} */
	let { data } = $props();

	let hero = $derived(data.popular?.[0]);
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
			id: 'all-movies',
			label: 'The full collection',
			title: 'All movies',
			movies: data.allMovies
		}
	]);

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
	<meta name="description" content="Browse popular, top-rated, and newly discovered movies." />
</svelte:head>

<header class="brand">
	<img src={logo} alt="" />
	<span>PYRITE</span>
</header>

<div class="content">
	{#if hero}
		<section class="hero" aria-labelledby="hero-title">
			<img
				class="hero-cover"
				src={`https://image.tmdb.org/t/p/original${hero.backdrop_path}`}
				alt={`Backdrop for ${hero.title}`}
			/>

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

				{#if section.id === 'all-movies'}
					<div
						class="all-movies-scroll"
						role="region"
						aria-label="Scrollable collection of all movies"
					>
						<div class="all-movies-grid">
							{#each section.movies as movie (movie.id)}
								<article class="movie-card">
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
								</article>
							{/each}
						</div>
					</div>
				{:else}
					<div class="carousel" use:draggable role="region" aria-label={`${section.title} movies`}>
						{#each section.movies as movie (movie.id)}
							<article class="movie-card">
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
							</article>
						{/each}
					</div>
				{/if}
			</section>
		{/each}
	</div>
</div>

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

	.content {
		position: relative;
		width: 100%;
		overflow: hidden;
		background: #090909;
	}

	.hero {
		position: relative;
		height: min(72svh, 48rem);
		min-height: 34rem;
		overflow: hidden;
		cursor: pointer;
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
		padding: clamp(3rem, 7vw, 6rem) 0 7rem;
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

		.hero {
			height: 68svh;
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
