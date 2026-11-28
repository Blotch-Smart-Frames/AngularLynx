import 'package:material_ui/material_ui.dart';

import '../config.dart';
import '../data/pokemon.dart';
import '../data/pokemon_api.dart';
import '../startup.dart';
import '../widgets/pokemon_list.dart';
import 'tabs.dart';

/// The Pokédex tab: every Pokémon, a page of 50 at a time, the next page
/// loading as the end of the list comes within half a screen (the original's
/// `useInfiniteQuery`).
class PokedexScreen extends StatefulWidget {
  const PokedexScreen({super.key});

  @override
  State<PokedexScreen> createState() => _PokedexScreenState();
}

enum _Status { loading, error, success }

class _PokedexScreenState extends State<PokedexScreen> {
  final _pages = <List<Pokemon>>[];
  var _status = _Status.loading;
  var _fetchingNextPage = false;

  /// The list endpoint has no more once a page comes back short.
  bool get _hasNextPage => _pages.isEmpty || _pages.last.length == pageSize;

  @override
  void initState() {
    super.initState();
    _fetchPage(1);
  }

  void _loadNextPage() {
    if (_status != _Status.success || !_hasNextPage || _fetchingNextPage) return;
    setState(() => _fetchingNextPage = true);
    _fetchPage(_pages.length + 1);
  }

  Future<void> _fetchPage(int page) async {
    try {
      final rows = await fetchPage(page);
      if (!mounted) return;
      // Every row's detail, as soon as its page arrives, as the other apps
      // fetch them: the original's FlatList renders rows well ahead of the
      // screen (its window covers the whole page), but ListView.builder
      // builds a row only as it comes within its cache extent of the screen,
      // so without this each row would fetch its types while the list
      // scrolls.
      for (final row in rows) {
        PokemonDetails.instance.get(row.id);
      }
      setState(() {
        _pages.add(rows);
        _status = _Status.success;
        _fetchingNextPage = false;
      });
      if (page == 1) {
        // Fully drawn: after the frame that builds and paints the first
        // page's rows, as the original reports TTFD in a requestAnimationFrame
        // after the commit that renders them, not when the data arrives. The
        // setState above schedules that frame, and a post-frame callback
        // added now runs at its end.
        WidgetsBinding.instance.addPostFrameCallback((_) => AppStartup.reportFullyDrawn());
      }
    } catch (_) {
      if (!mounted) return;
      // A failed next page leaves the loaded ones, as React Query does.
      setState(() {
        if (page == 1) _status = _Status.error;
        _fetchingNextPage = false;
      });
    }
  }

  @override
  Widget build(BuildContext context) => TabScreenFrame(
    child: PokemonList(
      data: [for (final page in _pages) ...page],
      headerText: 'Pokédex',
      emptyState: switch (_status) {
        _Status.loading => ListEmptyState.loading,
        _Status.error => ListEmptyState.error,
        _Status.success => ListEmptyState.empty,
      },
      emptyMessage: 'No Pokémon found',
      onEndReached: _loadNextPage,
      fetchingNextPage: _fetchingNextPage,
    ),
  );
}
