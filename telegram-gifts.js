import TelegramBot from 'node-telegram-bot-api';
import fs from 'fs';
import fetch from 'node-fetch';
import path from 'path';

// Токен бота
const token = '7222760906:AAHOv-zgIAngYZAJFnAK7WZ3MJWXpd8UWAk';

// Папка для хранения данных (в контейнере это будет примонтированный volume)
const dataDir = process.env.DATA_DIR || path.join(process.cwd(), 'data');
console.log(`Используем директорию для данных: ${dataDir}`);

// Создаем директорию для данных, если она не существует
if (!fs.existsSync(dataDir)) {
  try {
    fs.mkdirSync(dataDir, { recursive: true });
    console.log(`Создана директория для данных: ${dataDir}`);
  } catch (error) {
    console.error(`Ошибка при создании директории для данных: ${error.message}`);
    console.error(`Проверьте права доступа к директории: ${process.cwd()}`);
  }
}

// Файлы для хранения данных
const chatIdFile = path.join(dataDir, 'chat-ids.json');
const cacheFile = path.join(dataDir, 'gifts-cache.json');

// Интервал проверки (в миллисекундах): 10 секунд = 10000 мс
const CHECK_INTERVAL = Number(process.env.CHECK_INTERVAL) || 10000;

// Инициализация бота
const bot = new TelegramBot(token, { polling: false });

// Флаг для отслеживания статуса polling
let pollingActive = false;

// Функция для безопасного запуска polling
async function startPolling() {
  if (pollingActive) {
    console.log('Polling уже активен, пропускаем запуск');
    return;
  }
  
  try {
    console.log('Запускаем режим polling');
    await bot.startPolling({polling: true});
    pollingActive = true;
  } catch (error) {
    console.error('Ошибка при запуске polling:', error.message);
  }
}

// Функция для безопасной остановки polling
async function stopPolling() {
  if (!pollingActive) {
    console.log('Polling не активен, пропускаем остановку');
    return;
  }
  
  try {
    console.log('Останавливаем режим polling');
    await bot.stopPolling();
    pollingActive = false;
  } catch (error) {
    console.error('Ошибка при остановке polling:', error.message);
  }
}

// Флаг для отслеживания, работает ли бот в режиме получения chat_id или в режиме мониторинга
let botMode = 'initial'; // 'initial', 'chatid', 'monitoring'

// Функция для сохранения ID чата в файл
function saveChatId(id) {
  try {
    // Загружаем текущий список ID чатов
    let chatIds = [];
    if (fs.existsSync(chatIdFile)) {
      try {
        const data = JSON.parse(fs.readFileSync(chatIdFile, 'utf8'));
        chatIds = Array.isArray(data.chatIds) ? data.chatIds : [];
      } catch (parseError) {
        console.error(`Ошибка при чтении файла с ID чатов: ${parseError.message}`);
        chatIds = [];
      }
    }
    
    // Проверяем, есть ли уже такой ID в списке
    if (!chatIds.includes(id)) {
      chatIds.push(id);
    }
    
    fs.writeFileSync(chatIdFile, JSON.stringify({ chatIds: chatIds }));
    console.log(`ID чата ${id} успешно сохранен в файл ${chatIdFile}`);
    return true;
  } catch (error) {
    console.error(`Ошибка при сохранении ID чата: ${error.message}`);
    return false;
  }
}

