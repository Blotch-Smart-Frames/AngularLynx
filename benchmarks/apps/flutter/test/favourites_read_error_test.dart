// Its own file, so Favourites.instance is made fresh here: `flutter test` runs
// each file in its own isolate.
import 'package:flutter_test/flutter_test.dart';
import 'package:launchperf_flutter/data/favourites.dart';
import 'package:shared_preferences_platform_interface/in_memory_shared_preferences_async.dart';
import 'package:shared_preferences_platform_interface/shared_preferences_async_platform_interface.dart';
import 'package:shared_preferences_platform_interface/types.dart';

void main() {
  test('a stored value that can\'t be read as ids is replaced by the next toggle', () async {
    // A string where the list should be: getStringList throws on it.
    final storage = InMemorySharedPreferencesAsync.withData({'favourites': 'not a list'});
    SharedPreferencesAsyncPlatform.instance = storage;

    final favourites = Favourites.instance;
    await pumpEventQueue();
    favourites.toggle('7');
    await pumpEventQueue();

    expect(favourites.ids, ['7']);
    expect(await storage.getStringList('favourites', const SharedPreferencesOptions()), ['7']);
  });
}
