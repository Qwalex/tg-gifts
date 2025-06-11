FROM node:18-alpine

# Создаем рабочую директорию
WORKDIR /app

# Копируем файлы package.json и package-lock.json
COPY package*.json ./

# Устанавливаем зависимости
RUN npm install

# Создаем директорию для данных
RUN mkdir -p /app/data

# Копируем данные (если они есть)
COPY ./data/ /app/data/

# Копируем исходный код
COPY . .

# Указываем, что контейнер должен слушать порт 3000 (опционально)
EXPOSE 3000

# Указываем переменные среды
ENV NODE_ENV=production

# Запускаем приложение
CMD ["node", "telegram-gifts.js"] 