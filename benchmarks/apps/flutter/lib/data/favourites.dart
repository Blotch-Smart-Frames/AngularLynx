import 'package:flutter/foundation.dart';
import 'package:shared_preferences/shared_preferences.dart';

/// The favourited ids, kept across launches: zustand's `persist` over
/// AsyncStorage in the original, `shared_preferences` (`NSUserDefaults` on
/// iOS) here, under the same key. Like the original's store, it starts empty
/// and fills in once storage has been read.
class Favourites extends ChangeNotifier {
  Favourites._() {
    _loaded = _load();
  }

  static final instance = Favourites._();

  static const _key = 'favourites';

  final _ids = <String>{};

  /// The first read of storage. Writes wait for it, so a toggle made while it
  /// runs can't store a set without the ids still being read.
  late final Future<void> _loaded;

  /// The ids in ascending order, as the original lists them: it keeps them as
  /// a JavaScript object's keys, which run in numeric order for ids.
  List<String> get ids => _ids.toList()..sort((a, b) => int.parse(a).compareTo(int.parse(b)));

  bool contains(String id) => _ids.contains(id);

  void toggle(String id) {
    if (!_ids.remove(id)) _ids.add(id);
    notifyListeners();
    _save();
  }

  /// Stores the whole set once storage has been read. Every pending save
  /// resumes in order after that read and writes the set as it is then, so the
  /// last one stores the latest set.
  Future<void> _save() async {
    await _loaded;
    await SharedPreferencesAsync().setStringList(_key, _ids.toList());
  }

  Future<void> _load() async {
    List<String>? stored;
    try {
      stored = await SharedPreferencesAsync().getStringList(_key);
    } catch (_) {
      // A value that can't be read (one of another type, say) counts as no
      // favourites, so the next toggle's save replaces it rather than waiting
      // on a read that failed.
      return;
    }
    if (stored == null || stored.isEmpty) return;
    _ids.addAll(stored);
    notifyListeners();
  }
}
