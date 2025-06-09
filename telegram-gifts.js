import TelegramBot from 'node-telegram-bot-api';
import fs from 'fs';
import fetch from 'node-fetch';

// Токен бота
const token = '7222760906:AAHOv-zgIAngYZAJFnAK7WZ3MJWXpd8UWAk';

// Файлы для хранения данных
const chatIdFile = 'chat-id.json';
const cacheFile = 'gifts-cache.json';

// Интервал проверки (в миллисекундах): 1 минута = 60000 мс
const CHECK_INTERVAL = 60000;

// Инициализация бота
const bot = new TelegramBot(token, { polling: false });

// Функция для сохранения ID чата в файл
function saveChatId(id) {
  try {
    fs.writeFileSync(chatIdFile, JSON.stringify({ chatId: id }));
    console.log(`ID чата ${id} успешно сохранен в файл ${chatIdFile}`);
    return true;
  } catch (error) {
    console.error(`Ошибка при сохранении ID чата: ${error.message}`);
    return false;
  }
}

// Функция для загрузки ID чата из файла
function loadChatId() {
  try {
    if (fs.existsSync(chatIdFile)) {
      const data = JSON.parse(fs.readFileSync(chatIdFile, 'utf8'));
      return data.chatId;
    }
  } catch (error) {
    console.error(`Ошибка при загрузке ID чата: ${error.message}`);
  }
  return null;
}

// Функция для сохранения кэша подарков
function saveGiftsCache(gifts) {
  try {
    fs.writeFileSync(cacheFile, JSON.stringify(gifts, null, 2));
    console.log(`Кэш подарков обновлен (${gifts.length} подарков)`);
    return true;
  } catch (error) {
    console.error(`Ошибка при сохранении кэша: ${error.message}`);
    return false;
  }
}

// Функция для загрузки кэша подарков
function loadGiftsCache() {
  try {
    if (fs.existsSync(cacheFile)) {
      const data = JSON.parse(fs.readFileSync(cacheFile, 'utf8'));
      console.log(`Загружен кэш с ${data.length} подарками`);
      return data;
    }
  } catch (error) {
    console.error(`Ошибка при загрузке кэша: ${error.message}`);
  }
  return [];
}

// Функция для сохранения истории кэша подарков
function saveGiftsCacheHistory(gifts) {
  try {
    // Генерируем имя файла с текущей датой и временем
    const now = new Date();
    const dateStr = now.toISOString()
      .replace(/T/, '_')
      .replace(/:/g, '-')
      .replace(/\..+/, '');
    
    const historyFile = `gifts-cache-history-${dateStr}.json`;
    
    fs.writeFileSync(historyFile, JSON.stringify(gifts, null, 2));
    console.log(`История кэша сохранена в файл ${historyFile}`);
    return true;
  } catch (error) {
    console.error(`Ошибка при сохранении истории кэша: ${error.message}`);
    return false;
  }
}

// Функция для проверки, изменились ли подарки
function haveGiftsChanged(oldGifts, newGifts) {
  // Если разное количество подарков
  if (oldGifts.length !== newGifts.length) {
    return true;
  }
  
  // Создаем мапы с ID -> подарок для быстрого поиска
  const oldGiftsMap = new Map(oldGifts.map(gift => [gift.id, gift]));
  const newGiftsMap = new Map(newGifts.map(gift => [gift.id, gift]));
  
  // Проверяем, все ли ID из старого кэша есть в новом
  for (const id of oldGiftsMap.keys()) {
    if (!newGiftsMap.has(id)) {
      return true; // Нашли подарок, который был удален
    }
  }
  
  // Проверяем, все ли ID из нового кэша есть в старом
  for (const id of newGiftsMap.keys()) {
    if (!oldGiftsMap.has(id)) {
      return true; // Нашли новый подарок
    }
  }
  
  // Подарки те же самые
  return false;
}

// Функция для сравнения двух массивов подарков и нахождения новых
function findNewGifts(oldGifts, newGifts) {
  // Создаем Set из id старых подарков для быстрого поиска
  const oldGiftIds = new Set(oldGifts.map(gift => gift.id));
  
  // Находим подарки, которых нет в старом массиве
  return newGifts.filter(gift => !oldGiftIds.has(gift.id));
}

