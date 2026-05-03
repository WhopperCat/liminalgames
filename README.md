# liminalgames

A single-file game launcher that aggregates 1,200+ games from three upstream catalogs:

- [GN-Math](https://cdn.jsdelivr.net/gh/freebuisness/assets@main/zones.json) (`gnmath`)
- [`ccported/games`](https://github.com/ccported/games) (`ccported`)
- [`a456pur/seraph`](https://github.com/a456pur/seraph) (`seraph`)

No manual curation, no categories — search by name, filter by source.

## Live launcher

The HTML file at `index.html` is fully self-contained. Open it directly from jsdelivr's CDN — it'll fetch `games.json` from the same place, so anything you push to `main` is automatically live within ~12h (jsdelivr's cache TTL on `@main`):

```
https://cdn.jsdelivr.net/gh/WhopperCat/liminalgames@main/index.html
```

Or host `index.html` anywhere else (GitHub Pages, Netlify, your own server) — it'll still pull `games.json` from the CDN, so the games stay fresh without redeploying.

To force-refresh the CDN early, hit `https://purge.jsdelivr.net/gh/WhopperCat/liminalgames@main/games.json` once after pushing.

## Files

| File | Purpose |
|---|---|
| `index.html` | The launcher. Fetches `games.json` from jsdelivr (or local with `?dev`). |
| `games.json` | Baked manifest of every game. Regenerate to refresh. |
| `build-games.js` | Node script that pulls all three sources and writes `games.json`. |
| `serve.js` | Tiny dev server (`node serve.js` → http://localhost:8765/?dev). |

## Refreshing the library

```sh
node build-games.js
git add games.json && git commit -m "refresh games.json" && git push
```

Pulls the latest from all three upstream catalogs (~15s), overwrites `games.json`, and once pushed, the live launcher picks it up on the next jsdelivr cache miss (or instantly if you purge).

Game thumbnails and play URLs themselves point at jsdelivr too, so no assets need to be re-hosted in this repo.

## Local development

```sh
node serve.js
```

Then open <http://localhost:8765/?dev>. The `?dev` query forces the launcher to load the **local** `games.json` instead of the CDN copy, so you can test changes before pushing.

## Legacy files

`Liminalxgn.html` and `handpicked-games (23).html` are the previous hand-curated builds, kept around for reference. They're no longer wired into anything.
