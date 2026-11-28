import 'dart:async';

import 'package:flutter_test/flutter_test.dart';
import 'package:launchperf_flutter/data/favourites.dart';
import 'package:shared_preferences_platform_interface/in_memory_shared_preferences_async.dart';
import 'package:shared_preferences_platform_interface/shared_preferences_async_platform_interface.dart';
import 'package:shared_preferences_platform_interface/types.dart';

/// In-memory storage whose reads wait until [release] is called, so a test can
/// act while the first read is still pending.
final class _SlowReads extends InMemorySharedPreferencesAsync {
  _SlowReads(super.data) : super.withData();

  final _gate = Completer<void>();

  void release() => _gate.complete();

  @override
  Future<List<String>?> getStringList(String key, SharedPreferencesOptions options) async {
    await _gate.future;
    return super.getStringList(key, options);
  }
}

void main() {
  test('a toggle made while the stored ids are read keeps them in storage', () async {
    final storage = _SlowReads({
      'favourites': ['1'],
    });
    SharedPreferencesAsyncPlatform.instance = storage;

    final favourites = Favourites.instance;
    favourites.toggle('2');
    expect(favourites.ids, ['2']);

    storage.release();
    await pumpEventQueue();

    expect(favourites.ids, ['1', '2']);
    expect(await storage.getStringList('favourites', const SharedPreferencesOptions()), unorderedEquals(['1', '2']));
  });
}