// Функция для загрузки ID чатов из файла
function loadChatIds() {
  try {
    if (fs.existsSync(chatIdFile)) {
      const data = JSON.parse(fs.readFileSync(chatIdFile, 'utf8'));
      const chatIds = Array.isArray(data.chatIds) ? data.chatIds : [];
      console.log(`Загружены ID чатов: ${chatIds.length} чатов`);
      return chatIds;
    }
  } catch (error) {
    console.error(`Ошибка при загрузке ID чатов: ${error.message}`);
  }
  return [];
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
    
    const historyFile = path.join(dataDir, `gifts-cache-history-${dateStr}.json`);
    
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

// Функция для нахождения удаленных подарков
function findRemovedGifts(oldGifts, newGifts) {
  // Создаем Set из id новых подарков для быстрого поиска
  const newGiftIds = new Set(newGifts.map(gift => gift.id));
  
  // Находим подарки, которых нет в новом массиве
  return oldGifts.filter(gift => !newGiftIds.has(gift.id));
}

// Функция для безопасного форматирования текста в Markdown
function safeMarkdown(text) {
  if (!text) return '';
  
  // Экранируем специальные символы
  return String(text)
    .replace(/\_/g, '\\_')
    .replace(/\*/g, '\\*')
    .replace(/\[/g, '\\[')
    .replace(/\]/g, '\\]')
    .replace(/\(/g, '\\(')
    .replace(/\)/g, '\\)')
    .replace(/\~/g, '\\~')
    .replace(/\`/g, '\\`')
    .replace(/\>/g, '\\>')
    .replace(/\#/g, '\\#')
    .replace(/\+/g, '\\+')
    .replace(/\-/g, '\\-')
    .replace(/\=/g, '\\=')
    .replace(/\|/g, '\\|')
    .replace(/\{/g, '\\{')
    .replace(/\}/g, '\\}')
    .replace(/\./g, '\\.')
    .replace(/\!/g, '\\!');
}

// Функция для форматирования подарка (упрощенная версия)
function formatGift(gift) {
  const emoji = gift.sticker?.emoji || '🎁';
  const starCount = gift.star_count || 0;
  
  // Формируем строку с информацией о подарке
  let message = `${emoji} *Подарок*\n`;
  message += `💫 Стоимость: ${starCount} звезд\n`;
  
  // Добавляем информацию об улучшении подарка, если доступно
  if (gift.upgrade_star_count !== undefined) {
    message += `⭐ Улучшение: ${gift.upgrade_star_count} звезд\n`;
  }
  
  // Добавляем информацию о лимитированном подарке, если доступно
  if (gift.total_count !== undefined) {
    message += `📊 Всего доступно: ${gift.total_count}\n`;
  }
  
  if (gift.remaining_count !== undefined) {
    message += `🔄 Осталось: ${gift.remaining_count}\n`;
    
    // Если оба поля (total_count и remaining_count) доступны, можно рассчитать процент
    if (gift.total_count !== undefined && gift.total_count > 0) {
      const percentRemaining = Math.round((gift.remaining_count / gift.total_count) * 100);
      message += `📈 Доступность: ${percentRemaining}%\n`;
    }
  }
  
  message += `🆔 ID: ${safeMarkdown(gift.id)}\n`;
  
  // Добавляем информацию о типе стикера
  if (gift.sticker && gift.sticker.type) {
    message += `📋 Тип: ${safeMarkdown(gift.sticker.type)}\n`;
  }
  
  return message;
}

// Функция для генерации детальной информации о подарке для сохранения
function generateDetailedInfo(gift) {
  const lines = [];
  lines.push(`ID: ${gift.id}`);
  lines.push(`Звезды: ${gift.star_count}`);
  
  // Добавляем дополнительные поля, если они есть
  if (gift.upgrade_star_count !== undefined) {
    lines.push(`Стоимость улучшения: ${gift.upgrade_star_count} звезд`);
  }
  
  if (gift.total_count !== undefined) {
    lines.push(`Всего подарков: ${gift.total_count}`);
  }
  
  if (gift.remaining_count !== undefined) {
    lines.push(`Осталось подарков: ${gift.remaining_count}`);
    
    // Расчет процента оставшихся подарков
    if (gift.total_count !== undefined && gift.total_count > 0) {
      const percentRemaining = Math.round((gift.remaining_count / gift.total_count) * 100);
      lines.push(`Процент доступности: ${percentRemaining}%`);
    }
  }
  
  // if (gift.sticker) {
  //   lines.push(`Эмодзи: ${gift.sticker.emoji}`);
  //   lines.push(`Тип: ${gift.sticker.type}`);
  //   lines.push(`Анимированный: ${gift.sticker.is_animated ? 'Да' : 'Нет'}`);
  //   lines.push(`Видео: ${gift.sticker.is_video ? 'Да' : 'Нет'}`);
  //   if (gift.sticker.custom_emoji_id) {
  //     lines.push(`Custom Emoji ID: ${gift.sticker.custom_emoji_id}`);
  //   }
  // }
  
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

// Функция для краткого описания подарка в уведомлениях
function formatGiftSummary(gift, index) {
  const emoji = gift.sticker?.emoji || '🎁';
  const stars = gift.star_count || 0;
  let summary = `${emoji} ${safeMarkdown(`${index}. Стоимость: ${stars} звезд`)}`;
  
  // Добавляем краткую информацию о лимитированных подарках
  if (gift.remaining_count !== undefined && gift.total_count !== undefined) {
    summary += safeMarkdown(` [${gift.remaining_count}/${gift.total_count}]`);
  } else if (gift.remaining_count !== undefined) {
    summary += safeMarkdown(` [Осталось: ${gift.remaining_count}]`);
  }
  
  // Добавляем информацию о возможности улучшения
  if (gift.upgrade_star_count !== undefined) {
    summary += safeMarkdown(` (Улучшение: ${gift.upgrade_star_count} ⭐)`);
  }
  
  return summary;
}

// Функция для сортировки подарков (более редкие будут первыми)
function sortGiftsByRarity(gifts) {
  return [...gifts].sort((a, b) => {
    // Если у подарка нет total_count, то он не редкий и должен быть в конце списка
    if (a.total_count !== undefined && b.total_count === undefined) {
      return -1; // a идет первым
    }
    if (a.total_count === undefined && b.total_count !== undefined) {
      return 1; // b идет первым
    }
    
    // Если у обоих подарков есть total_count, сортируем по возрастанию (редкие первыми)
    if (a.total_count !== undefined && b.total_count !== undefined) {
      return a.total_count - b.total_count;
    }
    
    // Если нет total_count у обоих, сортируем по star_count (более дорогие первыми)
    if (a.star_count && b.star_count) {
      return b.star_count - a.star_count;
    }
    
    // В остальных случаях оставляем как есть
    return 0;
  });
}

// Функция для отправки изображения стикера
async function sendStickerInfo(chatId, gift) {
  try {
    if (!gift.sticker) {
      console.log('Подарок не содержит информацию о стикере');
      return;
    }
    
    // Проверяем тип стикера
    if (gift.sticker.type === 'custom_emoji') {
      // Для emoji-стикеров просто отправляем эмодзи в текстовом сообщении
      await bot.sendMessage(chatId, 
        `${gift.sticker.emoji} *Эмодзи-стикер (${gift.star_count} звезд)*\n\n` +
        `Тип: ${gift.sticker.type}\n` +
        `ID: ${gift.id.slice(-8)}`, 
        { parse_mode: 'Markdown' }
      );
      console.log(`Отправлен emoji-стикер ${gift.sticker.emoji} для пользователя ${chatId}`);
    } else if (gift.sticker.file_id) {
      // Для обычных стикеров используем метод sendSticker
      await bot.sendSticker(chatId, gift.sticker.file_id, {
        caption: `Стикер ${gift.sticker.emoji || ''} (${gift.star_count} звезд)`
      });
      console.log(`Отправлен стикер file_id=${gift.sticker.file_id.slice(0, 10)}... для пользователя ${chatId}`);
    } else {
      console.log('Стикер не содержит file_id или имеет неподдерживаемый формат');
      
      // Отправляем текстовую информацию о стикере
      await bot.sendMessage(chatId, 
        `🖼️ *Информация о стикере:*\n` +
        `${gift.sticker.emoji || '🎁'} Тип: ${gift.sticker.type || 'неизвестно'}\n` +
        `ID подарка: ${gift.id.slice(-8)}`, 
        { parse_mode: 'Markdown' }
      );
    }
  } catch (stickerError) {
    console.error('Ошибка при отправке стикера:', stickerError.message);
    
    // Если не удалось отправить стикер, отправляем только текстовую информацию
    try {
      await bot.sendMessage(chatId, 
        `🖼️ *Информация о стикере:*\n` +
        `${gift.sticker.emoji || '🎁'} Тип: ${gift.sticker.type || 'неизвестно'}\n` +
        `Анимированный: ${gift.sticker.is_animated ? 'Да' : 'Нет'}\n` +
        `Видео: ${gift.sticker.is_video ? 'Да' : 'Нет'}\n` +
        `ID подарка: ${gift.id.slice(-8)}`, 
        { parse_mode: 'Markdown' }
      );
    } catch (msgError) {
      console.error('Ошибка при отправке информации о стикере:', msgError.message);
    }
  }
}

// Функция для сравнения двух подарков и нахождения изменений
function findGiftChanges(oldGift, newGift) {
  if (!oldGift || !newGift) return null;
  
  const changes = {};
  
  // Проверяем основные поля
  if (oldGift.star_count !== newGift.star_count) {
    changes.star_count = {
      old: oldGift.star_count,
      new: newGift.star_count
    };
  }
  
  if (oldGift.upgrade_star_count !== newGift.upgrade_star_count) {
    changes.upgrade_star_count = {
      old: oldGift.upgrade_star_count,
      new: newGift.upgrade_star_count
    };
  }
  
  if (oldGift.total_count !== newGift.total_count) {
    changes.total_count = {
      old: oldGift.total_count,
      new: newGift.total_count
    };
  }
  
  if (oldGift.remaining_count !== newGift.remaining_count) {
    changes.remaining_count = {
      old: oldGift.remaining_count,
      new: newGift.remaining_count
    };
  }
  
  // Проверяем изменения в стикере, если он есть в обоих подарках
  if (oldGift.sticker && newGift.sticker) {
    // Проверяем поля стикера
    const stickerChanges = {};
    
    if (oldGift.sticker.emoji !== newGift.sticker.emoji) {
      stickerChanges.emoji = {
        old: oldGift.sticker.emoji,
        new: newGift.sticker.emoji
      };
    }
    
    if (oldGift.sticker.type !== newGift.sticker.type) {
      stickerChanges.type = {
        old: oldGift.sticker.type,
        new: newGift.sticker.type
      };
    }
    
    if (oldGift.sticker.is_animated !== newGift.sticker.is_animated) {
      stickerChanges.is_animated = {
        old: oldGift.sticker.is_animated,
        new: newGift.sticker.is_animated
      };
    }
    
    if (oldGift.sticker.is_video !== newGift.sticker.is_video) {
      stickerChanges.is_video = {
        old: oldGift.sticker.is_video,
        new: newGift.sticker.is_video
      };
    }
    
    // Если есть изменения в стикере, добавляем их в общий список изменений
    if (Object.keys(stickerChanges).length > 0) {
      changes.sticker = stickerChanges;
    }
  } else if (oldGift.sticker || newGift.sticker) {
    // Если стикер есть только в одном из подарков, считаем это изменением
    changes.sticker = {
      old: oldGift.sticker ? 'present' : 'absent',
      new: newGift.sticker ? 'present' : 'absent'
    };
  }
  
  // Если нет изменений, возвращаем null
  return Object.keys(changes).length > 0 ? changes : null;
}

// Функция для форматирования описания изменений в подарке
function formatGiftChanges(gift, changes) {
  const emoji = gift.sticker?.emoji || '🎁';
  let message = `${emoji} *Подарок ID: ${safeMarkdown(gift.id.slice(-8))}*\n`;
  // Форматируем изменения в основных полях
  if (changes.star_count) {
    message += `💫 Стоимость: ${changes.star_count.old || 'не указана'} → ${changes.star_count.new || 'не указана'}\n`;
  }
  
  if (changes.upgrade_star_count) {
    message += `⭐ Улучшение: ${changes.upgrade_star_count.old || 'не указано'} → ${changes.upgrade_star_count.new || 'не указано'}\n`;
  }
  
  if (changes.total_count) {
    message += `📊 Всего доступно: ${changes.total_count.old || 'не ограничено'} → ${changes.total_count.new || 'не ограничено'}\n`;
  }
  
  if (changes.remaining_count) {
    message += `🔄 Осталось: ${changes.remaining_count.old || 'не указано'} → ${changes.remaining_count.new || 'не указано'}\n`;
    
    // Расчет процента изменения, если есть данные
    if (changes.remaining_count.old && changes.remaining_count.new && gift.total_count) {
      const oldPercent = Math.round((changes.remaining_count.old / gift.total_count) * 100);
      const newPercent = Math.round((changes.remaining_count.new / gift.total_count) * 100);
      message += `📈 Доступность: ${oldPercent}% → ${newPercent}%\n`;
    }
  }
  
  // Форматируем изменения в стикере
  if (changes.sticker) {
    // Если это объект с полями стикера
    if (typeof changes.sticker === 'object' && changes.sticker.old !== 'present' && changes.sticker.new !== 'present') {
      message += `\n*Изменения в стикере:*\n`;
      
      if (changes.sticker.emoji) {
        message += `🔣 Эмодзи: ${changes.sticker.emoji.old || 'не указано'} → ${changes.sticker.emoji.new || 'не указано'}\n`;
      }
      
      if (changes.sticker.type) {
        message += `📋 Тип: ${safeMarkdown(changes.sticker.type.old || 'не указан')} → ${safeMarkdown(changes.sticker.type.new || 'не указан')}\n`;
      }
      
      if (changes.sticker.is_animated !== undefined) {
        message += `🎬 Анимированный: ${changes.sticker.is_animated.old ? 'Да' : 'Нет'} → ${changes.sticker.is_animated.new ? 'Да' : 'Нет'}\n`;
      }
      
      if (changes.sticker.is_video !== undefined) {
        message += `📹 Видео: ${changes.sticker.is_video.old ? 'Да' : 'Нет'} → ${changes.sticker.is_video.new ? 'Да' : 'Нет'}\n`;
      }
    } else {
      // Если стикер был добавлен или удален
      message += `📎 Стикер: ${changes.sticker.old === 'present' ? 'Был' : 'Отсутствовал'} → ${changes.sticker.new === 'present' ? 'Есть' : 'Удален'}\n`;
    }
  }
  
  return message;
}

// Функция проверки подарков и отправки уведомлений всем пользователям
async function checkAndNotifyAll() {
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
    
    // Загружаем ID всех чатов
    const chatIds = loadChatIds();
    
    // Если это первый запуск (кэш пуст), просто сохраняем текущие подарки
    if (cachedGifts.length === 0) {
      console.log(`Первый запуск, сохраняем ${currentGifts.length} подарков в кэш`);
      saveGiftsCache(currentGifts);
      
      // Сортируем подарки перед отображением (редкие первыми)
      const sortedGifts = sortGiftsByRarity(currentGifts);
      
      // Формируем одно сообщение со всей информацией
      let message = `🎁 *Доступные подарки*\n\nНайдено ${currentGifts.length} подарков.\n\n`;
      
      // Добавляем информацию о 5 самых редких подарках
      if (sortedGifts.length > 0) {
        message += `*Самые редкие подарки:*\n\n`;
        
        // Отображаем информацию о первых 5 (или меньше) подарках
        const giftsToShow = Math.min(sortedGifts.length, 5);
        for (let i = 0; i < giftsToShow; i++) {
          const gift = sortedGifts[i];
          
          message += `${i+1}. ${gift.sticker?.emoji || '🎁'} `;
          message += `*${gift.star_count || 0}⭐*`;
          
          if (gift.total_count !== undefined) {
            message += ` (Лимит: ${gift.total_count})`;
          }
          
          if (gift.remaining_count !== undefined) {
            message += ` [Осталось: ${gift.remaining_count}]`;
          }
          
          message += `\nID: ${gift.id.slice(-8)}\n\n`;
        }
        
        message += `Для полного списка отправьте /list или нажмите на кнопку "📋 Список подарков"`;
      }
      
      // Отправляем объединенное сообщение всем пользователям
      for (const chatId of chatIds) {
        try {
          await bot.sendMessage(chatId, message, { 
            parse_mode: 'Markdown',
            ...getMainKeyboard()
          });
          console.log(`Отправлено начальное сообщение о подарках пользователю ${chatId}`);
        } catch (error) {
          console.error(`Ошибка при отправке сообщения пользователю ${chatId}:`, error.message);
        }
      }
      
      // Создаем файл с детальной информацией о подарках
      let detailedInfo = sortedGifts.map((gift, index) => {
        return `=== Подарок #${index + 1} ===\n${generateDetailedInfo(gift)}\n`;
      }).join('\n');
      
      fs.writeFileSync(path.join(dataDir, 'telegram-gifts-details.txt'), detailedInfo);
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
    
    // Находим новые и удаленные подарки
    const newGifts = findNewGifts(cachedGifts, currentGifts);
    const removedGifts = findRemovedGifts(cachedGifts, currentGifts);
    
    // Находим подарки с изменениями в полях
    const modifiedGifts = [];
    
    // Проверяем каждый текущий подарок на наличие изменений
    for (const currentGift of currentGifts) {
      // Находим соответствующий подарок в кэше
      const cachedGift = cachedGifts.find(cached => cached.id === currentGift.id);
      
      // Если подарок найден в кэше, проверяем изменения
      if (cachedGift) {
        const changes = findGiftChanges(cachedGift, currentGift);
        
        // Если есть изменения, добавляем подарок и информацию об изменениях
        if (changes) {
          modifiedGifts.push({
            gift: currentGift,
            changes: changes
          });
        }
      }
    }
    
    // Сортируем все списки подарков по редкости
    const sortedNewGifts = sortGiftsByRarity(newGifts);
    const sortedRemovedGifts = sortGiftsByRarity(removedGifts);
    const sortedModifiedGifts = sortGiftsByRarity(modifiedGifts.map(item => item.gift)).map(gift => {
      const modifiedItem = modifiedGifts.find(item => item.gift.id === gift.id);
      return modifiedItem;
    });
    
    // Обновляем кэш
    saveGiftsCache(currentGifts);
    
    // Если есть изменения в списке подарков
    if (sortedNewGifts.length > 0 || sortedRemovedGifts.length > 0 || sortedModifiedGifts.length > 0) {
      // Формируем ОДНО большое сообщение со всеми изменениями
      let fullMessage = '🔄 *Изменения в списке подарков*\n\n';
      
      // Добавляем сводку изменений
      if (sortedNewGifts.length > 0) {
        fullMessage += `✅ *Добавлено ${sortedNewGifts.length} новых подарков:*\n`;
        for (let i = 0; i < sortedNewGifts.length; i++) {
          fullMessage += formatGiftSummary(sortedNewGifts[i], i+1) + '\n';
        }
        fullMessage += '\n';
      }
      
      if (sortedRemovedGifts.length > 0) {
        fullMessage += `❌ *Удалено ${sortedRemovedGifts.length} подарков:*\n`;
        for (let i = 0; i < sortedRemovedGifts.length; i++) {
          fullMessage += formatGiftSummary(sortedRemovedGifts[i], i+1) + '\n';
        }
        fullMessage += '\n';
      }
      
      if (sortedModifiedGifts.length > 0) {
        fullMessage += `📝 *Изменено ${sortedModifiedGifts.length} подарков:*\n`;
        for (let i = 0; i < sortedModifiedGifts.length; i++) {
          const { gift, changes } = sortedModifiedGifts[i];
          const emoji = gift.sticker?.emoji || '🎁';
          
          let changeDesc = `${emoji} ${safeMarkdown(`${i+1}. ID: ${gift.id.slice(-8)}`)}`;
          const changeFields = Object.keys(changes);
          if (changeFields.length > 0) {
            changeDesc += safeMarkdown(` (изменения: ${changeFields.join(', ')})`);
          }
          
          fullMessage += changeDesc + '\n';
        }
        fullMessage += '\n';
      }
      
      // Добавляем детальную информацию о новых подарках
      if (sortedNewGifts.length > 0) {
        fullMessage += `📦 *Подробная информация о новых подарках:*\n\n`;
        
        for (const gift of sortedNewGifts) {
          fullMessage += formatGift(gift) + '\n\n';
        }
      }
      
      // Добавляем информацию об удаленных подарках
      if (sortedRemovedGifts.length > 0) {
        fullMessage += `🗑️ *Информация об удаленных подарках:*\n\n`;
        
        for (const gift of sortedRemovedGifts) {
          fullMessage += formatGift(gift) + '\n\n';
        }
      }
      
      // Добавляем информацию об измененных подарках
      if (sortedModifiedGifts.length > 0) {
        fullMessage += `✏️ *Подробная информация об измененных подарках:*\n\n`;
        
        for (const { gift, changes } of sortedModifiedGifts) {
          fullMessage += formatGiftChanges(gift, changes) + '\n\n';
        }
      }
      
      // Проверяем размер сообщения и разбиваем на части при необходимости
      // Telegram имеет лимит примерно 4096 символов на сообщение
      const MAX_MESSAGE_LENGTH = 4000; // Оставляем небольшой запас
      
      // Отправляем уведомления всем подписанным пользователям
      for (const chatId of chatIds) {
        try {
          if (fullMessage.length <= MAX_MESSAGE_LENGTH) {
            // Если сообщение помещается в один блок, отправляем его
            await bot.sendMessage(chatId, fullMessage, { 
              parse_mode: 'Markdown',
              ...getMainKeyboard()
            });
            console.log(`Отправлено уведомление об изменениях пользователю ${chatId}`);
          } else {
            // Разбиваем на части
            console.log(`Сообщение слишком длинное (${fullMessage.length} символов), разбиваем на части`);
            
            // Сначала отправляем сводку изменений
            let summaryMessage = '🔄 *Изменения в списке подарков*\n\n';
            
            if (sortedNewGifts.length > 0) {
              summaryMessage += `✅ *Добавлено ${sortedNewGifts.length} новых подарков*\n`;
            }
            
            if (sortedRemovedGifts.length > 0) {
              summaryMessage += `❌ *Удалено ${sortedRemovedGifts.length} подарков*\n`;
            }
            
            if (sortedModifiedGifts.length > 0) {
              summaryMessage += `📝 *Изменено ${sortedModifiedGifts.length} подарков*\n`;
            }
            
            await bot.sendMessage(chatId, summaryMessage, { 
              parse_mode: 'Markdown',
              ...getMainKeyboard()
            });
            
            // Затем отправляем подробные сообщения, максимально группируя их
            // Новые подарки
            if (sortedNewGifts.length > 0) {
              let newGiftsMessage = `📦 *Подробная информация о новых подарках:*\n\n`;
              
              for (const gift of sortedNewGifts) {
                const giftInfo = formatGift(gift) + '\n\n';
                
                // Если добавление этого подарка превысит лимит, отправляем текущее сообщение и начинаем новое
                if (newGiftsMessage.length + giftInfo.length > MAX_MESSAGE_LENGTH) {
                  await bot.sendMessage(chatId, newGiftsMessage, { parse_mode: 'Markdown' });
                  newGiftsMessage = giftInfo;
                } else {
                  newGiftsMessage += giftInfo;
                }
              }
              
              // Отправляем оставшуюся информацию о новых подарках
              if (newGiftsMessage.length > 0) {
                await bot.sendMessage(chatId, newGiftsMessage, { parse_mode: 'Markdown' });
              }
            }
            
            // Удаленные подарки
            if (sortedRemovedGifts.length > 0) {
              let removedGiftsMessage = `🗑️ *Информация об удаленных подарках:*\n\n`;
              
              for (const gift of sortedRemovedGifts) {
                const giftInfo = formatGift(gift) + '\n\n';
                
                if (removedGiftsMessage.length + giftInfo.length > MAX_MESSAGE_LENGTH) {
                  await bot.sendMessage(chatId, removedGiftsMessage, { parse_mode: 'Markdown' });
                  removedGiftsMessage = giftInfo;
                } else {
                  removedGiftsMessage += giftInfo;
                }
              }
              
              if (removedGiftsMessage.length > 0) {
                await bot.sendMessage(chatId, removedGiftsMessage, { parse_mode: 'Markdown' });
              }
            }
            
            // Измененные подарки
            if (sortedModifiedGifts.length > 0) {
              let modifiedGiftsMessage = `✏️ *Подробная информация об измененных подарках:*\n\n`;
              
              for (const { gift, changes } of sortedModifiedGifts) {
                const giftInfo = formatGiftChanges(gift, changes) + '\n\n';
                
                if (modifiedGiftsMessage.length + giftInfo.length > MAX_MESSAGE_LENGTH) {
                  await bot.sendMessage(chatId, modifiedGiftsMessage, { parse_mode: 'Markdown' });
                  modifiedGiftsMessage = giftInfo;
                } else {
                  modifiedGiftsMessage += giftInfo;
                }
              }
              
              if (modifiedGiftsMessage.length > 0) {
                await bot.sendMessage(chatId, modifiedGiftsMessage, { parse_mode: 'Markdown' });
              }
            }
          }
          
          // Отправляем самые важные стикеры отдельно (только для новых подарков и только первые несколько)
          const MAX_STICKERS_TO_SEND = 3;
          if (sortedNewGifts.length > 0) {
            const stickersToSend = Math.min(sortedNewGifts.length, MAX_STICKERS_TO_SEND);
            
            for (let i = 0; i < stickersToSend; i++) {
              const gift = sortedNewGifts[i];
              await sendStickerInfo(chatId, gift);
              // Небольшая задержка между стикерами
              await new Promise(resolve => setTimeout(resolve, 300));
            }
          }
        } catch (error) {
          console.error(`Ошибка при отправке уведомления пользователю ${chatId}:`, error.message);
        }
      }
    } else {
      console.log('Изменений в списке подарков не обнаружено');
    }
  } catch (error) {
    console.error('Ошибка при проверке подарков:', error.message);
    
    // Загружаем ID всех чатов
    const chatIds = loadChatIds();
    
    // Отправляем сообщение об ошибке всем пользователям
    for (const chatId of chatIds) {
      try {
        await bot.sendMessage(chatId, 
          `⚠️ Произошла ошибка при проверке подарков: ${error.message}`, 
          { parse_mode: 'HTML' } // Используем HTML форматирование вместо Markdown при ошибке
        );
      } catch (sendError) {
        console.error(`Не удалось отправить сообщение об ошибке пользователю ${chatId}:`, sendError.message);
      }
    }
  }
}

// Функция для запуска бота и получения ID чата
async function startBotForChatId() {
  console.log('Запускаем бота для получения ID чатов...');
  console.log('Отправьте команду /start боту, чтобы автоматически сохранить ID чата');
  
  // Устанавливаем флаг режима бота
  botMode = 'chatid';
  
  // Настраиваем обработчики
  setupBotEventHandlers();
  
  // Запускаем режим polling
  await startPolling();
}

// Основная функция для запуска бота и мониторинга
async function startMonitoring() {
  try {
    // Загружаем сохраненный список ID чатов
    const chatIds = loadChatIds();
    
    if (chatIds.length === 0) {
      console.log('ID чатов не найдены. Запустите скрипт и отправьте команду /start боту.');
      await startBotForChatId();
      return;
    }
    
    // Устанавливаем флаг режима бота
    botMode = 'monitoring';
    
    console.log(`Используем сохраненные ID чатов: ${chatIds.join(', ')}`);
    console.log(`Мониторинг подарков запущен. Проверка каждые ${CHECK_INTERVAL / 1000} секунд.`);
    
    // Настраиваем обработчики команд
    setupBotEventHandlers();
    
    // Включаем polling режим
    await startPolling();
    
    // Отправляем сообщение о запуске мониторинга всем пользователям
    try {
      for (const chatId of chatIds) {
        await bot.sendMessage(chatId, 
          `🤖 *Мониторинг подарков запущен*\n\nБуду проверять наличие новых подарков каждые ${CHECK_INTERVAL / 1000} секунд и уведомлять вас о изменениях.`, 
          { 
            parse_mode: 'Markdown',
            ...getMainKeyboard()
          }
        );
        console.log(`Сообщение о запуске мониторинга отправлено пользователю ${chatId}`);
      }
    } catch (error) {
      console.error('Ошибка при отправке сообщения о запуске:', error.message);
    }
    
    // Выполняем первую проверку сразу
    console.log('Выполняем первую проверку подарков');
    await checkAndNotifyAll();
    
    // Запускаем периодическую проверку
    console.log(`Устанавливаем интервал проверки: ${CHECK_INTERVAL} мс`);
    setInterval(checkAndNotifyAll, CHECK_INTERVAL);
    
    // Обработка сигналов завершения для корректного завершения работы
    process.on('SIGTERM', () => gracefulShutdown('SIGTERM'));
    process.on('SIGINT', () => gracefulShutdown('SIGINT'));
  } catch (error) {
    console.error('Ошибка в функции startMonitoring:', error.message);
    throw error; // Пробрасываем ошибку дальше
  }
}

// Функция для создания клавиатуры с кнопками команд
function getMainKeyboard() {
  return {
    reply_markup: {
      keyboard: [
        [{ text: '📋 Список подарков' }, { text: '🔍 Подробности' }],
        [{ text: '❌ Отписаться' }, { text: '❓ Помощь' }]
      ],
      resize_keyboard: true
    }
  };
}

// Функция для настройки обработчиков событий бота
function setupBotEventHandlers() {
  console.log('Настройка обработчиков событий бота');
  
  // Очищаем все предыдущие обработчики
  bot.removeAllListeners();
  
  // Добавляем обработчик команды /start
  bot.onText(/\/start/, async (msg) => {
    try {
      const receivedChatId = msg.chat.id;
      const chatIds = loadChatIds();
      
      console.log(`Получена команда /start от пользователя ${receivedChatId}`);
      
      // Проверяем, есть ли пользователь в списке
      if (chatIds.includes(receivedChatId)) {
        // Пользователь уже подписан
        await bot.sendMessage(receivedChatId, 
          '🤖 *Вы уже подписаны на уведомления*\n\nИспользуйте кнопки ниже для управления ботом.', 
          { 
            parse_mode: 'Markdown',
            ...getMainKeyboard()
          }
        );
      } else {
        // Добавляем нового пользователя
        if (saveChatId(receivedChatId)) {
          await bot.sendMessage(receivedChatId, 
            `✅ *Подписка оформлена!*\n\nВаш ID чата (${receivedChatId}) успешно сохранен. Теперь вы будете получать уведомления о новых подарках.\n\nИспользуйте кнопки ниже для управления ботом:`, 
            { 
              parse_mode: 'Markdown',
              ...getMainKeyboard()
            }
          );
          
          // Отправляем персональное уведомление о текущих подарках только новому пользователю
          try {
            console.log(`Отправляем персональное уведомление новому пользователю ${receivedChatId}`);
            const currentGifts = await getAvailableGifts();
            
            if (currentGifts.length > 0) {
              // Сортируем подарки перед отображением (редкие первыми)
              const sortedGifts = sortGiftsByRarity(currentGifts);
              
              // Формируем сообщение со всей информацией
              let message = `🎁 *Доступные подарки*\n\nНайдено ${currentGifts.length} подарков.\n\n`;
              
              // Добавляем информацию о 5 самых редких подарках
              if (sortedGifts.length > 0) {
                message += `*Самые редкие подарки:*\n\n`;
                
                // Отображаем информацию о первых 5 (или меньше) подарках
                const giftsToShow = Math.min(sortedGifts.length, 5);
                for (let i = 0; i < giftsToShow; i++) {
                  const gift = sortedGifts[i];
                  
                  message += `${i+1}. ${gift.sticker?.emoji || '🎁'} `;
                  message += `*${gift.star_count || 0}⭐*`;
                  
                  if (gift.total_count !== undefined) {
                    message += ` (Лимит: ${gift.total_count})`;
                  }
                  
                  if (gift.remaining_count !== undefined) {
                    message += ` [Осталось: ${gift.remaining_count}]`;
                  }
                  
                  message += `\nID: ${gift.id.slice(-8)}\n\n`;
                }
                
                message += `Для полного списка используйте кнопку "📋 Список подарков"`;
              }
              
              // Отправляем объединенное сообщение
              await bot.sendMessage(receivedChatId, message, { 
                parse_mode: 'Markdown',
                ...getMainKeyboard()
              });
              
              // Отправляем 3 самых редких стикера
              const MAX_STICKERS_TO_SEND = 3;
              if (sortedGifts.length > 0) {
                const stickersToSend = Math.min(sortedGifts.length, MAX_STICKERS_TO_SEND);
                
                for (let i = 0; i < stickersToSend; i++) {
                  const gift = sortedGifts[i];
                  await sendStickerInfo(receivedChatId, gift);
                  // Небольшая задержка между стикерами
                  await new Promise(resolve => setTimeout(resolve, 300));
                }
              }
            } else {
              await bot.sendMessage(receivedChatId, 
                "⚠️ *Не удалось получить список подарков*\n\nПопробую проверить наличие подарков позже.", 
                { 
                  parse_mode: 'Markdown',
                  ...getMainKeyboard()
                }
              );
            }
          } catch (error) {
            console.error(`Ошибка при отправке персонального уведомления пользователю ${receivedChatId}:`, error.message);
            await bot.sendMessage(receivedChatId, 
              "⚠️ *Произошла ошибка при получении списка подарков*\n\nПопробую проверить наличие подарков позже.", 
              { 
                parse_mode: 'Markdown',
                ...getMainKeyboard()
              }
            );
          }
        } else {
          await bot.sendMessage(receivedChatId, 
            '⚠️ Не удалось оформить подписку. Пожалуйста, попробуйте позже или обратитесь к администратору.', 
            { parse_mode: 'Markdown' }
          );
        }
      }
    } catch (error) {
      console.error('Ошибка при обработке команды /start:', error.message);
    }
  });
  
  // Добавляем обработчик текстовых сообщений для кнопок
  bot.on('message', async (msg) => {
    try {
      if (!msg.text) return;
      
      const receivedChatId = msg.chat.id;
      const chatIds = loadChatIds();
      const text = msg.text.trim();
      
      // Обрабатываем только сообщения от подписанных пользователей
      if (!chatIds.includes(receivedChatId)) {
        if (text !== '/start') {
          await bot.sendMessage(receivedChatId, 
            '⚠️ Вы не подписаны на уведомления.\nОтправьте /start, чтобы подписаться.'
          );
        }
        return;
      }
      
      // Обработка кнопок
      switch (text) {
        case '📋 Список подарков':
          // Аналогично команде /list
          await handleListCommand(receivedChatId);
          break;
          
        case '🔍 Подробности':
          // Аналогично команде /details
          await handleDetailsCommand(receivedChatId);
          break;
          
        case '❌ Отписаться':
          // Аналогично команде /unsubscribe
          await handleUnsubscribeCommand(receivedChatId);
          break;
          
        case '❓ Помощь':
          // Аналогично команде /help
          await handleHelpCommand(receivedChatId);
          break;
      }
    } catch (error) {
      console.error('Ошибка при обработке сообщения:', error.message);
    }
  });
  
  // Добавляем обработчик для команды /unsubscribe (отписка)
  bot.onText(/\/unsubscribe/, async (msg) => {
    await handleUnsubscribeCommand(msg.chat.id);
  });
  
  // Обработчик команды для просмотра всех подарков
  bot.onText(/\/list/, async (msg) => {
    await handleListCommand(msg.chat.id);
  });
  
  // Обработчик команды для просмотра детальной информации о самых редких подарках
  bot.onText(/\/details/, async (msg) => {
    await handleDetailsCommand(msg.chat.id);
  });
  
  // Обработчик команды для получения помощи
  bot.onText(/\/help/, async (msg) => {
    await handleHelpCommand(msg.chat.id);
  });
  
  // Добавляем общий обработчик ошибок polling
  bot.on('polling_error', (error) => {
    console.error('Ошибка polling:', error.message);
    
    // Если ошибка связана с конфликтом экземпляров бота, перезапускаем polling
    if (error.message.includes('409 Conflict') || error.message.includes('terminated by other getUpdates request')) {
      console.log('Обнаружен конфликт polling, пробуем перезапустить через 5 секунд...');
      
      // Останавливаем polling
      stopPolling().then(() => {
        // Задержка перед перезапуском
        setTimeout(() => {
          console.log('Пробуем перезапустить polling после конфликта');
          startPolling().catch(error => {
            console.error('Ошибка при перезапуске polling:', error.message);
          });
        }, 5000);
      }).catch(error => {
        console.error('Ошибка при остановке polling:', error.message);
      });
    }
  });
}

// Функция обработки команды отписки
async function handleUnsubscribeCommand(chatId) {
  try {
    const chatIds = loadChatIds();
    
    if (chatIds.includes(chatId)) {
      // Удаляем пользователя из списка
      const newChatIds = chatIds.filter(id => id !== chatId);
      
      // Сохраняем обновленный список
      fs.writeFileSync(chatIdFile, JSON.stringify({ chatIds: newChatIds }));
      
      await bot.sendMessage(chatId, 
        '👋 *Вы успешно отписались от уведомлений*\n\nЕсли захотите снова получать уведомления, отправьте /start.', 
        { parse_mode: 'Markdown' }
      );
    } else {
      // Пользователь и так не подписан
      await bot.sendMessage(chatId, 
        '⚠️ Вы не были подписаны на уведомления.'
      );
    }
  } catch (error) {
    console.error('Ошибка при обработке команды отписки:', error.message);
  }
}

// Функция обработки команды список
async function handleListCommand(chatId) {
  try {
    // Получаем текущие подарки
    const currentGifts = await getAvailableGifts();
    
    // Если нет подарков
    if (currentGifts.length === 0) {
      await bot.sendMessage(chatId, '⚠️ Не удалось получить список подарков', getMainKeyboard());
      return;
    }
    
    // Сортируем подарки по редкости
    const sortedGifts = sortGiftsByRarity(currentGifts);
    
    // Отправляем общую информацию
    await bot.sendMessage(chatId, 
      `🎁 *Доступные подарки (всего ${sortedGifts.length})*\n\nОтсортировано по редкости, самые редкие первые:`, 
      { 
        parse_mode: 'Markdown',
        ...getMainKeyboard()
      }
    );
    
    // Создаем краткую сводку по всем подаркам
    let summaryMessage = '';
    
    // Группируем подарки по total_count для компактности
    const giftsByTotal = {};
    for (const gift of sortedGifts) {
      const totalKey = gift.total_count !== undefined ? gift.total_count.toString() : 'unlimited';
      if (!giftsByTotal[totalKey]) {
        giftsByTotal[totalKey] = [];
      }
      giftsByTotal[totalKey].push(gift);
    }
    
    // Формируем сообщение по группам
    for (const [totalKey, gifts] of Object.entries(giftsByTotal)) {
      const totalLabel = totalKey === 'unlimited' ? 'Неограниченное количество' : `Лимит: ${totalKey}`;
      summaryMessage += `\n*${totalLabel}* (${gifts.length} шт.)\n`;
      
      for (let i = 0; i < gifts.length; i++) {
        const gift = gifts[i];
        const emoji = gift.sticker?.emoji || '🎁';
        const stars = gift.star_count || 0;
        const remaining = gift.remaining_count !== undefined ? ` [${gift.remaining_count}/${totalKey}]` : '';
        
        summaryMessage += `${emoji} ${stars}⭐${remaining}\n`;
        
        // Если сообщение становится слишком длинным, отправляем его и начинаем новое
        if (summaryMessage.length > 3000) {
          await bot.sendMessage(chatId, summaryMessage, { parse_mode: 'Markdown' });
          summaryMessage = '';
        }
      }
    }
    
    // Отправляем оставшееся сообщение, если оно не пустое
    if (summaryMessage.length > 0) {
      await bot.sendMessage(chatId, summaryMessage, { 
        parse_mode: 'Markdown',
        ...getMainKeyboard()
      });
    }
  } catch (error) {
    console.error('Ошибка при обработке команды списка:', error.message);
  }
}

// Функция обработки команды детали
async function handleDetailsCommand(chatId) {
  try {
    // Получаем текущие подарки
    const currentGifts = await getAvailableGifts();
    
    // Если нет подарков
    if (currentGifts.length === 0) {
      await bot.sendMessage(chatId, '⚠️ Не удалось получить список подарков', getMainKeyboard());
      return;
    }
    
    // Сортируем подарки по редкости
    const sortedGifts = sortGiftsByRarity(currentGifts);
    
    // Отправляем информацию о 5 самых редких подарках
    await bot.sendMessage(chatId, 
      '🔍 *Детальная информация о самых редких подарках:*', 
      { 
        parse_mode: 'Markdown',
        ...getMainKeyboard() 
      }
    );
    
    // Определяем количество подарков для отображения (не более 5)
    const giftsToShow = Math.min(sortedGifts.length, 5);
    
    for (let i = 0; i < giftsToShow; i++) {
      const gift = sortedGifts[i];
      
      // Отправляем информацию о подарке
      await bot.sendMessage(chatId, formatGift(gift), { parse_mode: 'Markdown' });
      
      // Отправляем стикер
      await sendStickerInfo(chatId, gift);
      
      // Небольшая задержка между сообщениями
      await new Promise(resolve => setTimeout(resolve, 300));
    }
  } catch (error) {
    console.error('Ошибка при обработке команды деталей:', error.message);
  }
}

// Функция обработки команды помощь
async function handleHelpCommand(chatId) {
  try {
    await bot.sendMessage(chatId, 
      '📋 *Доступные команды:*\n\n' +
      '*📋 Список подарков* - Показать список всех доступных подарков\n' +
      '*🔍 Подробности* - Показать детальную информацию о самых редких подарках\n' +
      '*❌ Отписаться* - Отписаться от уведомлений\n' +
      '*❓ Помощь* - Показать это сообщение\n\n' +
      'Или используйте команды:\n' +
      '/start - Подписаться на уведомления\n' +
      '/list - Показать список всех доступных подарков\n' +
      '/details - Показать детальную информацию о самых редких подарках\n' +
      '/unsubscribe - Отписаться от уведомлений\n' +
      '/help - Показать это сообщение',
      { 
        parse_mode: 'Markdown',
        ...getMainKeyboard()
      }
    );
  } catch (error) {
    console.error('Ошибка при обработке команды помощи:', error.message);
  }
}

// Функция для корректного завершения работы
async function gracefulShutdown(signal) {
  console.log(`Получен сигнал ${signal}, завершаем работу...`);
  
  try {
    const chatIds = loadChatIds();
    if (chatIds.length > 0) {
      // Отправляем уведомление всем пользователям
      for (const chatId of chatIds) {
        try {
          await bot.sendMessage(chatId, 
            '⚠️ *Бот останавливается*\n\nМониторинг подарков приостановлен.', 
            { parse_mode: 'Markdown' }
          );
        } catch (sendError) {
          console.error(`Ошибка при отправке сообщения об остановке пользователю ${chatId}:`, sendError.message);
        }
      }
    }
    
    // Останавливаем polling
    await stopPolling();
    
    console.log('Бот успешно остановлен');
    process.exit(0);
  } catch (error) {
    console.error('Ошибка при завершении работы:', error.message);
    process.exit(1);
  }
}

// Запускаем приложение
startMonitoring().catch(error => {
  console.error('Ошибка при запуске мониторинга:', error.message);
}); 