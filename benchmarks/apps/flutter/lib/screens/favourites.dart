import 'package:material_ui/material_ui.dart';

import '../data/favourites.dart';
import '../data/pokemon.dart';
import '../widgets/pokemon_list.dart';
import 'tabs.dart';

/// The Favourites tab: the same list, of the favourited ids, each row
/// fetching its detail for its name (the original's `favourites.tsx`).
class FavouritesScreen extends StatelessWidget {
  const FavouritesScreen({super.key});

  @override
  Widget build(BuildContext context) => TabScreenFrame(
    child: ListenableBuilder(
      listenable: Favourites.instance,
      builder: (context, _) => PokemonList(
        data: [for (final id in Favourites.instance.ids) Pokemon.fromId(id)],
        headerText: 'Favourites',
        emptyState: ListEmptyState.empty,
        emptyMessage: 'No favourite Pokémon saved',
      ),
    ),
  );
}
