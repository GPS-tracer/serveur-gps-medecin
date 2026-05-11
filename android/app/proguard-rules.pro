# Add project specific ProGuard rules here.

# Keep Firebase classes
-keep class com.google.firebase.** { *; }
-keep class com.google.android.gms.** { *; }
-dontwarn com.google.firebase.**
-dontwarn com.google.android.gms.**

# Keep location services
-keep class com.google.android.gms.location.** { *; }

# Keep your app classes
-keep class com.gpstracker.agent.** { *; }

# Keep Kotlin metadata
-keep class kotlin.Metadata { *; }

# AndroidX
-keep class androidx.** { *; }
-dontwarn androidx.**
