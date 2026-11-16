// Serves the recorded PokeAPI responses and images (record.mjs) to the
// benchmark apps, in the shape of pokeapi.co and raw.githubusercontent.com:
//
//   GET /api/v2/pokemon?limit=50&offset=0   a page of { name, url }
//   GET /api/v2/pokemon/:id                 one Pokémon (the fields the apps read)
//   GET /sprites/pokemon/:id.png            the list's sprite
//   GET /sprites/pokemon/other/official-artwork/:id.png   the detail screen's image
//
// Every URL in a response points back at this server, at the host the app
// asked for, so a phone on the LAN and a simulator on localhost both work.
//
//   node server.mjs [--port 8787]
import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';
import { dirname, join, normalize } from 'node:path';
import { fileURLToPath } from 'node:url';
import { networkInterfaces } from 'node:os';

const here = dirname(fileURLToPath(import.meta.url));
const portFlag = process.argv.indexOf('--port');
const port = Number(portFlag > 0 ? process.argv[portFlag + 1] : (process.env.PORT ?? 8787));
const { results, details } = JSON.parse(await readFile(join(here, 'data/pokemon.json'), 'utf8'));

const json = (response, status, body) => {
  response.writeHead(status, {
    'Content-Type': 'application/json; charset=utf-8',
    // Every launch asks again, whatever HTTP cache the framework's networking
    // keeps: a cached response would leave the network out for some apps only.
    'Cache-Control': 'no-store',
    'Access-Control-Allow-Origin': '*',
  });
  response.end(JSON.stringify(body));
};

const rewrite = (url, origin) =>
  url?.replace('https://raw.githubusercontent.com/PokeAPI/sprites/master/sprites', `${origin}/sprites`) ?? null;

let requests = 0;
const server = createServer(async (request, response) => {
  requests++;
  const origin = `http://${request.headers.host}`;
  const url = new URL(request.url, origin);
  const path = url.pathname.replace(/\/+$/, '');
  if (path === '/api/v2/pokemon') {
    const limit = Number(url.searchParams.get('limit') ?? 20);
    const offset = Number(url.searchParams.get('offset') ?? 0);
    const page = results.slice(offset, offset + limit);
    const next = offset + limit < results.length ? `${origin}/api/v2/pokemon?offset=${offset + limit}&limit=${limit}` : null;
    const previous = offset > 0 ? `${origin}/api/v2/pokemon?offset=${Math.max(0, offset - limit)}&limit=${limit}` : null;
    return json(response, 200, {
      count: results.length,
      next,
      previous,
      results: page.map(({ name, id }) => ({ name, url: `${origin}/api/v2/pokemon/${id}/` })),
    });
  }
  const detail = /^\/api\/v2\/pokemon\/([^/]+)$/.exec(path);
  if (detail) {
    const dto =
      details[detail[1]] ?? Object.values(details).find((entry) => entry.name === detail[1]);
    if (!dto) return json(response, 404, { detail: 'Not found.' });
    return json(response, 200, {
      ...dto,
      sprites: {
        front_default: rewrite(dto.sprites.front_default, origin),
        other: { 'official-artwork': { front_default: rewrite(dto.sprites.other['official-artwork'].front_default, origin) } },
      },
    });
  }
  if (path.startsWith('/sprites/') && path.endsWith('.png')) {
    const file = normalize(join(here, 'data', path));
    if (!file.startsWith(join(here, 'data/sprites'))) return json(response, 400, {});
    try {
      const bytes = await readFile(file);
      response.writeHead(200, {
        'Content-Type': 'image/png',
        'Content-Length': bytes.length,
        // raw.githubusercontent.com's own.
        'Cache-Control': 'max-age=300',
      });
      return response.end(bytes);
    } catch {
      return json(response, 404, {});
    }
  }
  return json(response, 404, {});
});

server.listen(port, '0.0.0.0', () => {
  const lan = Object.values(networkInterfaces())
    .flat()
    .find((entry) => entry?.family === 'IPv4' && !entry.internal)?.address;
  console.log(`Fixture server on http://localhost:${port}${lan ? ` and http://${lan}:${port}` : ''}`);
});
process.on('SIGINT', () => {
  console.log(`${requests} requests served`);
  process.exit(0);
});
