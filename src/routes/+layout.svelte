<script>
	import { onNavigate } from '$app/navigation';
	import favicon from '$lib/assets/pyrite.png';
	import '$lib/styles/assets.css';
	import { tick } from 'svelte';
	let { children } = $props();

	// Cross-page animation via the View Transitions API: pages crossfade, and the poster
	// (or hero backdrop) you clicked morphs into its spot on the watch page. Browsers
	// without the API just navigate normally.
	onNavigate((navigation) => {
		if (!document.startViewTransition) return;
		if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) return;

		return new Promise((resolve) => {
			document.startViewTransition(async () => {
				resolve();
				await navigation.complete;
				await tick();
			});
		});
	});
</script>

<svelte:head>
	<link rel="icon" href={favicon} />
</svelte:head>

{@render children()}

<style>
	:global(::view-transition-old(root)) {
		animation: 240ms cubic-bezier(0.4, 0, 1, 1) both -global-page-out;
	}

	:global(::view-transition-new(root)) {
		animation: 420ms cubic-bezier(0.16, 1, 0.3, 1) 60ms both -global-page-in;
	}

	:global(::view-transition-group(opening-poster)),
	:global(::view-transition-group(opening-backdrop)) {
		animation-duration: 620ms;
		animation-timing-function: cubic-bezier(0.16, 1, 0.3, 1);
	}

	:global(::view-transition-old(opening-poster)),
	:global(::view-transition-new(opening-poster)),
	:global(::view-transition-old(opening-backdrop)),
	:global(::view-transition-new(opening-backdrop)) {
		height: 100%;
		object-fit: cover;
	}

	@keyframes -global-page-out {
		to {
			opacity: 0;
			transform: scale(0.985);
		}
	}

	@keyframes -global-page-in {
		from {
			opacity: 0;
			transform: scale(1.015);
		}
	}
</style>
