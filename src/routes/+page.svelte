<script>
	import { json } from '@sveltejs/kit';
	import favicon from '$lib/assets/pyrite.png';
	const data = $props();
	const response = data.data.results;
</script>

<div class="logo">
	<img src={favicon} />
</div>

<div class="content">
	<div class="hero">
		<img
			src={`https://image.tmdb.org/t/p/original${response[0].backdrop_path}`}
			alt={`Backdrop for ${response[0].title}`}
		/>
		<div class="desc">
			<h1 class="title">{response[0].title}</h1>
			<p class="date">Date: <span><b>{response[0].release_date}</b></span></p>
			<p class="date">Rating: <span><b>{response[0].vote_average}/10</b></span></p>
		</div>
		<div class="play-overlay" aria-hidden="true">
			<span class="play-button"><span></span></span>
		</div>
	</div>
</div>

<style>
	.logo {
		position: absolute;
		height: 70px;
		border-radius: 100px;
	}
	.logo img {
		height: 100%;
	}

	.content {
		position: absolute;
		top: 0;
		z-index: -1;
		width: 100%;
		height: 100vh;
		display: flex;
		justify-content: center;
	}

	.hero {
		position: relative;
		width: 100%;
		height: 600px;
		display: flex;
		align-items: center;
		flex-direction: row;
		overflow: hidden;
		cursor: pointer;
	}
	.hero img {
		position: absolute;
		inset: 0;
		width: 100%;
		height: 100%;
		display: block;
		object-fit: cover;
		object-position: center 35%;
	}
	.play-overlay {
		position: absolute;
		z-index: 10;
		inset: 0;
		display: grid;
		place-items: center;
		background: rgba(0, 0, 0, 0.16);
		opacity: 0;
		pointer-events: none;
		transition: opacity 220ms ease;
	}
	.play-button {
		display: grid;
		width: 76px;
		height: 76px;
		place-items: center;
		border: 1px solid rgba(255, 255, 255, 0.75);
		border-radius: 50%;
		background: rgba(8, 8, 8, 0.55);
		box-shadow: 0 14px 40px rgba(0, 0, 0, 0.32);
		transform: scale(0.82);
		transition: transform 260ms cubic-bezier(0.16, 1, 0.3, 1);
	}
	.play-button > span {
		width: 0;
		height: 0;
		margin-left: 5px;
		border-top: 10px solid transparent;
		border-bottom: 10px solid transparent;
		border-left: 16px solid white;
	}
	.hero:hover .play-overlay {
		opacity: 1;
	}
	.hero:hover .play-button {
		transform: scale(1);
	}
	.desc {
		position: absolute;
		height: 100%;
		width: 100%;
		display: flex;
		flex-direction: column;
		justify-content: flex-end;
		padding: 0 0 20px 20px;
		box-sizing: border-box;
	}
	.title {
		color: white;
		font-family: momcake;
		font-weight: 900;
		font-size: 50px;
		margin-top: 0px;
		margin-left: -3px;
		margin-bottom: 0px;
	}
	.date {
		font-family: sans-serif;
		color: white;
		margin-left: 4px;
	}
	.overview {
		color: white;
		font-family: raela;
		font-size: 18px;
	}
	.title,
	.date {
		text-shadow:
			0 0 10px #00000071,
			0 0 20px #00000071,
			0 0 30px #00000071,
			0 0 40px #00000071,
			0 0 50px #00000071,
			0 0 60px #00000071,
			0 0 70px #00000071;
	}
</style>
