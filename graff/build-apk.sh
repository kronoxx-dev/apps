#!/bin/sh
set -eu
ROOT=$(CDPATH= cd -- "$(dirname -- "$0")" && pwd)
: "${JAVA_HOME:?Укажите JAVA_HOME (JDK 17)}"
: "${ANDROID_HOME:?Укажите каталог Android SDK}"
: "${KEYSTORE:?Укажите существующий ключ подписи вне исходников}"
: "${KEYSTORE_PASSWORD:?Укажите пароль ключа через переменную окружения}"
KEY_ALIAS=${KEY_ALIAS:-ryadom-test}
BUILD_TOOLS=${BUILD_TOOLS:-$ANDROID_HOME/build-tools/35.0.0}
export JAVA_HOME ANDROID_HOME KEYSTORE_PASSWORD
export PATH="$JAVA_HOME/bin:$PATH"
[ -f "$ROOT/android/app/google-services.json" ] || [ "${ALLOW_WITHOUT_FIREBASE:-0}" = 1 ] || { echo 'Добавьте google-services.json для family.ryadom.app в android/app/'; exit 1; }
[ -f "$KEYSTORE" ] || { echo 'Ключ подписи не найден. Для обновления нужен прежний ключ.'; exit 1; }
(cd "$ROOT/android" && ./gradlew --no-daemon :app:assembleRelease --console=plain)
mkdir -p "$ROOT/build"
"$BUILD_TOOLS/zipalign" -f 4 "$ROOT/android/app/build/outputs/apk/release/app-release-unsigned.apk" "$ROOT/build/aligned.apk"
APK_OUTPUT=${APK_OUTPUT:-$ROOT/build/graff-0.6.0.apk}
"$BUILD_TOOLS/apksigner" sign --ks "$KEYSTORE" --ks-key-alias "$KEY_ALIAS" --ks-pass env:KEYSTORE_PASSWORD --key-pass env:KEYSTORE_PASSWORD --out "$APK_OUTPUT" "$ROOT/build/aligned.apk"
"$BUILD_TOOLS/apksigner" verify --verbose "$APK_OUTPUT"
printf 'APK: %s\n' "$APK_OUTPUT"
