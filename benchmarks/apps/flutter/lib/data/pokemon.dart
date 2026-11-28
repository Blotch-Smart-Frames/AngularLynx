import '../config.dart';

/// A row of the list: what the list endpoint gives, `{ name, url }`, with the
/// sprite derived from the id (the original's `mapPokemonSummary`).
class Pokemon {
  const Pokemon({required this.id, required this.name, required this.imageUrl});

  /// A list result: its url looks like `.../pokemon/132/`, so the last
  /// segment is the id.
  factory Pokemon.fromSummary(Map<String, dynamic> json) {
    final segments = (json['url'] as String).split('/').where((s) => s.isNotEmpty);
    final id = segments.last;
    return Pokemon(id: id, name: json['name'] as String, imageUrl: '$sprites/$id.png');
  }

  /// A favourite: only its id is stored, and the row's detail fetch supplies
  /// the name (the original's `pokemonFromId`).
  factory Pokemon.fromId(String id) => Pokemon(id: id, name: '', imageUrl: '$sprites/$id.png');

  final String id;
  final String name;
  final String imageUrl;
}

/// What `GET /pokemon/{id}` gives that the app shows (the original's
/// `mapPokemonDetail`).
class PokemonDetail {
  const PokemonDetail({
    required this.id,
    required this.name,
    required this.imageUrl,
    required this.types,
    required this.height,
    required this.weight,
    required this.baseExperience,
    required this.abilities,
  });

  factory PokemonDetail.fromJson(Map<String, dynamic> json) {
    final sprites = json['sprites'] as Map<String, dynamic>;
    final artwork = (sprites['other'] as Map<String, dynamic>?)?['official-artwork'] as Map<String, dynamic>?;
    return PokemonDetail(
      id: '${json['id']}',
      name: json['name'] as String,
      imageUrl: (artwork?['front_default'] ?? sprites['front_default']) as String?,
      types: [for (final t in json['types'] as List<dynamic>) (t['type'] as Map<String, dynamic>)['name'] as String],
      height: json['height'] as int,
      weight: json['weight'] as int,
      baseExperience: (json['base_experience'] as int?) ?? 0,
      abilities: [
        for (final a in json['abilities'] as List<dynamic>) (a['ability'] as Map<String, dynamic>)['name'] as String,
      ],
    );
  }

  final String id;
  final String name;
  final String? imageUrl;
  final List<String> types;

  /// Decimetres, as the API gives it.
  final int height;

  /// Hectograms, as the API gives it.
  final int weight;
  final int baseExperience;
  final List<String> abilities;
}

String capitalize(String value) => value.isEmpty ? value : value[0].toUpperCase() + value.substring(1);

/// `#025`, as the rows and the sheet show an id.
String dexNumber(String id) => '#${id.padLeft(3, '0')}';
