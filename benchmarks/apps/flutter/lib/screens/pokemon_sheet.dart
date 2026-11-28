import 'package:material_ui/material_ui.dart';

import '../data/pokemon.dart';
import '../data/pokemon_api.dart';
import '../theme.dart';
import '../widgets/common.dart';

/// Opens a Pokémon's detail in a sheet three quarters of the screen tall, with
/// 16px corners (the original's `pokemon/[id]`, an iOS form sheet at the 0.75
/// detent). Material's bottom sheet, which Flutter draws itself, stands in for
/// UIKit's sheet: it slides up over a scrim and drags down to close, but the
/// screen behind it doesn't shrink back as it does behind a form sheet.
Future<void> showPokemonSheet(BuildContext context, String id) => showModalBottomSheet<void>(
  context: context,
  isScrollControlled: true,
  backgroundColor: AppColors.white,
  shape: const RoundedRectangleBorder(borderRadius: BorderRadius.vertical(top: Radius.circular(16))),
  clipBehavior: Clip.antiAlias,
  builder: (context) => SizedBox(
    height: MediaQuery.sizeOf(context).height * 0.75,
    child: PokemonSheet(id: id),
  ),
);

class PokemonSheet extends StatelessWidget {
  const PokemonSheet({super.key, required this.id});

  final String id;

  @override
  Widget build(BuildContext context) => ValueListenableBuilder(
    valueListenable: PokemonDetails.instance.get(id),
    builder: (context, detail, _) {
      final data = detail.data;
      if (data == null) {
        final center = SizedBox(
          height: MediaQuery.sizeOf(context).height / 2,
          child: Center(
            child: detail.error
                ? Column(
                    mainAxisSize: MainAxisSize.min,
                    children: [
                      const Text('Failed to load the Pokémon'),
                      GestureDetector(
                        onTap: () => Navigator.of(context).pop(),
                        child: const Padding(padding: EdgeInsets.only(top: 30, bottom: 15), child: Text('Close')),
                      ),
                    ],
                  )
                : const LargeSpinner(),
          ),
        );
        return Column(children: [const _Handle(), center]);
      }
      return Column(
        crossAxisAlignment: CrossAxisAlignment.stretch,
        children: [
          SizedBox(
            height: 52,
            child: Stack(
              children: [
                const Center(child: _Handle()),
                Positioned(right: 16, top: 11, child: FavouriteButton(id: id, size: 30)),
              ],
            ),
          ),
          Expanded(
            child: SingleChildScrollView(
              padding: const EdgeInsets.symmetric(horizontal: 16, vertical: 24),
              child: _PokemonDetail(pokemon: data),
            ),
          ),
        ],
      );
    },
  );
}

/// The sheet's grabber: 64×4, radius 2, 12px above and below.
class _Handle extends StatelessWidget {
  const _Handle();

  @override
  Widget build(BuildContext context) => Container(
    width: 64,
    height: 4,
    margin: const EdgeInsets.symmetric(vertical: 12),
    decoration: BoxDecoration(color: AppColors.textPrimary, borderRadius: BorderRadius.circular(2)),
  );
}

/// The artwork, the name and the facts (the original's `PokemonDetail`).
class _PokemonDetail extends StatelessWidget {
  const _PokemonDetail({required this.pokemon});

  final PokemonDetail pokemon;

  @override
  Widget build(BuildContext context) {
    final types = pokemon.types.map(capitalize).join(', ');
    final abilities = pokemon.abilities.map(capitalize).join(', ');
    final rows = [
      ('Dex №', dexNumber(pokemon.id)),
      ('Type', types.isEmpty ? '—' : types),
      ('Height', '${(pokemon.height / 10).toStringAsFixed(1)} m'),
      ('Weight', '${(pokemon.weight / 10).toStringAsFixed(1)} kg'),
      ('Base XP', '${pokemon.baseExperience}'),
      ('Abilities', abilities.isEmpty ? '—' : abilities),
    ];
    return Column(
      spacing: 16,
      children: [
        PokemonImage(url: pokemon.imageUrl, size: 200),
        Text(
          capitalize(pokemon.name),
          textAlign: TextAlign.center,
          style: const TextStyle(fontSize: 26, height: 30 / 26, fontWeight: FontWeight.w600, color: Colors.black),
        ),
        Column(
          spacing: 12,
          children: [
            for (final (i, (label, value)) in rows.indexed) ...[
              if (i > 0)
                const SizedBox(
                  height: 1,
                  width: double.infinity,
                  child: ColoredBox(color: AppColors.border),
                ),
              Row(
                children: [
                  Text(
                    label,
                    style: const TextStyle(fontSize: 14, height: 20 / 14, color: AppColors.textSecondary),
                  ),
                  Expanded(
                    child: Padding(
                      padding: const EdgeInsets.only(left: 16),
                      child: Text(
                        value,
                        textAlign: TextAlign.right,
                        style: const TextStyle(
                          fontSize: 14,
                          height: 20 / 14,
                          fontWeight: FontWeight.w500,
                          color: AppColors.textPrimary,
                        ),
                      ),
                    ),
                  ),
                ],
              ),
            ],
          ],
        ),
      ],
    );
  }
}
