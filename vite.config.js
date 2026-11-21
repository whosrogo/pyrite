import adapter from '@sveltejs/adapter-node';
import { sveltekit } from '@sveltejs/kit/vite';
import { fileURLToPath } from 'node:url';
import { defineConfig } from 'vite';

// @p-stream/providers is installed straight from GitHub and ships only its TypeScript
// source (no built lib/), which also relies on an `@/` alias for its own src folder.
// Point the package at its src entry and resolve `@/` only for files inside it.
const pstreamSrc = fileURLToPath(
	new URL('./node_modules/@p-stream/providers/src', import.meta.url)
);

/** @returns {import('vite').Plugin} */
function pstreamSource() {
	return {
		name: 'pstream-source',
		enforce: 'pre',
		async resolveId(source, importer, options) {
			if (source === '@p-stream/providers') {
				return this.resolve(`${pstreamSrc}/index.ts`, importer, { ...options, skipSelf: true });
			}
			if (
				source.startsWith('@/') &&
				importer?.replace(/\\/g, '/').includes('/@p-stream/providers/src/')
			) {
				return this.resolve(`${pstreamSrc}/${source.slice(2)}`, importer, {
					...options,
					skipSelf: true
				});
			}
		}
	};
}

export default defineConfig({
	server: {
		port: 1234
	},
	ssr: {
		noExternal: ['@p-stream/providers']
	},
	plugins: [
		pstreamSource(),
		sveltekit({
			paths: {
				base: '/pyrite'
			},

			compilerOptions: {
				runes: ({ filename }) =>
					filename.split(/[/\\]/).includes('node_modules') ? undefined : true
			},

			adapter: adapter()
		})
	]
});
