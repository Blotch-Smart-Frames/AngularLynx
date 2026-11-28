import 'package:cupertino_ui/cupertino_ui.dart';
import 'package:flutter_svg/flutter_svg.dart';

import '../data/favourites.dart';
import '../theme.dart';

/// One of the original's SVG icons (`assets/icons`), in one color: what its
/// `SVGIcon` draws with react-native-svg.
class SvgIcon extends StatelessWidget {
  const SvgIcon(this.name, {super.key, required this.size, required this.color});

  final String name;
  final double size;
  final Color color;

  @override
  Widget build(BuildContext context) => SvgPicture.asset(
    'assets/icons/$name.svg',
    width: size,
    height: size,
    colorFilter: ColorFilter.mode(color, BlendMode.srcIn),
  );
}

/// A sprite or artwork, with the Pokéball as its placeholder until it loads
/// (the original's `PokemonImage`, on expo-image).
class PokemonImage extends StatelessWidget {
  const PokemonImage({super.key, required this.url, required this.size});

  final String? url;
  final double size;

  @override
  Widget build(BuildContext context) {
    final placeholder = Image.asset('assets/images/pokemon-logo.png', width: size, height: size, fit: BoxFit.contain);
    final url = this.url;
    if (url == null) return placeholder;
    return Image.network(
      url,
      width: size,
      height: size,
      fit: BoxFit.contain,
      frameBuilder: (context, child, frame, wasSynchronouslyLoaded) =>
          frame == null && !wasSynchronouslyLoaded ? placeholder : child,
      errorBuilder: (context, error, stackTrace) => placeholder,
    );
  }
}

/// The heart that adds a Pokémon to the favourites or takes it off (the
/// original's `FavouriteButton`). The original's 8px hit slop has no
/// counterpart that leaves the layout alone (a widget only takes touches
/// inside its own box), so the heart takes them on its own size.
class FavouriteButton extends StatelessWidget {
  const FavouriteButton({super.key, required this.id, this.size = 20});

  final String id;
  final double size;

  @override
  Widget build(BuildContext context) {
    final favourites = Favourites.instance;
    return ListenableBuilder(
      listenable: favourites,
      builder: (context, _) {
        final isFavourite = favourites.contains(id);
        return Semantics(
          button: true,
          label: isFavourite ? 'Remove from favorites' : 'Add to favorites',
          child: GestureDetector(
            behavior: HitTestBehavior.opaque,
            onTap: () => favourites.toggle(id),
            child: SvgIcon(
              isFavourite ? 'heart-solid' : 'heart',
              size: size,
              color: isFavourite ? AppColors.favourite : AppColors.textSecondary,
            ),
          ),
        );
      },
    );
  }
}

/// The large spinner the original shows with `ActivityIndicator size="large"`.
class LargeSpinner extends StatelessWidget {
  const LargeSpinner({super.key});

  @override
  Widget build(BuildContext context) => const CupertinoActivityIndicator(radius: 18);
}
