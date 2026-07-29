<script>
	import { goto } from '$app/navigation';
	import { onMount } from 'svelte';

	let selectedId = $state('');
	let selectedType = $state('');

	onMount(() => {
		selectedId = localStorage.getItem('selectedMediaId') ?? '';
		selectedType = localStorage.getItem('selectedMediaType') ?? '';
	});
</script>

<svelte:head>
	<title>Pyrite — Watch</title>
</svelte:head>

<main>
	<button class="back" type="button" onclick={() => goto('/')}>← Back to browse</button>

	<section>
		<p>{selectedType === 'shows' ? 'Show' : 'Movie'}</p>
		<h1>{selectedId ? `Ready to watch #${selectedId}` : 'Choose something to watch'}</h1>
		<span>
			{selectedId
				? 'Your selected TMDB ID is saved and ready for the player.'
				: 'Return to the catalog and select a title first.'}
		</span>
	</section>
</main>

<style>
	:global(body) {
		margin: 0;
		background: #090909;
		color: #f7f5ef;
		font-family:
			Inter,
			ui-sans-serif,
			system-ui,
			sans-serif;
	}

	main {
		display: grid;
		min-height: 100svh;
		place-items: center;
		padding: 2rem;
	}

	.back {
		position: fixed;
		top: 1.5rem;
		left: 1.5rem;
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

	.back:focus-visible {
		outline: 2px solid #efb33d;
		outline-offset: 2px;
	}

	section {
		width: min(42rem, 100%);
		text-align: center;
	}

	p {
		margin: 0 0 0.7rem;
		color: #efb33d;
		font-size: 0.68rem;
		font-weight: 800;
		letter-spacing: 0.18em;
		text-transform: uppercase;
	}

	h1 {
		margin: 0;
		font-size: clamp(2.7rem, 8vw, 6rem);
		letter-spacing: -0.06em;
		line-height: 0.95;
	}

	span {
		display: block;
		margin-top: 1.2rem;
		color: rgba(255, 255, 255, 0.55);
		line-height: 1.6;
	}
</style>
