#!/usr/bin/env node
// Builds games.json from three upstream sources:
//   1. GN-Math (freebuisness/assets zones.json)
//   2. ccported/games (one folder per game with ccported_game_data.json)
//   3. a456pur/seraph (parsed from games/index.html DOM)
//
// Run: `node build-games.js`. Re-run when you want to refresh.

const fs = require('fs');
const path = require('path');

const OUT = path.join(__dirname, 'games.json');

const GN_ZONES = 'https://cdn.jsdelivr.net/gh/freebuisness/assets@main/zones.json';
const GN_HTML = 'https://cdn.jsdelivr.net/gh/freebuisness/html@main';
const GN_COVER = 'https://cdn.jsdelivr.net/gh/freebuisness/covers@main';

const CC_TREE = 'https://api.github.com/repos/ccported/games/git/trees/main';
const CC_BASE = 'https://cdn.jsdelivr.net/gh/ccported/games@main';

const SERAPH_INDEX = 'https://raw.githubusercontent.com/a456pur/seraph/main/games/index.html';
const SERAPH_BASE = 'https://cdn.jsdelivr.net/gh/a456pur/seraph@main';

async function getJson(url) {
    const r = await fetch(url);
    if (!r.ok) throw new Error(`${r.status} ${url}`);
    return r.json();
}
async function getText(url) {
    const r = await fetch(url);
    if (!r.ok) throw new Error(`${r.status} ${url}`);
    return r.text();
}

async function pmap(items, limit, fn) {
    const out = new Array(items.length);
    const errors = [];
    let i = 0;
    const workers = Array.from({ length: limit }, async () => {
        while (true) {
            const idx = i++;
            if (idx >= items.length) return;
            let attempt = 0;
            while (attempt < 3) {
                try {
                    out[idx] = await fn(items[idx], idx);
                    break;
                } catch (e) {
                    attempt++;
                    if (attempt >= 3) {
                        errors.push({ item: items[idx], err: e.message });
                        out[idx] = null;
                    } else {
                        await new Promise(r => setTimeout(r, 500 * attempt));
                    }
                }
            }
            if (idx % 50 === 0) process.stdout.write('.');
        }
    });
    await Promise.all(workers);
    if (errors.length) console.log(`\n  ${errors.length} permanent failures, e.g.:`, errors.slice(0, 3));
    return out;
}

