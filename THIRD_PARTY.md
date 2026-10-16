# Компоненты

- **eSpeak NG / espeak-ng 1.0.2** — GPL-3.0-or-later. Лицензия: `COPYING`. WASM и JS из npm-пакета, исходники и инструкция сборки: https://github.com/ianmarmour/espeak-ng.js и https://github.com/espeak-ng/espeak-ng. Изменения обёртки: встроенный wasmBinary, Worker, вывод IPA/WAV, таблица немецких фонем; код см. `src/voice.ts`. Многоязычные данные исходной WASM не удалены.
- **Preact 10.27.2** — MIT, https://github.com/preactjs/preact.
- **fflate 0.8.2** — MIT, https://github.com/101arrowz/fflate.
- **PDF.js 5.4.296** — Apache-2.0, https://github.com/mozilla/pdf.js. Встроен только в сборщик.
- **Golos Text** — SIL Open Font License 1.1, `licenses/Golos-Text-OFL.txt`. Шрифт извлечён из предоставленного пользователем макета. Официальный источник: https://github.com/google/fonts/tree/main/ofl/golostext.
- **Literata** — SIL Open Font License 1.1, `licenses/Literata-OFL.txt`. Шрифт извлечён из предоставленного пользователем макета. Официальный источник: https://github.com/google/fonts/tree/main/ofl/literata.

- **Lora, Merriweather, PT Serif, Source Serif 4, Noto Serif, Inter, PT Sans** — SIL Open Font License 1.1; локальные подмножества Latin/Cyrillic из Fontsource 5.3.0 (Source Serif 4 — 5.3.1). Оригинальные лицензии — `licenses/*-OFL.txt`. Файлы встроены в HTML; обращения к сервисам шрифтов во время чтения нет.

Лицензионные уведомления зависимостей сохранены в скомпилированных файлах и каталоге `licenses/`. Точные версии для воспроизводимой сборки зафиксированы в package-lock.json.

## Текст «Immensee»

Полный немецкий оригинал Теодора Шторма — общественное достояние. Русская адаптация по методу Ильи Франка: Ирина Солнцева; © И. Франк, © ООО «Издательство ВКН», 2018. Источник — предоставленный пользователем файл `Theodor Storm. Immensee.pdf` (73 страницы; SHA-256 `b33c608c9f1e94c28c84f5c8363d6facdee97d10b5469bb4fc4515a65a54e5dc`). Из PDF извлечены рассказ и исходные подсказки; параллельные русские фразы собраны из этих подсказок. Файлы: `src/immensee-source.json`, `books/immensee.fbook`. Эти сведения включены в паспорт `.fbook`. Лицензия приложения GPL относится к программному коду, а не к русской адаптации книги.
