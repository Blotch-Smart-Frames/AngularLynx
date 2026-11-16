// Records the PokeAPI responses and images the benchmark apps load, so the
// fixture server (server.mjs) can serve them from this machine: the apps then
// spend the same few milliseconds on the network in every run, and "fully
// drawn" measures the framework, not pokeapi.co.
//
// Run once: `node record.mjs`. It writes data/pokemon.json (committed) and
// the images under data/sprites/pokemon (the 1 MB of list sprites are committed, the 40 MB of detail-screen artwork is git-ignored).
import { mkdir, writeFile, access } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const API = 'https://pokeapi.co/api/v2';
const SPRITES = 'https://raw.githubusercontent.com/PokeAPI/sprites/master/sprites/pokemon';
// Six pages of the app's 50: enough for the first screen and a long scripted
// scroll. The server ends the list here, as the real API ends at its count.
const COUNT = Number(process.env.COUNT ?? 300);

const getJson = async (url) => {
  for (let attempt = 1; ; attempt++) {
    const response = await fetch(url);
    if (response.ok) return response.json();
    if (attempt === 3) throw new Error(`${url}: ${response.status}`);
  }
};

const download = async (url, file) => {
  try {
    await access(file);
    return; // Already recorded.
  } catch {}
  const response = await fetch(url);
  if (!response.ok) throw new Error(`${url}: ${response.status}`);
  await mkdir(dirname(file), { recursive: true });
  await writeFile(file, Buffer.from(await response.arrayBuffer()));
};

const list = await getJson(`${API}/pokemon?limit=${COUNT}&offset=0`);
const details = {};
// A few at a time, to be polite to PokeAPI.
const queue = list.results.map((entry) => entry.url);
await Promise.all(
  Array.from({ length: 8 }, async () => {
    for (let url; (url = queue.shift()); ) {
      const dto = await getJson(url);
      // Only the fields the apps read (PokemonDetailDto in the React Native
      // app). The full response is ~200 KB of moves and game indices no
      // screen shows.
      details[dto.id] = {
        id: dto.id,
        name: dto.name,
        height: dto.height,
        weight: dto.weight,
        base_experience: dto.base_experience,
        sprites: {
          front_default: dto.sprites.front_default,
          other: {
            'official-artwork': {
              front_default: dto.sprites.other?.['official-artwork']?.front_default ?? null,
            },
          },
        },
        types: dto.types,
        abilities: dto.abilities,
      };
      await download(`${SPRITES}/${dto.id}.png`, join(here, 'data/sprites/pokemon', `${dto.id}.png`));
      await download(
        `${SPRITES}/other/official-artwork/${dto.id}.png`,
        join(here, 'data/sprites/pokemon/other/official-artwork', `${dto.id}.png`),
      );
    }
  }),
);

await writeFile(
  join(here, 'data/pokemon.json'),
  `${JSON.stringify({ results: list.results.map(({ name, url }) => ({ name, id: Number(url.split('/').filter(Boolean).pop()) })), details }, null, 1)}\n`,
);
console.log(`Recorded ${list.results.length} Pokémon`);