// Функция для форматирования подарка (упрощенная версия)
function formatGift(gift) {
  const emoji = gift.sticker?.emoji || '🎁';
  const starCount = gift.star_count || 0;
  
  // Формируем строку с информацией о подарке
  let message = `${emoji} *Подарок*\n`;
  message += `💫 Стоимость: ${starCount} звезд\n`;
  message += `🆔 ID: \`${gift.id}\`\n`;
  
  // Добавляем информацию о типе стикера
  if (gift.sticker && gift.sticker.type) {
    message += `📋 Тип: ${gift.sticker.type}\n`;
  }
  
  return message;
}

// Функция для генерации детальной информации о подарке для сохранения
function generateDetailedInfo(gift) {
  const lines = [];
  lines.push(`ID: ${gift.id}`);
  lines.push(`Звезды: ${gift.star_count}`);
  
  if (gift.sticker) {
    lines.push(`Эмодзи: ${gift.sticker.emoji}`);
    lines.push(`Тип: ${gift.sticker.type}`);
    lines.push(`Анимированный: ${gift.sticker.is_animated ? 'Да' : 'Нет'}`);
    lines.push(`Видео: ${gift.sticker.is_video ? 'Да' : 'Нет'}`);
    if (gift.sticker.custom_emoji_id) {
      lines.push(`Custom Emoji ID: ${gift.sticker.custom_emoji_id}`);
    }
  }
  
  return lines.join('\n');
}

// Функция для получения подарков через getAvailableGifts
async function getAvailableGifts() {
  try {
    // Делаем запрос к API
    const response = await fetch(`https://api.telegram.org/bot${token}/getAvailableGifts`);
    
    if (!response.ok) {
      throw new Error(`HTTP ошибка: ${response.status}`);
    }
    
    const data = await response.json();
    
    // Проверяем успешность запроса
    if (!data.ok) {
      throw new Error(data.description || 'Неизвестная ошибка API');
    }
    
    // Проверяем наличие подарков по пути result.gifts
    if (!data.result || !Array.isArray(data.result.gifts)) {
      console.log('Подарки не найдены или имеют неожиданный формат');
      return [];
    }
    
    return data.result.gifts;
  } catch (error) {
    console.error('Ошибка при получении подарков:', error.message);
    return [];
  }
}