async function loadGnMath() {
    console.log('\n[gnmath] fetching zones.json...');
    const zones = await getJson(GN_ZONES);
    const games = [];
    for (const z of zones) {
        if (!z.name || !z.url) continue;
        const url = String(z.url).replace(/\{HTML_URL\}/g, GN_HTML).replace(/\{COVER_URL\}/g, GN_COVER);
        const cover = String(z.cover || '').replace(/\{HTML_URL\}/g, GN_HTML).replace(/\{COVER_URL\}/g, GN_COVER);
        if (!/^https?:\/\//.test(url)) continue;
        games.push({
            id: `gnmath-${z.id}`,
            name: z.name,
            source: 'gnmath',
            thumb: cover,
            url,
            tags: Array.isArray(z.special) ? z.special : [],
        });
    }
    console.log(`[gnmath] ${games.length} games`);
    return games;
}

async function loadCcported() {
    console.log('\n[ccported] fetching repo tree...');
    const tree = await getJson(`${CC_TREE}?recursive=1`);
    // Group files by top-level game_ folder
    const folderFiles = new Map(); // folder -> Set<filename>
    for (const n of tree.tree) {
        const m = n.path.match(/^(game_[^/]+)\/([^/]+)$/);
        if (!m || n.type !== 'blob') continue;
        if (!folderFiles.has(m[1])) folderFiles.set(m[1], new Set());
        folderFiles.get(m[1]).add(m[2]);
    }
    const folders = [...folderFiles.keys()];
    console.log(`[ccported] ${folders.length} folders, fetching metadata`);

    const results = await pmap(folders, 8, async (folder) => {
        const files = folderFiles.get(folder);
        let name, description = '', tags = [], thumbPath = '/thumb.jpg';
        if (files.has('ccported_game_data.json')) {
            const data = await getJson(`${CC_BASE}/${folder}/ccported_game_data.json`);
            if (data?.name) {
                name = data.name;
                description = data.description || '';
                tags = Array.isArray(data.tags) ? data.tags : [];
                thumbPath = data.thumb_path || '/thumb.jpg';
            }
        }
        if (!name && files.has('index.html')) {
            // Fall back to <title> tag
            const html = await getText(`${CC_BASE}/${folder}/index.html`);
            const m = html.match(/<title>([^<]*)<\/title>/i);
            if (m) {
                let t = m[1].trim();
                // Strip "| Unblocked on CCPorted" suffix and similar
                t = t.replace(/\s*[\|\-–—]\s*(Unblocked on\s+)?CC\s*Ported.*$/i, '').trim();
                t = t.replace(/\s*[\|\-–—]\s*Unblocked.*$/i, '').trim();
                if (t) name = t;
            }
        }
        if (!name) return null;
        const thumb = files.has('thumb.jpg')
            ? `${CC_BASE}/${folder}${thumbPath.startsWith('/') ? thumbPath : '/' + thumbPath}`
            : '';
        return {
            id: `ccported-${folder}`,
            name,
            source: 'ccported',
            thumb,
            url: `${CC_BASE}/${folder}/index.html`,
            description,
            tags,
        };
    });
    const games = results.filter(Boolean);
    console.log(`\n[ccported] ${games.length} games`);
    return games;
}

async function loadSeraph() {
    console.log('\n[seraph] fetching games index...');
    const html = await getText(SERAPH_INDEX);
    const games = [];
    // Match: <a ... href="X"> ... <div class="button" style="background-image: url('THUMB');" data-genre="GENRE"> <h2>NAME</h2>
    const pattern = /<a[^>]*href="([^"]+)"[^>]*>\s*<div class="button"\s+style="background-image:\s*url\('([^']+)'\);"[^>]*?(?:data-genre="([^"]*)")?[^>]*>\s*<h2>([^<]+)<\/h2>/g;
    let m;
    const seen = new Set();
    while ((m = pattern.exec(html)) !== null) {
        const href = m[1].trim();
        const thumbRel = m[2].trim();
        const genre = (m[3] || '').trim();
        const name = m[4].trim();
        if (!href || !name) continue;
        // Resolve thumbnail relative to /games/ → strip leading ../
        let thumb = thumbRel;
        if (thumb.startsWith('../')) thumb = thumb.slice(3);
        else if (thumb.startsWith('/')) thumb = thumb.slice(1);
        thumb = `${SERAPH_BASE}/${thumb}`;
        // Resolve game href relative to /games/
        let game = href;
        if (game.startsWith('/')) game = game.slice(1);
        const url = `${SERAPH_BASE}/games/${game}`;
        const id = `seraph-${href.replace(/[^a-z0-9]+/gi, '_').toLowerCase()}`;
        if (seen.has(id)) continue;
        seen.add(id);
        games.push({
            id,
            name,
            source: 'seraph',
            thumb,
            url,
            tags: genre ? [genre] : [],
        });
    }
    console.log(`[seraph] ${games.length} games`);
    return games;
}

(async () => {
    const t0 = Date.now();
    const [gn, cc, sp] = await Promise.all([
        loadGnMath().catch(e => { console.error('gnmath failed', e); return []; }),
        loadCcported().catch(e => { console.error('ccported failed', e); return []; }),
        loadSeraph().catch(e => { console.error('seraph failed', e); return []; }),
    ]);

    // Merge + de-duplicate by lowercase name (preferring earlier source order: gnmath > ccported > seraph)
    const all = [...gn, ...cc, ...sp];
    const byKey = new Map();
    for (const g of all) {
        const key = g.name.trim().toLowerCase();
        if (!byKey.has(key)) byKey.set(key, g);
    }
    const merged = [...byKey.values()].sort((a, b) => a.name.localeCompare(b.name));

    const payload = {
        generated_at: new Date().toISOString(),
        sources: { gnmath: gn.length, ccported: cc.length, seraph: sp.length, deduped_total: merged.length },
        games: merged,
    };
    fs.writeFileSync(OUT, JSON.stringify(payload, null, 0));
    console.log(`\nWrote ${OUT} (${merged.length} games, ${(Date.now() - t0) / 1000}s)`);
})();
