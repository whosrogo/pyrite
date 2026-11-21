/**
 * Subtitles that don't come attached to a stream, plus the file pipeline every
 * subtitle goes through before the browser sees it (fetch → decode → VTT → clean).
 *
 * Title-wide source: VidRock's subtitle cache, keyed only by TMDB id (+ season/episode),
 * which also covers anime. Per-stream captions (p-stream, VidSpark, VidCore, HLS) are
 * attached to the streams themselves and only use the file pipeline here.
 */
import { fetchPublic } from '$lib/server/net';

const UA =
	'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36';

const VIDROCK_SUBS = 'https://cache.vdrk.site/v1';
const LIST_TTL = 6 * 60 * 60 * 1000;
const EMPTY_LIST_TTL = 30 * 60 * 1000;
const FILE_TTL = 6 * 60 * 60 * 1000;
const FILE_CACHE_MAX = 400;
const MAX_FILE_BYTES = 4 * 1024 * 1024;

/**
 * @typedef {{ url: string, language: string, label: string, headers?: Record<string, string> }} Caption
 */

// display names used by the subtitle hosts → ISO 639-1
/** @type {Record<string, string>} */
const LANGUAGE_CODES = {
	arabic: 'ar',
	bengali: 'bn',
	brazilian: 'pt',
	'brazilian portuguese': 'pt',
	'portuguese (brazil)': 'pt',
	bulgarian: 'bg',
	chinese: 'zh',
	'chinese (simplified)': 'zh',
	'chinese (traditional)': 'zh',
	croatian: 'hr',
	czech: 'cs',
	danish: 'da',
	dutch: 'nl',
	english: 'en',
	estonian: 'et',
	farsi: 'fa',
	persian: 'fa',
	finnish: 'fi',
	french: 'fr',
	german: 'de',
	greek: 'el',
	hebrew: 'he',
	hindi: 'hi',
	hungarian: 'hu',
	indonesian: 'id',
	italian: 'it',
	japanese: 'ja',
	korean: 'ko',
	latvian: 'lv',
	lithuanian: 'lt',
	malay: 'ms',
	norwegian: 'no',
	polish: 'pl',
	portuguese: 'pt',
	romanian: 'ro',
	russian: 'ru',
	serbian: 'sr',
	slovak: 'sk',
	slovenian: 'sl',
	spanish: 'es',
	swedish: 'sv',
	tagalog: 'tl',
	thai: 'th',
	turkish: 'tr',
	ukrainian: 'uk',
	vietnamese: 'vi'
};

/**
 * Best-effort ISO code from a host's label ("English2", "Brazilian3", "en", "eng").
 * @param {string} label
 */
export function languageCode(label) {
	const clean = label
		.trim()
		.toLowerCase()
		.replace(/\s*\d+$/, '');
	if (LANGUAGE_CODES[clean]) return LANGUAGE_CODES[clean];
	if (/^[a-z]{2}(-[a-z0-9]+)?$/.test(clean)) return clean.slice(0, 2);
	if (clean === 'eng') return 'en';
	return '';
}

/** @type {Map<string, { at: number, ttl: number, captions: Caption[] }>} */
const lists = new Map();

/**
 * Subtitles VidRock has for this title, in its own order (best first per language).
 * @param {'movie' | 'tv'} type
 * @param {string} tmdbId
 * @param {number} [season]
 * @param {number} [episode]
 * @returns {Promise<Caption[]>}
 */
