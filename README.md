# King_game

Адаптированная web-версия карточной игры «Кинг» для Telegram Mini App.

## Что внутри

- Одиночная партия против трех ботов — существующий режим сохранен.
- Сетевое лобби через Cloudflare Worker, Durable Objects и WebSocket: один Durable Object обслуживает одну комнату.
- Статический фронтенд раздается через Cloudflare Workers Static Assets.
- Комната создается кнопкой «Создать игру», хост автоматически занимает первое место, а ссылка имеет формат `https://t.me/BOT_USERNAME/APP_SHORT_NAME?startapp=room_ROOMID`.
- При старте Mini App приложение читает `Telegram.WebApp.initDataUnsafe.start_param`, а затем `tgWebAppStartParam` как fallback, и подключает игрока к комнате.
- В лобби отображаются четыре места с именем, Telegram-аватаром, статусом подключения и статусом «Готов».
- Сервер авторитетен: клиент отправляет только Telegram `initData`, а назначение мест, переподключение и старт комнаты проверяются в Durable Object.
- Firebase и D1 не используются.
- Колода на 32 карты: 7, 8, 9, 10, J, Q, K, A четырех мастей.
- Полная последовательность одиночной DOS-версии: 7 штрафных контрактов и затем те же 7 контрактов на плюс.

> Сейчас реализовано только сетевое лобби. Карточная игровая логика пока остается локальной/одиночной и не перенесена на сервер.

## Локальный запуск

### Одиночный статический режим

```bash
python3 -m http.server 8080
```

Откройте `http://localhost:8080`.

### Cloudflare Worker + Durable Objects + WebSocket

Для локальной разработки без Telegram включен явно отмеченный dev-режим в `src/config.js` для `localhost`/`127.0.0.1`, а Worker должен получить `DEV_AUTH=true`.

```bash
npx wrangler dev --var DEV_AUTH:true
```

Откройте URL, который покажет Wrangler. Хост нажимает «Создать игру», Worker создает короткий `roomId`, Durable Object закрепляет хоста за первым местом, а фронтенд показывает Telegram-ссылку для приглашения.

## WebSocket-протокол лобби

Клиент подключается к:

```text
GET /api/rooms/:roomId/ws?initData=<Telegram.WebApp.initData>
```

В dev-режиме без Telegram:

```text
GET /api/rooms/:roomId/ws?dev=1&devUser=<local-id>&devName=<name>
```

Сообщения сервера:

- `welcome` — подтверждение подключения: `{ roomId, seat, isHost }`.
- `roomState` — авторитетное состояние комнаты: `{ roomId, status, hostUserId, seats }`.
- `gameStarting` — хост запросил старт, проверка Durable Object пройдена.
- `error` — ошибка авторизации, заполненной комнаты или недопустимого действия.

Сообщения клиента:

- `setReady` — запрос сменить готовность текущего игрока: `{ type: "setReady", ready: true }`.
- `startGame` — запрос хоста начать игру. Durable Object принимает его только от хоста и только при минимум двух подключенных игроках.

## Авторизация Telegram

Фронтенд отправляет `Telegram.WebApp.initData` в Worker:

- для `POST /api/rooms` — в заголовке `x-telegram-init-data`;
- для WebSocket — в query-параметре `initData`.

Worker валидирует подпись через `BOT_TOKEN`, который хранится только как Cloudflare secret. `initDataUnsafe` используется на клиенте только для удобного отображения имени/параметра запуска и не является доказательством личности.

## Деплой в Cloudflare

1. Установите Wrangler, если он еще не установлен:

```bash
npm install --save-dev wrangler
```

2. Задайте секрет бота вручную:

```bash
npx wrangler secret put BOT_TOKEN
```

3. Проверьте `wrangler.jsonc`:

- `BOT_USERNAME` — username Telegram-бота без `@`;
- `APP_SHORT_NAME` — short name Mini App из BotFather;
- binding Durable Object `GAME_ROOM`;
- Static Assets binding `ASSETS`.

4. Задеплойте Worker:

```bash
npx wrangler deploy
```

5. В BotFather укажите HTTPS URL задеплоенного Worker как URL Mini App.

## Необходимые Cloudflare bindings

- `ASSETS` — Cloudflare Workers Static Assets, директория `.`.
- `GAME_ROOM` — Durable Object namespace для класса `GameRoom`.

## Секреты и переменные

Секреты, которые нужно добавить вручную:

- `BOT_TOKEN` — токен Telegram-бота из BotFather.

Переменные в `wrangler.jsonc`:

- `BOT_USERNAME` — имя бота без `@`.
- `APP_SHORT_NAME` — short name Mini App.
- `DEV_AUTH` — `false` в продакшене; `true` только для локальной разработки.

## Оригинальные ресурсы

Бинарные файлы оригинальной DOS-игры и извлеченные PNG не хранятся в репозитории. Для локальной работы положите оригиналы в `assets/original/` и используйте скрипт `scripts/extract_original_assets.py`; этот путь добавлен в `.gitignore` и должен оставаться только ссылкой в коде или документации. Подробнее см. `docs/original-assets.md`.
