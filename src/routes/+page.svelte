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