export async function titleSubtitles(type, tmdbId, season, episode) {
	const path = type === 'tv' ? `tv/${tmdbId}/${season}/${episode}` : `movie/${tmdbId}`;
	const hit = lists.get(path);
	if (hit && Date.now() - hit.at < hit.ttl) return hit.captions;

	/** @type {Caption[]} */
	let captions = [];
	try {
		const response = await fetch(`${VIDROCK_SUBS}/${path}`, {
			headers: { 'User-Agent': UA, Accept: 'application/json' },
			signal: AbortSignal.timeout(8000)
		});
		const list = response.ok ? await response.json() : [];
		captions = (Array.isArray(list) ? list : [])
			.filter((item) => typeof item?.file === 'string' && /^https:\/\//.test(item.file))
			.map((item) => {
				const label = String(item.label ?? '');
				const name = label.replace(/\s*\d+$/, '');
				const variant = label.match(/(\d+)$/)?.[1];
				return {
					url: item.file,
					language: languageCode(label),
					label: variant ? `${name} ${variant}` : name || 'Unknown'
				};
			});
	} catch (error) {
		console.log('[subtitles] vidrock list failed:', error instanceof Error ? error.message : error);
	}

	lists.set(path, { at: Date.now(), ttl: captions.length ? LIST_TTL : EMPTY_LIST_TTL, captions });
	if (lists.size > 2000) lists.delete(/** @type {string} */ (lists.keys().next().value));
	return captions;
}

// legacy 8-bit codepages by language, for files that aren't valid UTF-8
/** @type {Record<string, string>} */
const LEGACY_ENCODING = {
	cs: 'windows-1250',
	sk: 'windows-1250',
	pl: 'windows-1250',
	hu: 'windows-1250',
	hr: 'windows-1250',
	sl: 'windows-1250',
	ro: 'windows-1250',
	ru: 'windows-1251',
	bg: 'windows-1251',
	uk: 'windows-1251',
	sr: 'windows-1251',
	el: 'windows-1253',
	tr: 'windows-1254',
	he: 'windows-1255',
	ar: 'windows-1256',
	fa: 'windows-1256',
	th: 'windows-874'
};

/**
 * @param {Uint8Array} bytes
 * @param {string} language
 */
function decode(bytes, language) {
	try {
		return new TextDecoder('utf-8', { fatal: true }).decode(bytes);
	} catch {
		const fallback = LEGACY_ENCODING[language] ?? 'windows-1252';
		try {
			return new TextDecoder(fallback).decode(bytes);
		} catch {
			return new TextDecoder('utf-8').decode(bytes);
		}
	}
}

const TIMING = /^(\s*[\d:.,]+)\s*-->\s*([\d:.,]+)(.*)$/;

// watermark cues some hosts inject ("Visit hoofoot.ru to watch…", "Advertise your product…")
const AD_WORDS =
	/\b(visit|watch|download(ed)?|subtitles? (by|from)|opensubtitles|advertise|vip member|sync(ed)? (by|and))\b/i;
const DOMAIN = /\b[\w-]+\.(ru|com|net|org|io|to|me|cc|tv|xyz|site|online|info|in|co)\b/i;

/** @param {string} time */
function vttTime(time) {
	let t = time.trim().replace(',', '.');
	// SRT allows 1-digit hours; VTT wants hh:mm:ss.mmm or mm:ss.mmm
	if (/^\d:\d{2}:\d{2}/.test(t)) t = `0${t}`;
	if (!/\.\d{3}$/.test(t)) t = t.replace(/\.(\d{1,2})$/, (_m, ms) => `.${ms.padEnd(3, '0')}`);
	if (!t.includes('.')) t = `${t}.000`;
	return t;
}

/**
 * Normalises SRT or VTT text into clean WebVTT.
 * @param {string} text
 */
export function toVtt(text) {
	const blocks = text
		.replace(/^\uFEFF/, '')
		.replace(/\r\n?/g, '\n')
		.split(/\n{2,}/);

	/** @type {string[]} */
	const cues = [];
	for (const block of blocks) {
		const lines = block.split('\n').filter((line, index) => index > 0 || line.trim());
		const timingIndex = lines.findIndex((line) => TIMING.test(line));
		if (timingIndex === -1) continue; // header, NOTE, STYLE or a stray SRT index

		const [, start, end, settings] = /** @type {RegExpMatchArray} */ (
			lines[timingIndex].match(TIMING)
		);
		const body = lines
			.slice(timingIndex + 1)
			.map((line) =>
				line
					.replace(/\{\\[^}]*\}/g, '') // ASS override tags inside SRT ({\an8})
					.replace(/<\/?font[^>]*>/gi, '')
					.trimEnd()
			)
			.filter(Boolean);
		if (!body.length) continue;

		const plain = body.join(' ');
		if (AD_WORDS.test(plain) && DOMAIN.test(plain)) continue;

		const cueSettings =
			settings && /(align|line|position|size|vertical):/.test(settings) ? settings : '';
		cues.push(`${vttTime(start)} --> ${vttTime(end)}${cueSettings}\n${body.join('\n')}`);
	}

	return `WEBVTT\n\n${cues.join('\n\n')}\n`;
}

/** @type {Map<string, { at: number, vtt: string }>} */
const files = new Map();
/** @type {Map<string, Promise<string>>} */
const inflight = new Map();

/**
 * Fetches a subtitle file (cached), returning clean WebVTT.
 * @param {URL} target
 * @param {Record<string, string>} headers
 * @param {string} language
 * @returns {Promise<string>}
 */
export function subtitleFile(target, headers, language) {
	const key = target.href;
	const hit = files.get(key);
	if (hit && Date.now() - hit.at < FILE_TTL) return Promise.resolve(hit.vtt);

	const running = inflight.get(key);
	if (running) return running;

	const job = (async () => {
		const response = await fetchPublic(target, {
			headers: { 'User-Agent': UA, Referer: `${target.origin}/`, ...headers },
			signal: AbortSignal.timeout(12000)
		});
		if (!response.ok) throw new Error(`subtitle host answered ${response.status}`);

		const length = Number(response.headers.get('content-length'));
		if (length > MAX_FILE_BYTES) throw new Error('subtitle file too large');

		let bytes = new Uint8Array(await response.arrayBuffer());
		if (bytes.length > MAX_FILE_BYTES) throw new Error('subtitle file too large');
		// some hosts hand out gzipped .srt.gz files
		if (bytes[0] === 0x1f && bytes[1] === 0x8b) {
			const stream = new Blob([bytes]).stream().pipeThrough(new DecompressionStream('gzip'));
			bytes = new Uint8Array(await new Response(stream).arrayBuffer());
		}

		const text = decode(bytes, language);
		if (/^\s*</.test(text) && !/-->/.test(text))
			throw new Error('subtitle host returned a web page');

		const vtt = toVtt(text);
		if (!vtt.includes('-->')) throw new Error('no cues in subtitle file');

		files.delete(key);
		files.set(key, { at: Date.now(), vtt });
		if (files.size > FILE_CACHE_MAX)
			files.delete(/** @type {string} */ (files.keys().next().value));
		return vtt;
	})().finally(() => inflight.delete(key));

	inflight.set(key, job);
	return job;
}
