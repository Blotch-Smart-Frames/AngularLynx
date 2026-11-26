package dev.angularlynx.shell

import android.graphics.Typeface
import android.os.Build
import com.lynx.tasm.behavior.shadow.text.TypefaceCache
import java.util.Locale

/**
 * Lets `font-family` name Android's own font families, as a browser does:
 * `monospace`, `serif`, `sans-serif`, the other CSS generic families Android
 * has a font for, and the families in the system's fonts.xml
 * (`sans-serif-condensed`, `serif-monospace`, `casual`...).
 *
 * Lynx on Android finds a family only in the providers the host app
 * registers and in the app's `@font-face` rules (TypefaceCache.getTypeface,
 * then FontFaceManager); neither asks Android for its system families, so
 * `font-family: Menlo, monospace` (the build plugin's rule for `<code>`)
 * drew the default font. iOS finds installed fonts by name itself.
 *
 * Lynx walks the list a family at a time, so a name Android doesn't have
 * must return null here, letting Lynx try the app's `@font-face` rules and
 * then the next family in the list. Lynx asks the providers before the
 * `@font-face` rules, so an app's `@font-face` named after one of these
 * families loses to the system's. A browser treats unquoted generic names the
 * same way, and Lynx drops the quotes that would tell the two apart.
 */
object SystemFontFamilies : TypefaceCache.LazyProvider {
    // CSS's generic families, and the Android family each draws in, with
    // `system-ui` in the system font as Chrome draws it. Android has no
    // family for `fantasy`, `math` or `emoji` (emoji come from the fallback
    // fonts whatever the family), and Chrome doesn't know Safari's `ui-*`
    // families, so those fall through to the next family in the list.
    private val GENERIC_FAMILIES = mapOf(
        "serif" to "serif",
        "sans-serif" to "sans-serif",
        "monospace" to "monospace",
        "cursive" to "cursive",
        "system-ui" to "sans-serif",
    )

    // Lynx calls this from TypefaceCache, which caches each family and style
    // it returns, so a family is looked up once. `style` is Typeface's style
    // (NORMAL, BOLD, ITALIC or BOLD_ITALIC), from the text's font-weight and
    // font-style.
    override fun getTypeface(fontFamily: String, style: Int): Typeface? {
        // CSS family names ignore case; Android's are all lowercase.
        val family = fontFamily.lowercase(Locale.ROOT)
        GENERIC_FAMILIES[family]?.let { return Typeface.create(it, style) }

        // Any other family in fonts.xml. Typeface.create(name) gives back
        // Typeface.DEFAULT itself for a name it doesn't have, from Android 9;
        // before it, that isn't promised, so earlier versions find only the
        // generic families (returning the default there would stop Lynx at a
        // family the system doesn't have and skip the rest of the list).
        if (Build.VERSION.SDK_INT < Build.VERSION_CODES.P) return null
        val typeface = Typeface.create(family, Typeface.NORMAL)
        if (typeface === Typeface.DEFAULT) return null
        return Typeface.create(typeface, style)
    }
}
