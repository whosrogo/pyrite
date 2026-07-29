import { TMDB } from '$env/static/private';
const options = {
	method: 'GET',
	headers: {
		accept: 'application/json',
		Authorization: `Bearer ${TMDB}`
	}
};

export async function getPopularMovie() {
	const response = await fetch(
		'https://api.themoviedb.org/3/movie/popular?language=en-US&page=1',
		options
	);
	return await response.json();
}

export async function getDiscoverMovie() {
	const response = await fetch(
		`https://api.themoviedb.org/3/discover/movie?include_adult=false&include_video=false&language=en-US&page=1&sort_by=primary_release_date.desc`,
		options
	);
	return await response.json();
	await response.json();
}
