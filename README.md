# King_game

Адаптированная web-версия карточной игры «Кинг» для Telegram Mini App.

## Что внутри

- Одиночная партия против трех ботов.
- Колода на 32 карты: 7, 8, 9, 10, J, Q, K, A четырех мастей.
- 6 контрактов: штрафные раунды и финальный позитивный раунд на взятки.
- Поддержка Telegram WebApp API: `ready`, `expand`, theme params, haptic feedback и Main Button.
- Адаптивный интерфейс для мобильного Telegram, desktop Telegram и браузера.

## Локальный запуск

```bash
python3 -m http.server 8080
```

Откройте `http://localhost:8080`.

## Деплой для Telegram Mini App

1. Разместите статические файлы на HTTPS-хостинге.
2. В BotFather создайте Mini App и укажите URL на `index.html`.
3. Добавьте ссылку на Mini App в меню бота или кнопку Web App.
