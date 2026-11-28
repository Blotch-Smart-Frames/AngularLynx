import 'dart:async';
import 'dart:convert';

import 'package:flutter/foundation.dart';
import 'package:http/http.dart' as http;

import '../config.dart';
import 'pokemon.dart';

/// The original's axios client: the fixture server's API, a 10 s timeout.
/// `package:http`'s default client, which is `dart:io`'s `HttpClient` on iOS,
/// is what a Flutter app gets unless it adds a native one.
final _client = http.Client();

/// GETs `{API}{path}` as JSON, retrying a failure twice after 1 s and then
/// 2 s, as React Query's defaults in the original do (`retry: 2` and its
/// exponential delay).
Future<Map<String, dynamic>> _getJson(String path) async {
  for (var attempt = 0; ; attempt++) {
    try {
      final response = await _client.get(Uri.parse('$api$path')).timeout(const Duration(seconds: 10));
      if (response.statusCode != 200) throw http.ClientException('HTTP ${response.statusCode}', response.request?.url);
      // The fixtures hold names such as "Pokédex": decode the body as UTF-8
      // whatever the response's charset says.
      return jsonDecode(utf8.decode(response.bodyBytes)) as Map<String, dynamic>;
    } catch (_) {
      if (attempt == 2) rethrow;
      await Future<void>.delayed(Duration(milliseconds: 1000 * (1 << attempt)));
    }
  }
}

/// A page of the list: `GET /pokemon?limit=50&offset=(page-1)*50`.
Future<List<Pokemon>> fetchPage(int page) async {
  final json = await _getJson('/pokemon?limit=$pageSize&offset=${(page - 1) * pageSize}');
  return [for (final result in json['results'] as List<dynamic>) Pokemon.fromSummary(result as Map<String, dynamic>)];
}

/// One Pokémon's detail as it loads, for the rows and the sheet that show it.
class DetailState {
  const DetailState({this.data, this.error = false});

  final PokemonDetail? data;
  final bool error;

  bool get loading => data == null && !error;
}

/// Each Pokémon's detail, fetched once and shared by every row and sheet
/// that shows it: React Query's `useQuery(['pokemon', 'detail', id])` in the
/// original, stale after 5 minutes. A row listens to its id's notifier, so a
/// detail arriving rebuilds only the rows showing it.
class PokemonDetails {
  PokemonDetails._();

  static final instance = PokemonDetails._();

  static const _staleAfter = Duration(minutes: 5);

  final _entries = <String, ValueNotifier<DetailState>>{};
  final _fetchedAt = <String, DateTime>{};
  final _inFlight = <String>{};

  /// The id's detail, fetching it if it hasn't been or has gone stale. A
  /// stale one keeps showing while it refetches, as React Query's does.
  ValueListenable<DetailState> get(String id) {
    final entry = _entries.putIfAbsent(id, () => ValueNotifier(const DetailState()));
    final fetchedAt = _fetchedAt[id];
    final stale = fetchedAt == null || DateTime.now().difference(fetchedAt) > _staleAfter;
    if (stale && !_inFlight.contains(id)) _fetch(id, entry);
    return entry;
  }

  Future<void> _fetch(String id, ValueNotifier<DetailState> entry) async {
    _inFlight.add(id);
    try {
      final json = await _getJson('/pokemon/$id');
      _fetchedAt[id] = DateTime.now();
      entry.value = DetailState(data: PokemonDetail.fromJson(json));
    } catch (_) {
      // A failed refetch keeps the detail it had, as React Query does.
      if (entry.value.data == null) entry.value = const DetailState(error: true);
    } finally {
      _inFlight.remove(id);
    }
  }
}
