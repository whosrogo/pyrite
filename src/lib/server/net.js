/**
 * Shared guards for routes that fetch a URL on the browser's behalf (the playback
 * proxy, subtitle files): only public http(s) hosts, never this machine or the LAN.
 */
import { lookup } from 'node:dns/promises';
import { isIP } from 'node:net';

/** @param {string} hostname */
export function isPrivateHost(hostname) {
	const host = hostname.toLowerCase().replace(/^\[|\]$/g, '');

	if (host.includes(':')) {
		return host === '::' || host === '::1' || /^(fc|fd|fe80:|::ffff:)/.test(host);
	}

	return (
		host === 'localhost' ||
		host.endsWith('.local') ||
		host.endsWith('.localhost') ||
		/^(0|10|127)\./.test(host) ||
		/^169\.254\./.test(host) ||
		/^192\.168\./.test(host) ||
		/^172\.(1[6-9]|2\d|3[01])\./.test(host) ||
		/^100\.(6[4-9]|[7-9]\d|1[01]\d|12[0-7])\./.test(host)
	);
}

/**
 * @param {string | null} raw
 * @returns {URL | null}
 */
export function parsePublicUrl(raw) {
	if (!raw) return null;
	try {
		const target = new URL(raw);
		if (target.protocol !== 'https:' && target.protocol !== 'http:') return null;
		if (isPrivateHost(target.hostname)) return null;
		return target;
	} catch {
		return null;
	}
}

// a hostname can look public yet resolve to 127.0.0.1 or a LAN address, so check
// what it actually resolves to. Cached briefly: HLS fetches hundreds of segments.
const DNS_TTL = 60 * 1000;
/** @type {Map<string, { at: number, ok: boolean }>} */
const resolved = new Map();

/** @param {string} hostname */
async function resolvesPublic(hostname) {
	const host = hostname.replace(/^\[|\]$/g, '');
	if (isIP(host)) return !isPrivateHost(host);
	if (isPrivateHost(host)) return false;

	const hit = resolved.get(host);
	if (hit && Date.now() - hit.at < DNS_TTL) return hit.ok;

	let ok = false;
	try {
		const addresses = await lookup(host, { all: true });
		ok = addresses.length > 0 && addresses.every(({ address }) => !isPrivateHost(address));
	} catch {
		ok = false;
	}
	resolved.set(host, { at: Date.now(), ok });
	if (resolved.size > 2000) resolved.delete(/** @type {string} */ (resolved.keys().next().value));
	return ok;
}

const MAX_REDIRECTS = 5;

/**
 * fetch() for URLs that came from outside (scraped streams, captions). Follows
 * redirects by hand so every hop gets the same public-host check as the first one.
 * The returned response's `url` is the final hop, for resolving relative links.
 *
 * @param {URL} target
 * @param {RequestInit} [init]
 * @returns {Promise<Response>}
 */
export async function fetchPublic(target, init = {}) {
	let current = target;
	for (let hop = 0; ; hop++) {
		if (!(await resolvesPublic(current.hostname))) {
			throw new Error(`blocked non-public host ${current.hostname}`);
		}

		const response = await fetch(current, { ...init, redirect: 'manual' });
		const location = response.headers.get('location');
		if (response.status < 300 || response.status >= 400 || !location) return response;

		response.body?.cancel();
		if (hop >= MAX_REDIRECTS) throw new Error('too many redirects');
		const next = parsePublicUrl(new URL(location, current).href);
		if (!next) throw new Error('redirected to a non-public host');
		current = next;
	}
}

const BLOCKED_HEADERS = new Set(['host', 'content-length', 'connection', 'range', 'cookie']);

/**
 * Parses the `headers` JSON a stream or caption needs upstream, dropping unsafe ones.
 * @param {string | null} raw
 * @returns {Record<string, string>}
 */
export function parseForwardHeaders(raw) {
	if (!raw) return {};
	try {
		const parsed = JSON.parse(raw);
		return Object.fromEntries(
			Object.entries(parsed).filter(
				([key, value]) => typeof value === 'string' && !BLOCKED_HEADERS.has(key.toLowerCase())
			)
		);
	} catch {
		return {};
	}
}
