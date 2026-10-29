package dev.angularlynx.shell

import android.content.Context
import android.content.res.ColorStateList
import android.os.Build
import androidx.annotation.RequiresApi

/**
 * The colors Android 12 and later take from the user's wallpaper (Material
 * You's dynamic color), for the `dynamicColors` global prop, which the
 * runtime's `LynxTheme.dynamicColors` reads: Material 3's color roles, by
 * their names in Material (`primary`, `onSurfaceVariant`), as hex colors such
 * as `#6750a4`. Both the light and the dark scheme are sent, since an app can
 * keep its own light or dark theme rather than follow the phone's.
 *
 * Android 14 has a color for most roles (`system_primary_light` and so on),
 * which also follow its contrast setting. Android 12 and 13 have only the five
 * tonal palettes the roles come from, at 13 tones each, so each role takes its
 * tone from its palette as Material Components does on those versions (its
 * `m3_sys_color_dynamic_*` colors): the palette's own color at that tone, or,
 * for a tone in between, its tone 40 moved there with `withLStar`, which keeps
 * the hue and chroma.
 */
object DynamicColors {
    /** The `dynamicColors` global prop, or null before Android 12. */
    fun read(context: Context): Map<String, Any>? {
        if (Build.VERSION.SDK_INT < Build.VERSION_CODES.S) return null
        return mapOf(
            "light" to scheme(context, light = true),
            "dark" to scheme(context, light = false),
        )
    }

    @RequiresApi(Build.VERSION_CODES.S)
    private fun scheme(context: Context, light: Boolean): Map<String, String> =
        ROLES.associate { role ->
            val systemColor = if (light) role.lightColor else role.darkColor
            val color = if (systemColor != null && Build.VERSION.SDK_INT >= Build.VERSION_CODES.UPSIDE_DOWN_CAKE) {
                context.getColor(systemColor)
            } else {
                (if (light) role.lightTone else role.darkTone).color(context)
            }
            role.name to "#%06x".format(color and 0xffffff)
        }

    private enum class Palette(vararg val shades: Int) {
        PRIMARY(
            android.R.color.system_accent1_0, android.R.color.system_accent1_10,
            android.R.color.system_accent1_50, android.R.color.system_accent1_100,
            android.R.color.system_accent1_200, android.R.color.system_accent1_300,
            android.R.color.system_accent1_400, android.R.color.system_accent1_500,
            android.R.color.system_accent1_600, android.R.color.system_accent1_700,
            android.R.color.system_accent1_800, android.R.color.system_accent1_900,
            android.R.color.system_accent1_1000,
        ),
        SECONDARY(
            android.R.color.system_accent2_0, android.R.color.system_accent2_10,
            android.R.color.system_accent2_50, android.R.color.system_accent2_100,
            android.R.color.system_accent2_200, android.R.color.system_accent2_300,
            android.R.color.system_accent2_400, android.R.color.system_accent2_500,
            android.R.color.system_accent2_600, android.R.color.system_accent2_700,
            android.R.color.system_accent2_800, android.R.color.system_accent2_900,
            android.R.color.system_accent2_1000,
        ),
        TERTIARY(
            android.R.color.system_accent3_0, android.R.color.system_accent3_10,
            android.R.color.system_accent3_50, android.R.color.system_accent3_100,
            android.R.color.system_accent3_200, android.R.color.system_accent3_300,
            android.R.color.system_accent3_400, android.R.color.system_accent3_500,
            android.R.color.system_accent3_600, android.R.color.system_accent3_700,
            android.R.color.system_accent3_800, android.R.color.system_accent3_900,
            android.R.color.system_accent3_1000,
        ),
        NEUTRAL(
            android.R.color.system_neutral1_0, android.R.color.system_neutral1_10,
            android.R.color.system_neutral1_50, android.R.color.system_neutral1_100,
            android.R.color.system_neutral1_200, android.R.color.system_neutral1_300,
            android.R.color.system_neutral1_400, android.R.color.system_neutral1_500,
            android.R.color.system_neutral1_600, android.R.color.system_neutral1_700,
            android.R.color.system_neutral1_800, android.R.color.system_neutral1_900,
            android.R.color.system_neutral1_1000,
        ),
        NEUTRAL_VARIANT(
            android.R.color.system_neutral2_0, android.R.color.system_neutral2_10,
            android.R.color.system_neutral2_50, android.R.color.system_neutral2_100,
            android.R.color.system_neutral2_200, android.R.color.system_neutral2_300,
            android.R.color.system_neutral2_400, android.R.color.system_neutral2_500,
            android.R.color.system_neutral2_600, android.R.color.system_neutral2_700,
            android.R.color.system_neutral2_800, android.R.color.system_neutral2_900,
            android.R.color.system_neutral2_1000,
        ),
    }

    /** The tone of each of a palette's shades (`system_accent1_0` is 100). */
    private val SHADE_TONES = intArrayOf(100, 99, 95, 90, 80, 70, 60, 50, 40, 30, 20, 10, 0)

    private class Tone(val palette: Palette, val tone: Int) {
        @RequiresApi(Build.VERSION_CODES.S)
        fun color(context: Context): Int {
            val shade = SHADE_TONES.indexOf(tone)
            if (shade >= 0) return context.getColor(palette.shades[shade])
            val base = context.getColor(palette.shades[SHADE_TONES.indexOf(40)])
            return ColorStateList.valueOf(base).withLStar(tone.toFloat()).defaultColor
        }
    }

