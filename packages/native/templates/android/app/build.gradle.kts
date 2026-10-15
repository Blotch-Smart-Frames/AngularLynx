import java.util.Properties

plugins {
    id("com.android.application")
}

// App identity comes from angular.json, which the generator writes into
// angular-lynx.properties. The committed file has defaults so the template
// also builds on its own.
val appConfig = Properties().apply {
    rootProject.file("angular-lynx.properties").inputStream().use { load(it) }
}

fun appConfig(key: String): String =
    appConfig.getProperty(key) ?: error("angular-lynx.properties has no $key")

// Release signing arrives as Gradle properties (the builder sets
// ORG_GRADLE_PROJECT_angularLynxStoreFile etc. in the environment, which
// keeps secrets out of command lines and logs) and is never written to disk,
// so the generated project never holds secrets. The names have no dots:
// gradlew is a /bin/sh script, and dash (Debian and Ubuntu's /bin/sh) drops
// environment variables whose names aren't shell identifiers before Gradle
// starts. Without them, release builds fall back to the debug key: still
// installable on an emulator, but Google Play rejects them.
val releaseSigning = listOf("StoreFile", "StorePassword", "KeyAlias", "KeyPassword")
    .associateWith { providers.gradleProperty("angularLynx$it").orNull }
val hasReleaseSigning = releaseSigning.values.all { !it.isNullOrEmpty() }

// One place for the Lynx version, so a Lynx upgrade is a one-line change.
val lynxVersion = "4.1.0"
val primjsVersion = "4.1.1"
// Lynx's image service is written against Fresco 2.3, and Lynx Explorer ships
// the same version, so stay on it until Lynx moves.
val frescoVersion = "2.3.0"

android {
    // The namespace is the package of the shell's own Kotlin code and R class.
    // It's fixed; only the applicationId (the store identity) is configurable.
    namespace = "dev.angularlynx.shell"
    compileSdk = 36

    defaultConfig {
        applicationId = appConfig("applicationId")
        // Lynx 4.1's AARs declare minSdk 16, but Lynx Explorer and Lynx's
        // integration guide use 24, the oldest version Lynx tests on.
        minSdk = 24
        // Google Play requires new apps and updates to target a recent API
        // level, raised every August. Bump this with each requirement.
        targetSdk = 36
        versionCode = appConfig("versionCode").toInt()
        versionName = appConfig("versionName")
        resValue("string", "app_name", appConfig("appName"))
        // portrait, sensorLandscape or unspecified (follows the device).
        manifestPlaceholders["screenOrientation"] =
            appConfig.getProperty("screenOrientation") ?: "portrait"
    }

    signingConfigs {
        if (hasReleaseSigning) {
            create("release") {
                storeFile = file(releaseSigning.getValue("StoreFile")!!)
                storePassword = releaseSigning.getValue("StorePassword")
                keyAlias = releaseSigning.getValue("KeyAlias")
                keyPassword = releaseSigning.getValue("KeyPassword")
            }
        }
    }

    buildTypes {
        release {
            // R8 shrinking is off until the Lynx keep rules in
            // proguard-rules.pro are verified against every AngularLynx
            // feature; Lynx reaches much of its Java code through JNI and
            // reflection, which R8 can't see.
            isMinifyEnabled = false
            proguardFiles(
                getDefaultProguardFile("proguard-android-optimize.txt"),
                "proguard-rules.pro",
            )
            signingConfig = if (hasReleaseSigning) {
                signingConfigs.getByName("release")
            } else {
                signingConfigs.getByName("debug")
            }
        }
    }

    compileOptions {
        sourceCompatibility = JavaVersion.VERSION_17
        targetCompatibility = JavaVersion.VERSION_17
    }

    buildFeatures {
        resValues = true
    }

    androidResources {
        // The bundle and lazy bundles are read with AssetManager.open(), which
        // works on compressed assets too, but leaving them uncompressed lets
        // the OS map them straight from the APK.
        noCompress += listOf("bundle")
    }

    packaging {
        jniLibs {
            // Store native libraries uncompressed and page-aligned in the APK,
            // which Android loads without extracting them first.
            useLegacyPackaging = false
            // Lynx's and Fresco's libraries ship already stripped. Without
            // this, AGP tries to strip them again, which needs the NDK (and
            // only warns when it's missing), so users would need the NDK for
            // nothing.
            keepDebugSymbols += "**/*.so"
        }
    }
}

dependencies {
    implementation("androidx.activity:activity-ktx:1.10.1")
    implementation("androidx.core:core-ktx:1.16.0")

    // The Lynx engine, its JavaScript runtime (PrimJS) and its JS SDK.
    implementation("org.lynxsdk.lynx:lynx:$lynxVersion")
    implementation("org.lynxsdk.lynx:lynx-jssdk:$lynxVersion")
    implementation("org.lynxsdk.lynx:lynx-trace:$lynxVersion")
    implementation("org.lynxsdk.lynx:primjs:$primjsVersion")

    // Lynx services: <image> (backed by Fresco), console logging, and
    // fetch()/XMLHttpRequest (backed by OkHttp). The service AARs only
    // compile against Fresco and OkHttp, so the app has to provide them.
    implementation("org.lynxsdk.lynx:lynx-service-image:$lynxVersion")
    implementation("org.lynxsdk.lynx:lynx-service-log:$lynxVersion")
    implementation("org.lynxsdk.lynx:lynx-service-http:$lynxVersion")
    implementation("com.facebook.fresco:fresco:$frescoVersion")
    implementation("com.facebook.fresco:animated-gif:$frescoVersion")
    implementation("com.facebook.fresco:animated-webp:$frescoVersion")
    implementation("com.facebook.fresco:webpsupport:$frescoVersion")
    implementation("com.facebook.fresco:animated-base:$frescoVersion")
    implementation("com.squareup.okhttp3:okhttp:4.12.0")
}
