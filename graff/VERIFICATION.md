# Graff 0.6.1 — проверка

10 октября 2026.

- 11 интеграционных тестов прошли локально и в изолированной директории Beget. Проверены авторизация, семейные/личные чаты, права, история, пагинация, изменения и удаления, курсоры ревизий, доступ к аудио, повторная отправка и повтор распознавания.
- На Beget собран Whisper.cpp 1.9.5, модель base. Тестовая русская запись распознана локально. Отдельно проверена цепочка AAC/M4A → защищённый API → ffmpeg → Whisper → текст → авторизованное получение аудио. Тестовая база изолирована от семейной переписки.
- В двух браузерных аккаунтах изменение и удаление появились у собеседника без перезагрузки страницы. Проверены запись MediaRecorder с синтетическим аудиопотоком, предпрослушивание, отправка, раскрытие расшифровки и воспроизведение. Ошибок JavaScript нет. Настоящий микрофон браузера на этом Mac не проверен.
- Android release собран Gradle 8.11.1, JDK 17, SDK 35. Подписи v2/v3 проверены; сохранены applicationId и прежний ключ подписи. versionCode 11.
- На эмуляторе Android 15 установлен новый APK поверх прежнего с сохранением входа. Проверены разрешение микрофона, нативная запись AAC (34 секунды), предпрослушивание, отправка в изолированный чат и получение расшифровки от тестового обработчика. Реальный Whisper отдельно проверен на Beget, как описано выше.
- Стартовый экран проверен на узком экране, движение четырёх аватаров и режим уменьшения анимаций сохранены.
- Очередь push проверена с тестовым транспортом: исключение отправителя, защита личных чатов, идемпотентность, повтор после перезапуска, выход, смена аккаунта, истечение сессии и недействительный токен.
- В APK 0.3.1 подключён Firebase проекта graff-c3fed; серверный ключ установлен вне webroot с правами 600. Реальная регистрация устройства и уведомление при свёрнутом приложении проверены на Android 15 с Google Play Services. Проверены цепочка API → очередь → FCM → уведомление и отдельная отправка с Beget на тестовый эмулятор. Нажатие открывает нужный чат. Семейная переписка при проверках не изменялась.
- Физический Samsung не проверялся. Сквозного шифрования нет.


Проверки 0.4.0:
- 12 серверных тестов: добавлены согласие на локацию, права участников, запрет записи за другого, валидация координат/времени, отклонение обновлений после остановки, удаление при выходе и истечении 24 часов.
- В браузере проверены создание приглашения через новый «+», три карточки участников, загрузка настоящих тайлов OSM, включение/выключение Geolocation API, три синтетические позиции в изолированной базе, отсутствие горизонтального переполнения на 320/360 px и ошибок JavaScript.
- Android 15: системный запрос георазрешения, location foreground service с постоянным уведомлением, передача координат эмулятора на тестовый сервер в фоне. Физические телефоны семьи и реальный GPS Samsung не проверялись.
- Скриншоты карты используют искусственные тестовые координаты, не фактическое местоположение семьи.


Проверки 0.5.0:
- Все 13 серверных тестов прошли. Новый интеграционный тест изображений отдельно прошёл в изолированной директории Beget с его ffmpeg: загрузка JPEG, фактическое декодирование, миниатюра, удаление метаданных, приватный доступ, права на редактирование подписи, идемпотентность и удаление файлов.
- Два браузерных аккаунта: вставка и получение эмодзи, выбор PNG, предпросмотр/подпись/отправка, получение миниатюры, просмотр/увеличение, изменение подписи и удаление у собеседника. На ширине 320/360 px поле сообщения доступно, переполнения нет. Ошибок JavaScript нет.
- APK 0.5.0, versionCode 12, прежняя подпись v2/v3. Android-клиент собирается с подключённым Firebase; ключей сервисного аккаунта в APK и Git нет.
- Android 15: выбрано PNG через системную галерею, получен предпросмотр, JPEG отправлен нативным клиентом и появился в тестовом чате. Обновление установлено поверх предыдущей версии.