    /** A role, and its color on Android 14, where it has one. */
    private class Role(
        val name: String,
        val lightTone: Tone,
        val darkTone: Tone,
        val lightColor: Int?,
        val darkColor: Int?,
    )

    private fun role(
        name: String,
        palette: Palette,
        lightTone: Int,
        darkTone: Int,
        lightColor: Int?,
        darkColor: Int?,
    ) = Role(name, Tone(palette, lightTone), Tone(palette, darkTone), lightColor, darkColor)

    // Each role's palette and tones are Material Components' (1.12) for
    // Android 12 and 13, and its colors Android 14's. Material Components
    // makes the surfaces from the neutral variant palette. Android 14 has no
    // inverse roles: the inverse primary is the other scheme's primary, and
    // the inverse surfaces come from the palette on every version, at
    // Material's tones. (Material Components gives them the other scheme's
    // surface, tone 6 or 98, which is further from the surface than Material
    // has them.)
    private val ROLES = listOf(
        role("primary", Palette.PRIMARY, 40, 80, android.R.color.system_primary_light, android.R.color.system_primary_dark),
        role("onPrimary", Palette.PRIMARY, 100, 20, android.R.color.system_on_primary_light, android.R.color.system_on_primary_dark),
        role("primaryContainer", Palette.PRIMARY, 90, 30, android.R.color.system_primary_container_light, android.R.color.system_primary_container_dark),
        role("onPrimaryContainer", Palette.PRIMARY, 10, 90, android.R.color.system_on_primary_container_light, android.R.color.system_on_primary_container_dark),
        role("inversePrimary", Palette.PRIMARY, 80, 40, android.R.color.system_primary_dark, android.R.color.system_primary_light),
        role("secondary", Palette.SECONDARY, 40, 80, android.R.color.system_secondary_light, android.R.color.system_secondary_dark),
        role("onSecondary", Palette.SECONDARY, 100, 20, android.R.color.system_on_secondary_light, android.R.color.system_on_secondary_dark),
        role("secondaryContainer", Palette.SECONDARY, 90, 30, android.R.color.system_secondary_container_light, android.R.color.system_secondary_container_dark),
        role("onSecondaryContainer", Palette.SECONDARY, 10, 90, android.R.color.system_on_secondary_container_light, android.R.color.system_on_secondary_container_dark),
        role("tertiary", Palette.TERTIARY, 40, 80, android.R.color.system_tertiary_light, android.R.color.system_tertiary_dark),
        role("onTertiary", Palette.TERTIARY, 100, 20, android.R.color.system_on_tertiary_light, android.R.color.system_on_tertiary_dark),
        role("tertiaryContainer", Palette.TERTIARY, 90, 30, android.R.color.system_tertiary_container_light, android.R.color.system_tertiary_container_dark),
        role("onTertiaryContainer", Palette.TERTIARY, 10, 90, android.R.color.system_on_tertiary_container_light, android.R.color.system_on_tertiary_container_dark),
        role("background", Palette.NEUTRAL_VARIANT, 98, 6, android.R.color.system_background_light, android.R.color.system_background_dark),
        role("onBackground", Palette.NEUTRAL, 10, 90, android.R.color.system_on_background_light, android.R.color.system_on_background_dark),
        role("surface", Palette.NEUTRAL_VARIANT, 98, 6, android.R.color.system_surface_light, android.R.color.system_surface_dark),
        role("onSurface", Palette.NEUTRAL, 10, 90, android.R.color.system_on_surface_light, android.R.color.system_on_surface_dark),
        role("surfaceVariant", Palette.NEUTRAL_VARIANT, 90, 30, android.R.color.system_surface_variant_light, android.R.color.system_surface_variant_dark),
        role("onSurfaceVariant", Palette.NEUTRAL_VARIANT, 30, 80, android.R.color.system_on_surface_variant_light, android.R.color.system_on_surface_variant_dark),
        role("surfaceDim", Palette.NEUTRAL_VARIANT, 87, 6, android.R.color.system_surface_dim_light, android.R.color.system_surface_dim_dark),
        role("surfaceBright", Palette.NEUTRAL_VARIANT, 98, 24, android.R.color.system_surface_bright_light, android.R.color.system_surface_bright_dark),
        role("surfaceContainerLowest", Palette.NEUTRAL_VARIANT, 100, 4, android.R.color.system_surface_container_lowest_light, android.R.color.system_surface_container_lowest_dark),
        role("surfaceContainerLow", Palette.NEUTRAL_VARIANT, 96, 10, android.R.color.system_surface_container_low_light, android.R.color.system_surface_container_low_dark),
        role("surfaceContainer", Palette.NEUTRAL_VARIANT, 94, 12, android.R.color.system_surface_container_light, android.R.color.system_surface_container_dark),
        role("surfaceContainerHigh", Palette.NEUTRAL_VARIANT, 92, 17, android.R.color.system_surface_container_high_light, android.R.color.system_surface_container_high_dark),
        role("surfaceContainerHighest", Palette.NEUTRAL_VARIANT, 90, 22, android.R.color.system_surface_container_highest_light, android.R.color.system_surface_container_highest_dark),
        role("inverseSurface", Palette.NEUTRAL, 20, 90, null, null),
        role("inverseOnSurface", Palette.NEUTRAL, 95, 20, null, null),
        role("outline", Palette.NEUTRAL_VARIANT, 50, 60, android.R.color.system_outline_light, android.R.color.system_outline_dark),
        role("outlineVariant", Palette.NEUTRAL_VARIANT, 80, 30, android.R.color.system_outline_variant_light, android.R.color.system_outline_variant_dark),
    )
}
