import 'package:material_ui/material_ui.dart';

/// The original's `constants/colors.ts`.
class AppColors {
  AppColors._();

  static const white = Color(0xFFFFFFFF);
  static const backgroundScreen = Color(0xFFF7F7F7);
  static const border = Color(0xFFE3E3E3);
  static const textPrimary = Color(0xFF1A1A1A);
  static const textSecondary = Color(0xFF9E9E9E);
  static const typeFallback = Color(0xFFCCCCCC);
  static const tabBarActive = Color(0xFF000000);
  static const tabBarInactive = Color(0xFF424242);
  static const favourite = Color(0xFFE53935);
}

/// The original's `constants/pokemonTypes.ts`.
const _typeColors = <String, Color>{
  'normal': Color(0xFFA8A77A),
  'fire': Color(0xFFEE8130),
  'water': Color(0xFF6390F0),
  'electric': Color(0xFFF7D02C),
  'grass': Color(0xFF7AC74C),
  'ice': Color(0xFF96D9D6),
  'fighting': Color(0xFFC22E28),
  'poison': Color(0xFFA33EA1),
  'ground': Color(0xFFE2BF65),
  'flying': Color(0xFFA98FF3),
  'psychic': Color(0xFFF95587),
  'bug': Color(0xFFA6B91A),
  'rock': Color(0xFFB6A136),
  'ghost': Color(0xFF735797),
  'dragon': Color(0xFF6F35FC),
  'dark': Color(0xFF705746),
  'steel': Color(0xFFB7B7CE),
  'fairy': Color(0xFFD685AD),
};

Color typeColor(String name) => _typeColors[name] ?? AppColors.typeFallback;
