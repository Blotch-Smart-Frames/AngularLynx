import { expect, test } from 'vitest';
import { SPRITES } from './config';
import { capitalize, idFromResourceUrl, mapPokemonSummary } from './pokemon';

test('derives the id and the fixture server sprite from a list entry', () => {
  expect(idFromResourceUrl('http://localhost:8787/api/v2/pokemon/132/')).toBe('132');
  expect(mapPokemonSummary({ name: 'ditto', url: 'http://x/api/v2/pokemon/132/' })).toEqual({
    id: '132',
    name: 'ditto',
    imageUrl: `${SPRITES}/132.png`,
  });
});

test('capitalizes names, leaving an empty one alone', () => {
  expect(capitalize('bulbasaur')).toBe('Bulbasaur');
  expect(capitalize('')).toBe('');
});