// Функция проверки подарков и отправки уведомлений
async function checkAndNotify(chatId) {
  try {
    console.log(`[${new Date().toLocaleTimeString()}] Проверяем наличие новых подарков...`);
    
    // Загружаем кэш
    const cachedGifts = loadGiftsCache();
    
    // Получаем актуальный список подарков
    const currentGifts = await getAvailableGifts();
    
    if (currentGifts.length === 0) {
      console.log('Не удалось получить список подарков');
      return;
    }
    
    // Если это первый запуск (кэш пуст), просто сохраняем текущие подарки
    if (cachedGifts.length === 0) {
      console.log(`Первый запуск, сохраняем ${currentGifts.length} подарков в кэш`);
      saveGiftsCache(currentGifts);
      
      // Отправляем информацию о доступных подарках
      await bot.sendMessage(chatId, 
        `🎁 *Доступные подарки*\n\nНайдено ${currentGifts.length} подарков.`, 
        { parse_mode: 'Markdown' }
      );
      
      // Создаем файл с детальной информацией о подарках
      let detailedInfo = currentGifts.map((gift, index) => {
        return `=== Подарок #${index + 1} ===\n${generateDetailedInfo(gift)}\n`;
      }).join('\n');
      
      fs.writeFileSync('telegram-gifts-details.txt', detailedInfo);
      console.log('Сохранена детальная информация о подарках в файл telegram-gifts-details.txt');
      
      return;
    }
    
    // Проверяем, изменились ли подарки
    const giftsChanged = haveGiftsChanged(cachedGifts, currentGifts);
    
    // Если подарки изменились, сохраняем историю кэша
    if (giftsChanged) {
      console.log('Обнаружены изменения в списке подарков. Сохраняем историю кэша...');
      saveGiftsCacheHistory(cachedGifts);
    }
    
    // Находим новые подарки
    const newGifts = findNewGifts(cachedGifts, currentGifts);
    
    // Проверяем изменения в количестве подарков
    const removedCount = cachedGifts.length - (currentGifts.length - newGifts.length);
    
    // Обновляем кэш
    saveGiftsCache(currentGifts);
    
    // Если есть новые подарки, отправляем уведомления
    if (newGifts.length > 0) {
      console.log(`Найдено ${newGifts.length} новых подарков`);
      
      // Отправляем общее уведомление
      await bot.sendMessage(chatId, 
        `🔔 *Обнаружены новые подарки!*\n\nНайдено ${newGifts.length} новых подарков.`, 
        { parse_mode: 'Markdown' }
      );
      
      // Отправляем информацию о каждом новом подарке
      for (const gift of newGifts) {
        const message = formatGift(gift);
        await bot.sendMessage(chatId, message, { parse_mode: 'Markdown' });
        
        // Отправляем изображение стикера через sendPhoto, а не сам стикер
        // Emoji-стикеры нельзя отправлять через sendSticker
        if (gift.sticker && gift.sticker.thumbnail && gift.sticker.thumbnail.file_id) {
          try {
            // Отправляем миниатюру стикера как фото
            await bot.sendPhoto(chatId, gift.sticker.thumbnail.file_id, {
              caption: `Предпросмотр стикера (${gift.sticker.emoji})`
            });
          } catch (stickerError) {
            console.error('Ошибка при отправке изображения стикера:', stickerError.message);
          }
        }
        
        // Небольшая задержка между сообщениями
        await new Promise(resolve => setTimeout(resolve, 300));
      }
    } else {
      // Если нет новых подарков, но есть удаленные
      if (removedCount > 0) {
        console.log(`Удалено ${removedCount} подарков`);
        await bot.sendMessage(chatId, 
          `📉 *Изменения в списке подарков*\n\nУдалено ${removedCount} подарков.`, 
          { parse_mode: 'Markdown' }
        );
      } else {
        console.log('Новых подарков не найдено');
      }
    }
  } catch (error) {
    console.error('Ошибка при проверке подарков:', error.message);
  }
}

// Основная функция для запуска бота и мониторинга
async function startMonitoring() {
  // Загружаем сохраненный ID чата
  const chatId = loadChatId();
  
  if (!chatId) {
    console.log('ID чата не найден. Запустите скрипт и отправьте команду /start боту.');
    startBotForChatId();
    return;
  }
  
  console.log(`Используем сохраненный ID чата: ${chatId}`);
  console.log(`Мониторинг подарков запущен. Проверка каждые ${CHECK_INTERVAL / 1000} секунд.`);
  
  // Отправляем сообщение о запуске мониторинга
  await bot.sendMessage(chatId, 
    `🤖 *Мониторинг подарков запущен*\n\nБуду проверять наличие новых подарков каждую минуту и уведомлять вас о изменениях.`, 
    { parse_mode: 'Markdown' }
  );
  
  // Выполняем первую проверку сразу
  await checkAndNotify(chatId);
  
  // Запускаем периодическую проверку
  setInterval(() => checkAndNotify(chatId), CHECK_INTERVAL);
}

// Функция для запуска бота и получения ID чата
function startBotForChatId() {
  console.log('Запускаем бота для получения ID чата...');
  console.log('Отправьте команду /start боту, чтобы автоматически сохранить ID чата');
  
  // Запускаем режим polling
  bot.startPolling();
  
  // Добавляем обработчик команды /start
  bot.onText(/\/start/, async (msg) => {
    const receivedChatId = msg.chat.id;
    console.log(`Получен ID чата: ${receivedChatId}`);
    
    // Сохраняем ID чата
    if (saveChatId(receivedChatId)) {
      await bot.sendMessage(receivedChatId, 
        `✅ Ваш ID чата (${receivedChatId}) успешно сохранен!\n\nТеперь запущу мониторинг подарков.`
      );
      
      // Останавливаем бота и запускаем мониторинг
      bot.stopPolling();
      startMonitoring();
    } else {
      await bot.sendMessage(receivedChatId, 
        '⚠️ Не удалось сохранить ваш ID чата. Пожалуйста, проверьте права доступа к файлам.'
      );
    }
  });
}

// Запуск приложения
startMonitoring().catch(error => {
  console.error('Ошибка при запуске мониторинга:', error.message);
}); 