Проверки 0.6.0:
- Все 15 серверных тестов прошли локально. Два новых теста видеокружков также прошли на Beget в отдельной директории: реальное декодирование WebM/MP4, квадратный постер, удаление метаданных, права, идемпотентность, удаление и очистка файлов, отклонение записей длиннее 60 секунд.
- Два браузерных аккаунта с тестовыми камерой и микрофоном: запись, предпросмотр со звуком, отправка, получение постера, воспроизведение MP4, новое текстовое сообщение во время просмотра, удаление у всех, освобождение камеры при отмене. Проверена ширина 320/360 px, ошибок JavaScript нет.
- APK 0.6.0, versionCode 13: сборка release, прежний ключ, подписи v2/v3. Добавлены разрешения CAMERA и MODIFY_AUDIO_SETTINGS; доступ WebView к камере/микрофону ограничен локальным origin приложения.
- Android 15, эмулятор: обновление поверх прежней версии, разрешение камеры, запись с камерой/микрофоном, предпросмотр, отправка через нативный HTTP-мост; в тестовой базе подтверждён новый видеокружок длительностью 2,58 секунды; MP4 воспроизводится в круге внутри чата. Физический Samsung и реальная камера телефона не проверялись.

Проверки 0.6.1 (11 октября 2026):
- Общая линия центров иконок панели ввода при ширинах 320/360/390 px и многострочном тексте.
- Короткое нажатие переключает микрофон/камеру; удержание запускает запись, отпускание открывает предпросмотр. Запрос разрешений оставляет ручные кнопки записи; Enter запускает запись с клавиатуры.
- Собственный SVG-постер и зелёная Play-кнопка заменяют системное превью WebView. Проверены воспроизведение и пауза.
- Скрепка открывает только галерею. Иконка push использует белую векторную маску знака Graff, без чёрного фона. APK 0.6.1, versionCode 14, прежняя подпись.
- На Android 15 обновление установлено поверх 0.6.0. Короткое нажатие переключило микрофон в камеру; удержание и отпускание открыли записанный кружок с новым превью. Проверен реальный скриншот WebView без системной серой заглушки. Все четыре кнопки панели имеют одинаковые вертикальные границы.
- Новая векторная иконка включена в release APK и используется в PushController. В этой проверке новый FCM-push не появился на эмуляторе, поэтому отображение значка в системной шторке не подтверждено; предыдущая end-to-end проверка доставки описана выше.

## 0.7.0 — radio (2026-10-11)

- 17 server tests pass, including new cross-instance floor ownership, 250 ms PCM delivery to both peers, authentication, revoked sessions, foreign frame rejection, duplicate sequence rejection, stale floor expiry and audio expiry. Existing messaging, photo, video, voice, edit/delete and push tests remain green.
- Headless browser with native bridge fixture: 320/360/390 px, all four tabs, three avatar assets, online/nearby pages, press/release and navigation cancellation, another speaker disables transmission, invalid pairing code rejected. `outputs/graff-radio-070.png` is a UI fixture screenshot, not proof of three physical phones.
- Android 15 emulator, release APK: real AudioRecord capture produced 17 PCM frames during a 4.5-second hold; a separate authorized account received the frames. Release freed the floor. Injected 7 seconds of real PCM into Android AudioTrack while screen off; audio_flinger showed an active 16 kHz track with advancing frames, zero underruns in the inspected track and ~341 ms audio output buffer latency. Device remained present while screen off.
- Physical Samsung-to-Samsung acoustics, radio range, OEM background battery management and Wi-Fi hotspot client isolation still need device testing. Emulator audio path/frame delivery is verified; subjective audio quality has not been assessed on physical phones.
- Android LAN host: a 4-second native microphone hold delivered 14 encrypted PCM frames to a separate TCP client. Two LAN clients exercised floor contention and injected playback. Replayed ciphertext and a wrong AES key were rejected. Android LAN join mode independently connected to an encrypted external relay fixture and received continuous PCM audio.
- Beget Linux staging: both new radio tests passed using the RAM relay database before production deployment. Production `/graff/api/health` reports 0.7.0 and radio=true; existing database was backed up and preserved.
