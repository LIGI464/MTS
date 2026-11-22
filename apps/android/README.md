# Goida Board для Android

При запуске приложение открывает `https://skinsloot.tech/admin/incidents` внутри собственного окна. Для загрузки и работы панели требуется интернет. Ссылки на другие HTTPS-сайты открываются в системном приложении при нажатии.

- Идентификатор пакета `com.goidacode.board`
- Android 7.0 и выше

## Сборка

Откройте `apps/android` в Android Studio или используйте JDK 17+ и Android SDK с платформой 35 и Build Tools 35.0.0.

```sh
./gradlew :app:assembleDebug
```

В Windows используйте `gradlew.bat :app:assembleDebug`. Установочный файл появится в `app/build/outputs/apk/debug/app-debug.apk`.

Для выпуска подписанной версии выберите **Build → Generate Signed App Bundle or APK → APK** в Android Studio и укажите свой ключ. Обновления установленной версии подписываются тем же ключом.
