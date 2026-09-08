import { readFile, writeFile, mkdir } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const html = await readFile(path.join(root, "index.html"), "utf8");

const links = [...html.matchAll(/data-roblox="([^"]+)"/g)].map((m) => m[1]);
const placeIds = [...new Set(links.map(placeIdFrom).filter(Boolean))];
if (!placeIds.length) {
  console.log("no data-roblox cards found in index.html");
  process.exit(0);
}

function placeIdFrom(s) {
  const m = String(s).match(/games\/(\d+)/) || String(s).match(/^(\d+)$/);
  return m ? m[1] : null;
}

async function getJson(url) {
  const r = await fetch(url, { headers: { accept: "application/json" } });
  if (!r.ok) throw new Error(`${r.status} ${url}`);
  return r.json();
}

async function download(url, file) {
  const r = await fetch(url);
  if (!r.ok) throw new Error(`${r.status} ${url}`);
  await writeFile(file, Buffer.from(await r.arrayBuffer()));
}

const universeOf = {};
for (const p of placeIds) {
  const { universeId } = await getJson(`https://apis.roblox.com/universes/v1/places/${p}/universe`);
  universeOf[p] = universeId;
}
const ids = [...new Set(Object.values(universeOf))].join(",");

const [games, votes, icons, thumbs] = await Promise.all([
  getJson(`https://games.roblox.com/v1/games?universeIds=${ids}`),
  getJson(`https://games.roblox.com/v1/games/votes?universeIds=${ids}`),
  getJson(`https://thumbnails.roblox.com/v1/games/icons?universeIds=${ids}&size=512x512&format=Png&isCircular=false`),
  getJson(`https://thumbnails.roblox.com/v1/games/multiget/thumbnails?universeIds=${ids}&size=768x432&format=Png&countPerUniverse=1`),
]);

const byId = (arr, key) => Object.fromEntries(arr.map((x) => [x[key], x]));
const gameById = byId(games.data, "id");
const voteById = byId(votes.data, "id");
const iconById = byId(icons.data, "targetId");
const thumbById = byId(thumbs.data, "universeId");

const imgDir = path.join(root, "assets", "img", "roblox");
await mkdir(imgDir, { recursive: true });

const out = {};
for (const p of placeIds) {
  const u = universeOf[p];
  const g = gameById[u];
  if (!g) { console.warn(`no game data for place ${p}`); continue; }
  const v = voteById[u] || { upVotes: 0, downVotes: 0 };

  let icon = null, thumb = null;
  const iconUrl = iconById[u]?.imageUrl;
  const thumbUrl = thumbById[u]?.thumbnails?.[0]?.imageUrl;
  try { if (iconUrl) { await download(iconUrl, path.join(imgDir, `${p}-icon.png`)); icon = `assets/img/roblox/${p}-icon.png`; } }
  catch (e) { console.warn(`icon failed for ${p}: ${e.message}`); }
  try { if (thumbUrl) { await download(thumbUrl, path.join(imgDir, `${p}-thumb.png`)); thumb = `assets/img/roblox/${p}-thumb.png`; } }
  catch (e) { console.warn(`thumbnail failed for ${p}: ${e.message}`); }

  out[p] = {
    placeId: Number(p),
    universeId: u,
    name: g.name,
    description: g.description || "",
    creator: g.creator?.name || "",
    creatorType: g.creator?.type || "",
    playing: g.playing,
    visits: g.visits,
    favorites: g.favoritedCount,
    maxPlayers: g.maxPlayers,
    genre: g.genre,
    created: g.created,
    updated: g.updated,
    upVotes: v.upVotes,
    downVotes: v.downVotes,
    icon,
    thumbnail: thumb,
    url: `https://www.roblox.com/games/${p}`,
  };
  console.log(`ok  ${p}  ${g.name}`);
}

const dataDir = path.join(root, "data");
await mkdir(dataDir, { recursive: true });
const body = JSON.stringify({ fetchedAt: new Date().toISOString(), games: out }, null, 2);

await writeFile(path.join(dataDir, "games.js"), `window.ROBLOX_GAMES = ${body};\n`);
await writeFile(path.join(dataDir, "games.json"), body + "\n");
console.log(`wrote data/games.js (${Object.keys(out).length} games)`);
