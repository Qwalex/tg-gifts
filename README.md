# Telegram API Gift Fetcher

Скрипт для получения списка доступных подарков в Telegram через Bot API и отправки их в удобочитаемом формате в телеграм-бота.

## Установка и запуск

### Запуск напрямую через Node.js

1. Установите Node.js (если еще не установлен)
2. Клонируйте этот репозиторий или скачайте файлы
3. Установите зависимости:

```bash
npm install
```

4. Запустите скрипт:
```bash
npm start
```

### Запуск через Docker

1. Соберите Docker-образ:
```bash
docker build -t telegram-gifts-bot .
```

2. Запустите контейнер:
```bash
docker run -d --name telegram-gifts-bot -v $(pwd)/data:/app/data telegram-gifts-bot
```

3. Или используйте Docker Compose:
```bash
docker-compose up -d
```

## Настройка

### Переменные окружения

При использовании Docker вы можете задать следующие переменные окружения:

- `CHECK_INTERVAL` - интервал проверки в миллисекундах (по умолчанию 10000)
- `DATA_DIR` - путь к директории для хранения данных (по умолчанию `./data`)
- `TZ` - часовой пояс (например, `Europe/Moscow`)

### Пример запуска с переменными окружения:

```bash
docker run -d --name telegram-gifts-bot \
  -v $(pwd)/data:/app/data \
  -e CHECK_INTERVAL=5000 \
  -e TZ=Europe/Moscow \
  telegram-gifts-bot
```

## Автоматическая настройка

Скрипт автоматически сохраняет ID чата после первого запуска:

1. Запустите скрипт (напрямую или через Docker)
2. Отправьте команду `/start` вашему боту

Скрипт автоматически:
- Сохранит ID вашего чата в файл `data/chat-id.json`
- Получит и отправит список подарков
- При следующих запусках будет использовать сохраненный ID

## Данные

Все данные сохраняются в директории `data/`:
- `chat-id.json` - сохраненный ID чата
- `gifts-cache.json` - текущий кэш подарков
- `gifts-cache-history-*.json` - история изменений подарков
- `telegram-gifts-details.txt` - детальная информация о подарках

## Остановка

### Остановка Docker-контейнера:

```bash
docker stop telegram-gifts-bot
```

### Остановка Docker Compose:

```bash
docker-compose down
```

## Результаты

После запуска скрипт:
1. Получит список подарков через Bot API и HTTP запрос
2. Сохранит результаты в файлы `available-gifts.json` и `available-gifts-http.json`
3. Отправит результаты в удобочитаемом формате в телеграм-бота
4. Выведет результаты в консоль

## Формат сообщений в Telegram

Каждый подарок отправляется в отдельном сообщении в следующем формате:

```
🎁 Название подарка
📝 Описание подарка
💰 Цена: 100 USD
🏷️ Скидка: 20%
⏱️ Доступен до: 2023-12-31
```

## Примечание

Доступ к информации о подарках может требовать специальных разрешений для бота. Если вы получаете ошибку доступа, убедитесь, что:
1. Ваш бот имеет необходимые разрешения
2. Метод `getAvailableGifts` доступен в текущей версии Telegram Bot API

## Сброс настроек

Если вы хотите использовать другой чат, просто удалите файл `chat-id.json` и запустите скрипт заново. 