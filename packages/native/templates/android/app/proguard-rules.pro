# The release build's keep rules, on top of the ones its libraries ship.
#
# R8 (isMinifyEnabled in build.gradle.kts) removes and renames whatever it
# can't see used. Lynx reaches much of its Java through JNI and reflection,
# which R8 can't see, so Lynx's AAR carries keep rules of its own (its
# proguard.txt, which R8 applies by itself): @Keep classes, native and
# @CalledByNative methods, @LynxMethod modules, @LynxProp and @LynxUIMethod
# members, and every LynxBaseUI, ShadowNode and LynxModule subclass. They're
# the rules from Lynx's integration guide, plus a few. Fresco's core library,
# XElement's modules and the AndroidX libraries ship theirs too.
#
# The rules below cover what those miss. They were found by listing every
# reflective call and every method native code calls in the Lynx, XElement and
# Fresco classes, checking the release APK's dex for each, and running the E2E
# tests and a page that drives every XElement on an emulator.
# investigations/native-app-builds.md has the details.
#
# Methods Lynx's native code calls. Lynx's rules keep the ones marked with
# com.lynx.tasm.base.CalledByNative, but lynx-base and lynx-trace, which ship
# no rules, mark theirs with annotations of their own. Without these, R8
# removed LynxLog.log(), which lynx-base's native library looks up as Lynx
# starts, and the app aborted on launch ("JNI DETECTED ERROR IN APPLICATION:
# mid == null" from LynxBaseTrace.nativeInitBaseTrace).
-keepclasseswithmembers class * {
    @com.lynx.base.CalledByNative <methods>;
}
-keepclasseswithmembers class * {
    @com.lynx.trace.CalledByNative <methods>;
}

# Most of the rest come from R8's full mode, AGP's default since AGP 8: a
# -keep rule that names a class without members keeps the class but not its
# constructor. The libraries' rules were written for ProGuard, which kept it,
# so a class they create with Class.newInstance() lost its constructor, and
# with it the methods only an instance could call.

# Lynx's generated setters and method invokers. Lynx finds the ones for each
# element class by name (<class>$$PropsSetter, <class>$$MethodInvoker) and
# creates them with newInstance(). Without these rules R8 emptied them (none
# had a constructor left), and Lynx then set every property and called every
# UI method through reflection instead.
-keep class * implements com.lynx.tasm.behavior.utils.Settable { <init>(); }
-keep class * implements com.lynx.tasm.behavior.utils.LynxUIMethodInvoker { <init>(); }
# The same for a JSI object's descriptor (<class>$$Descriptor).
-keep class * implements com.lynx.jsbridge.jsi.ILynxJSIObjectDescriptor { <init>(); }

# Fresco creates its WebP transcoder by name, and R8 had removed its
# constructor and methods.
-keep class com.facebook.imagepipeline.nativecode.WebpTranscoderImpl { <init>(); }

# <viewpager> reads ViewPager's private mIsUnableToDrag by name, which
# XElement's own rules (they keep only populate()) leave R8 to rename.
-keepclassmembers class androidx.viewpager.widget.ViewPager {
    private boolean mIsUnableToDrag;
}

# <text enable-emoji-compat> looks up AndroidX's EmojiCompat by name, which R8
# had renamed.
-keep class androidx.emoji2.text.EmojiCompat {
    public static androidx.emoji2.text.EmojiCompat get();
    public java.lang.CharSequence process(java.lang.CharSequence);
}

# Classes the app doesn't have, which R8 would otherwise fail the build on.
# XElement's umbrella registers <animax-view> and <markdown>, whose modules
# build.gradle.kts leaves out, so those two tags can't be created (the runtime
# doesn't support them). Lynx uses Gson only to describe its environment for
# debugging tools.
-dontwarn com.lynx.animax.**
-dontwarn com.lynx.xelement.markdown.**
-dontwarn com.google.gson.**

# Keep the file names and line numbers in stack traces. The mapping file
# (app/build/outputs/mapping/release/mapping.txt, which Gradle also puts in
# the .aab for Google Play) turns the renamed classes and methods back.
-keepattributes SourceFile,LineNumberTable
-renamesourcefileattribute SourceFile
