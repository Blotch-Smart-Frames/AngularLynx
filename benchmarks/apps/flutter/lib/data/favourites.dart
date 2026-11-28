import 'package:flutter/foundation.dart';
import 'package:shared_preferences/shared_preferences.dart';

/// The favourited ids, kept across launches: zustand's `persist` over
/// AsyncStorage in the original, `shared_preferences` (`NSUserDefaults` on
/// iOS) here, under the same key. Like the original's store, it starts empty
/// and fills in once storage has been read.
class Favourites extends ChangeNotifier {
  Favourites._() {
    _load();
  }

  static final instance = Favourites._();

  static const _key = 'favourites';

  final _ids = <String>{};

  /// The ids in ascending order, as the original lists them: it keeps them as
  /// a JavaScript object's keys, which run in numeric order for ids.
  List<String> get ids => _ids.toList()..sort((a, b) => int.parse(a).compareTo(int.parse(b)));

  bool contains(String id) => _ids.contains(id);

  void toggle(String id) {
    if (!_ids.remove(id)) _ids.add(id);
    notifyListeners();
    SharedPreferencesAsync().setStringList(_key, _ids.toList());
  }

  Future<void> _load() async {
    final stored = await SharedPreferencesAsync().getStringList(_key);
    if (stored == null || stored.isEmpty) return;
    _ids.addAll(stored);
    notifyListeners();
  }
}
