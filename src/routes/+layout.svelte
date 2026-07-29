<script>
	import favicon from '$lib/assets/pyrite.png';
	import '$lib/styles/assets.css';
	let { children } = $props();
</script>

<svelte:head>
	<link rel="icon" href={favicon} />
</svelte:head>

{@render children()}
