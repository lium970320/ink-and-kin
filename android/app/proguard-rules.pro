# Keep kotlinx.serialization descriptors and serializers
-keepattributes *Annotation*, InnerClasses
-dontnote kotlinx.serialization.AnnotationsKt

-keepclassmembers class kotlinx.serialization.json.** {
    *** Companion;
}
-keepclasseswithmembers class kotlinx.serialization.json.** {
    kotlinx.serialization.KSerializer serializer(...);
}

-keep,includedescriptorclasses class com.inkandkin.lanchat.**$$serializer { *; }
-keepclassmembers class com.inkandkin.lanchat.** {
    *** Companion;
}
-keepclasseswithmembers class com.inkandkin.lanchat.** {
    kotlinx.serialization.KSerializer serializer(...);
}

# OkHttp & Okio
-dontwarn okhttp3.**
-dontwarn okio.**
-dontwarn javax.annotation.**
-dontwarn org.conscrypt.**
-dontwarn org.bouncycastle.**
-dontwarn org.openjsse.**
