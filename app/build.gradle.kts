plugins {
    id("com.android.application")
    id("org.jetbrains.kotlin.android")
}

android {
    namespace = "com.story.phone"
    compileSdk = 34

    defaultConfig {
        applicationId = "com.story.phone"
        minSdk = 26 // 安卓 8.0，保障完美兼容通知监听、硬件马达与无障碍接口
        targetSdk = 34
        versionCode = 3
        versionName = "1.1.1"
    }

    // 签名配置：使用项目自带的 storyphone.jks
    // 密码和别名都是好记的 123456 / key
    signingConfigs {
        create("release") {
            storeFile = file("storyphone.jks")
            storePassword = "123456"
            keyAlias = "key"
            keyPassword = "123456"
        }
    }

    buildTypes {
        release {
            isMinifyEnabled = true
            proguardFiles(
                getDefaultProguardFile("proguard-android-optimize.txt"),
                "proguard-rules.pro"
            )
            signingConfig = signingConfigs.getByName("release")
        }
        debug {
            // debug 也使用同一个签名，避免调试版和发布版签名冲突
            signingConfig = signingConfigs.getByName("release")
        }
    }
    compileOptions {
        sourceCompatibility = JavaVersion.VERSION_17
        targetCompatibility = JavaVersion.VERSION_17
    }
    kotlinOptions {
        jvmTarget = "17"
    }
}

dependencies {
    implementation("androidx.core:core-ktx:1.12.0")
    implementation("androidx.appcompat:appcompat:1.6.1")
    implementation("com.google.android.material:material:1.11.0")
    implementation("androidx.webkit:webkit:1.10.0")
    implementation("com.microsoft.onnxruntime:onnxruntime-android:latest.release")
}
