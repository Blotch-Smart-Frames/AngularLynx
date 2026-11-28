import 'package:cupertino_ui/cupertino_ui.dart';
import 'package:material_ui/material_ui.dart';

import '../data/pokemon.dart';
import '../data/pokemon_api.dart';
import '../screens/pokemon_sheet.dart';
import '../theme.dart';
import 'common.dart';

/// What the list shows when it has no rows (the original's `ListEmpty`).
enum ListEmptyState { loading, error, empty }

/// The original's `PokemonList`, a `FlatList`: `ListView.builder` builds the
/// rows as they come near the screen, a header above them and a spinner
/// below while the next page loads. `onEndReached` fires when the end comes
/// within half a screen (`onEndReachedThreshold={0.5}`).
class PokemonList extends StatelessWidget {
  const PokemonList({
    super.key,
    required this.data,
    required this.headerText,
    required this.emptyState,
    required this.emptyMessage,
    this.onEndReached,
    this.fetchingNextPage = false,
  });

  final List<Pokemon> data;
  final String headerText;
  final ListEmptyState emptyState;
  final String emptyMessage;
  final VoidCallback? onEndReached;
  final bool fetchingNextPage;

  @override
  Widget build(BuildContext context) {
    // The header, then the rows, or the empty state in place of them, then the
    // footer spinner while a next page loads.
    final rows = data.isEmpty ? 1 : data.length;
    final count = 1 + rows + (fetchingNextPage ? 1 : 0);
    return NotificationListener<ScrollNotification>(
      onNotification: (notification) {
        final metrics = notification.metrics;
        if (onEndReached != null && metrics.extentAfter < metrics.viewportDimension * 0.5) onEndReached!();
        return false;
      },
      child: ListView.builder(
        padding: const EdgeInsets.all(16),
        itemCount: count,
        itemBuilder: (context, index) {
          if (index == 0) {
            return Padding(
              padding: const EdgeInsets.only(bottom: 8),
              child: Text(
                headerText,
                style: const TextStyle(fontSize: 16, fontWeight: FontWeight.bold, color: Colors.black),
              ),
            );
          }
          final row = index - 1;
          if (row < rows) {
            if (data.isEmpty) return _ListEmpty(state: emptyState, message: emptyMessage);
            return PokemonItem(key: ValueKey(data[row].id), pokemon: data[row], index: row);
          }
          // The original's footer, a small ActivityIndicator.
          return const Padding(padding: EdgeInsets.symmetric(vertical: 16), child: CupertinoActivityIndicator());
        },
      ),
    );
  }
}

class _ListEmpty extends StatelessWidget {
  const _ListEmpty({required this.state, required this.message});

  final ListEmptyState state;
  final String message;

  @override
  Widget build(BuildContext context) => Padding(
    padding: const EdgeInsets.only(top: 64),
    child: Center(
      child: switch (state) {
        ListEmptyState.loading => const LargeSpinner(),
        ListEmptyState.error => const Text('Failed to load', style: TextStyle(color: AppColors.textSecondary)),
        ListEmptyState.empty => Text(message, style: const TextStyle(color: AppColors.textSecondary)),
      },
    ),
  );
}

/// A row: the sprite, "{n}. {Name}" over "#{id}", one dot per type, and the
/// heart (the original's `PokemonItem`). It shows its Pokémon's detail from
/// `PokemonDetails`, fetching it if nothing has yet, as each row's `useQuery`
/// does. Tapping it opens the detail sheet.
class PokemonItem extends StatefulWidget {
  const PokemonItem({super.key, required this.pokemon, required this.index});

  final Pokemon pokemon;
  final int index;

  @override
  State<PokemonItem> createState() => _PokemonItemState();
}

class _PokemonItemState extends State<PokemonItem> {
  /// Pressed: the row fades, as the original's `TouchableOpacity` does.
  bool _pressed = false;

  void _setPressed(bool pressed) => setState(() => _pressed = pressed);

  @override
  Widget build(BuildContext context) {
    final pokemon = widget.pokemon;
    return GestureDetector(
      behavior: HitTestBehavior.opaque,
      onTapDown: (_) => _setPressed(true),
      onTapUp: (_) => _setPressed(false),
      onTapCancel: () => _setPressed(false),
      onTap: () => showPokemonSheet(context, pokemon.id),
      child: AnimatedOpacity(
        // TouchableOpacity's activeOpacity, and its 150 ms fade.
        opacity: _pressed ? 0.2 : 1,
        duration: const Duration(milliseconds: 150),
        child: Container(
          margin: const EdgeInsets.only(bottom: 8),
          padding: const EdgeInsets.all(16),
          decoration: BoxDecoration(
            color: AppColors.white,
            border: Border.all(color: AppColors.border),
            borderRadius: BorderRadius.circular(4),
          ),
          child: ValueListenableBuilder(
            valueListenable: PokemonDetails.instance.get(pokemon.id),
            builder: (context, detail, _) => Row(
              children: [
                Container(
                  width: 64,
                  height: 64,
                  margin: const EdgeInsets.only(right: 12),
                  alignment: Alignment.center,
                  decoration: BoxDecoration(
                    border: Border.all(color: AppColors.border),
                    borderRadius: BorderRadius.circular(8),
                  ),
                  child: PokemonImage(url: pokemon.imageUrl, size: 56),
                ),
                Expanded(
                  child: Column(
                    crossAxisAlignment: CrossAxisAlignment.start,
                    spacing: 4,
                    children: [
                      Text(
                        '${widget.index + 1}. ${capitalize(pokemon.name.isNotEmpty ? pokemon.name : detail.data?.name ?? '')}',
                        maxLines: 1,
                        overflow: TextOverflow.ellipsis,
                        style: const TextStyle(fontSize: 16, fontWeight: FontWeight.w600, color: AppColors.textPrimary),
                      ),
                      Text(
                        dexNumber(pokemon.id),
                        maxLines: 1,
                        overflow: TextOverflow.ellipsis,
                        style: const TextStyle(fontSize: 12, color: AppColors.textSecondary),
                      ),
                    ],
                  ),
                ),
                Padding(
                  padding: const EdgeInsets.only(left: 8),
                  child: Row(
                    spacing: 8,
                    children: [
                      if (detail.data case final data?)
                        Row(
                          spacing: 4,
                          children: [
                            for (final type in data.types)
                              Semantics(
                                label: type,
                                child: Container(
                                  width: 20,
                                  height: 20,
                                  decoration: BoxDecoration(color: typeColor(type), shape: BoxShape.circle),
                                ),
                              ),
                          ],
                        ),
                      FavouriteButton(id: pokemon.id),
                    ],
                  ),
                ),
              ],
            ),
          ),
        ),
      ),
    );
  }
}
