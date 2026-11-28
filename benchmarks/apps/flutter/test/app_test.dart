import 'package:flutter_test/flutter_test.dart';
import 'package:launchperf_flutter/config.dart';
import 'package:launchperf_flutter/data/pokemon.dart';
import 'package:launchperf_flutter/screens/mount.dart';

void main() {
  group('Pokemon', () {
    test('takes its id from the list result url, and its sprite from the id', () {
      final pokemon = Pokemon.fromSummary({'name': 'pikachu', 'url': '$api/pokemon/25/'});
      expect(pokemon.id, '25');
      expect(pokemon.name, 'pikachu');
      expect(pokemon.imageUrl, '$sprites/25.png');
    });

    test('maps a detail, preferring the official artwork', () {
      final detail = PokemonDetail.fromJson({
        'id': 1,
        'name': 'bulbasaur',
        'height': 7,
        'weight': 69,
        'base_experience': 64,
        'sprites': {
          'front_default': 'front.png',
          'other': {
            'official-artwork': {'front_default': 'artwork.png'},
          },
        },
        'types': [
          {
            'slot': 1,
            'type': {'name': 'grass', 'url': ''},
          },
          {
            'slot': 2,
            'type': {'name': 'poison', 'url': ''},
          },
        ],
        'abilities': [
          {
            'ability': {'name': 'overgrow', 'url': ''},
            'is_hidden': false,
            'slot': 1,
          },
        ],
      });
      expect(detail.id, '1');
      expect(detail.imageUrl, 'artwork.png');
      expect(detail.types, ['grass', 'poison']);
      expect(detail.abilities, ['overgrow']);
    });

    test('pads the dex number to three digits', () {
      expect(dexNumber('7'), '#007');
      expect(dexNumber('151'), '#151');
    });
  });

  group('MountScreen.fromUri', () {
    test('reads the kind and the count', () {
      final screen = MountScreen.fromUri(Uri.parse('/bench/mount?kind=image&count=5000'));
      expect(screen.kind, MountKind.image);
      expect(screen.count, 5000);
    });

    test('falls back to 1500 views, as the other apps do', () {
      final screen = MountScreen.fromUri(Uri.parse('/bench/mount?kind=nope&count=-3'));
      expect(screen.kind, MountKind.view);
      expect(screen.count, 1500);
    });
  });
}
