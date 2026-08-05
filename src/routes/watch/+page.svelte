<script>
	import { goto } from '$app/navigation';
	import { onMount } from 'svelte';

	let selectedId = $state('');
	let selectedType = $state('');

	onMount(() => {
		selectedId = localStorage.getItem('selectedMediaId') ?? '';
		selectedType = localStorage.getItem('selectedMediaType') ?? '';
	});
	let PublicSrc = [
		{ label: 'source 1', value: 'https://example.com' },
		{ label: 'source 2', value: 'https://example2.com' }
	];
	let selectedSrc = $state('');
</script>

<main>
	<button class="back" type="button" onclick={() => goto('/')}>← Back to browse</button>

	<!-- svelte-ignore a11y_missing_attribute -->
	<iframe src={`selectedSrc`} frameborder="0" allowfullscreen></iframe>
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
		place-items: center;
	}

	.back {
		position: fixed;
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

	.back:focus-visible {
		outline: 2px solid #efb33d;
		outline-offset: 2px;
	}

	iframe {
		height: 100%;
		width: 100%;
	}
</style>
