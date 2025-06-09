import TelegramBot from 'node-telegram-bot-api';
import fs from 'fs';
import fetch from 'node-fetch';
import path from 'path';

// Токен бота
const token = '7222760906:AAHOv-zgIAngYZAJFnAK7WZ3MJWXpd8UWAk';

// Папка для хранения данных (в контейнере это будет примонтированный volume)
const dataDir = process.env.DATA_DIR || path.join(process.cwd(), 'data');

// Создаем директорию для данных, если она не существует
if (!fs.existsSync(dataDir)) {
  fs.mkdirSync(dataDir, { recursive: true });
  console.log(`Создана директория для данных: ${dataDir}`);
}

// Файлы для хранения данных
const chatIdFile = path.join(dataDir, 'chat-id.json');
const cacheFile = path.join(dataDir, 'gifts-cache.json');

// Интервал проверки (в миллисекундах): 10 секунд = 10000 мс
const CHECK_INTERVAL = Number(process.env.CHECK_INTERVAL) || 10000;

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
    // Если у обоих подарков есть total_count, сортируем по возрастанию (редкие первыми)
    if (a.total_count !== undefined && b.total_count !== undefined) {
      return a.total_count - b.total_count;
    }
    
    // Если total_count есть только у одного из подарков, он становится приоритетнее
    if (a.total_count !== undefined && b.total_count === undefined) {
      return -1; // a идет первым
    }
    if (a.total_count === undefined && b.total_count !== undefined) {
      return 1; // b идет первым
    }
    
    // Если нет total_count, сортируем по star_count (более дорогие первыми)
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
    if (!gift.sticker || !gift.sticker.file_id) {
      console.log('Стикер не содержит file_id');
      return;
    }
    
    // Отправляем стикер с использованием file_id
    await bot.sendSticker(chatId, gift.sticker.file_id, {
      caption: `Стикер ${gift.sticker.emoji} (${gift.star_count} звезд)`
    });
  } catch (stickerError) {
    console.error('Ошибка при отправке стикера:', stickerError.message);
    
    // Если не удалось отправить стикер, отправляем только текстовую информацию
    try {
      await bot.sendMessage(chatId, 
        `🖼️ *Стикер:* ${gift.sticker.emoji}\n` +
        `📏 Размеры: ${gift.sticker.width}x${gift.sticker.height}\n` +
        `🔄 Анимированный: ${gift.sticker.is_animated ? 'Да' : 'Нет'}\n` +
        `🎬 Видео: ${gift.sticker.is_video ? 'Да' : 'Нет'}`, 
        { parse_mode: 'Markdown' }
      );
    } catch (msgError) {
      console.error('Ошибка при отправке информации о стикере:', msgError.message);
    }
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
      
      // Сортируем подарки перед отображением (редкие первыми)
      const sortedGifts = sortGiftsByRarity(currentGifts);
      
      // Отправляем информацию о доступных подарках
      await bot.sendMessage(chatId, 
        `🎁 *Доступные подарки*\n\nНайдено ${currentGifts.length} подарков.`, 
        { parse_mode: 'Markdown' }
      );
      
      // Создаем файл с детальной информацией о подарках
      let detailedInfo = sortedGifts.map((gift, index) => {
        return `=== Подарок #${index + 1} ===\n${generateDetailedInfo(gift)}\n`;
      }).join('\n');
      
      fs.writeFileSync(path.join(dataDir, 'telegram-gifts-details.txt'), detailedInfo);
      console.log('Сохранена детальная информация о подарках в файл telegram-gifts-details.txt');
      
      // Отправляем информацию о самых редких подарках
      if (sortedGifts.length > 0) {
        await bot.sendMessage(chatId, 
          '🔍 *Подробная информация о доступных подарках (отсортировано по редкости):*', 
          { parse_mode: 'Markdown' }
        );
        
        // Отправляем информацию о первых 5 (или меньше) подарках
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
      }
      
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
    
    // Проверяем, изменились ли оставшиеся количества подарков
    const updatedGifts = currentGifts.filter(currentGift => {
      // Находим соответствующий подарок в кэше
      const cachedGift = cachedGifts.find(cached => cached.id === currentGift.id);
      
      // Если найден и имеет поле remaining_count, проверяем, изменилось ли оно
      if (cachedGift && 
          (currentGift.remaining_count !== undefined || cachedGift.remaining_count !== undefined) &&
          currentGift.remaining_count !== cachedGift.remaining_count) {
        return true;
      }
      
      return false;
    });
    
    // Обновляем кэш
    saveGiftsCache(currentGifts);
    
    // Если есть изменения в списке подарков
    if (newGifts.length > 0 || removedGifts.length > 0 || updatedGifts.length > 0) {
      // Сортируем новые подарки по редкости
      const sortedNewGifts = sortGiftsByRarity(newGifts);
      const sortedRemovedGifts = sortGiftsByRarity(removedGifts);
      const sortedUpdatedGifts = sortGiftsByRarity(updatedGifts);
      
      // Составляем текст уведомления
      let summary = '🔄 *Изменения в списке подарков*\n\n';
      
      if (sortedNewGifts.length > 0) {
        summary += `✅ *Добавлено ${sortedNewGifts.length} новых подарков:*\n`;
        
        // Добавляем краткую информацию о каждом новом подарке
        for (let i = 0; i < sortedNewGifts.length; i++) {
          summary += formatGiftSummary(sortedNewGifts[i], i+1) + '\n';
        }
        
        summary += '\n';
      }
      
      if (sortedRemovedGifts.length > 0) {
        summary += `❌ *Удалено ${sortedRemovedGifts.length} подарков:*\n`;
        
        // Добавляем краткую информацию о каждом удаленном подарке
        for (let i = 0; i < sortedRemovedGifts.length; i++) {
          summary += formatGiftSummary(sortedRemovedGifts[i], i+1) + '\n';
        }
        
        summary += '\n';
      }
      
      if (sortedUpdatedGifts.length > 0) {
        summary += `📊 *Обновлено ${sortedUpdatedGifts.length} подарков:*\n`;
        
        // Добавляем информацию об изменении количества для каждого обновленного подарка
        for (let i = 0; i < sortedUpdatedGifts.length; i++) {
          const currentGift = sortedUpdatedGifts[i];
          const cachedGift = cachedGifts.find(cached => cached.id === currentGift.id);
          
          const emoji = currentGift.sticker?.emoji || '🎁';
          const oldRemaining = cachedGift?.remaining_count ?? 'N/A';
          const newRemaining = currentGift.remaining_count ?? 'N/A';
          
          summary += `${emoji} ${safeMarkdown(`${i+1}. ID: ${currentGift.id.slice(-6)}`)}`;
          summary += safeMarkdown(` [${oldRemaining} → ${newRemaining}]`);
          
          if (currentGift.total_count !== undefined) {
            const percentRemaining = Math.round((currentGift.remaining_count / currentGift.total_count) * 100);
            summary += safeMarkdown(` (${percentRemaining}% осталось)`);
          }
          
          summary += '\n';
        }
        
        summary += '\n';
      }
      
      // Отправляем общее уведомление об изменениях
      await bot.sendMessage(chatId, summary, { parse_mode: 'Markdown' });
      
      // Отправляем подробную информацию о каждом новом подарке
      if (sortedNewGifts.length > 0) {
        await bot.sendMessage(chatId, 
          '📦 *Подробная информация о новых подарках:*', 
          { parse_mode: 'Markdown' }
        );
        
        for (const gift of sortedNewGifts) {
          // Отправляем информацию о подарке
          await bot.sendMessage(chatId, formatGift(gift), { parse_mode: 'Markdown' });
          
          // Отправляем стикер
          await sendStickerInfo(chatId, gift);
          
          // Небольшая задержка между сообщениями
          await new Promise(resolve => setTimeout(resolve, 300));
        }
      }
      
      // Отправляем информацию об удаленных подарках, если они есть
      if (sortedRemovedGifts.length > 0) {
        await bot.sendMessage(chatId, 
          '🗑️ *Информация об удаленных подарках:*', 
          { parse_mode: 'Markdown' }
        );
        
        for (const gift of sortedRemovedGifts) {
          // Отправляем информацию об удаленном подарке
          await bot.sendMessage(chatId, formatGift(gift), { parse_mode: 'Markdown' });
          
          // Небольшая задержка между сообщениями
          await new Promise(resolve => setTimeout(resolve, 300));
        }
      }
      
      // Отправляем информацию об обновленных подарках с изменившимся количеством
      if (sortedUpdatedGifts.length > 0) {
        await bot.sendMessage(chatId, 
          '📈 *Информация об обновленных подарках:*', 
          { parse_mode: 'Markdown' }
        );
        
        for (const gift of sortedUpdatedGifts) {
          const cachedGift = cachedGifts.find(cached => cached.id === gift.id);
          
          // Формируем специальное сообщение с информацией об изменении
          let updateMsg = formatGift(gift);
          
          if (cachedGift && cachedGift.remaining_count !== undefined) {
            const change = gift.remaining_count - cachedGift.remaining_count;
            const changeSymbol = change > 0 ? '📈' : '📉';
            const changeText = change > 0 ? `увеличилось на ${change}` : `уменьшилось на ${Math.abs(change)}`;
            
            updateMsg += `\n${changeSymbol} *Количество ${changeText}*\n`;
            updateMsg += `${safeMarkdown(`Было: ${cachedGift.remaining_count}, стало: ${gift.remaining_count}`)}`;
          }
          
          // Отправляем информацию об обновленном подарке
          await bot.sendMessage(chatId, updateMsg, { parse_mode: 'Markdown' });
          
          // Небольшая задержка между сообщениями
          await new Promise(resolve => setTimeout(resolve, 300));
        }
      }
      
      // Дополнительно отправляем команду для проверки всех доступных подарков
      await bot.sendMessage(chatId, 
        '🔍 *Хотите увидеть полный список доступных подарков?*\n\nОтправьте команду /list для просмотра всех подарков, отсортированных по редкости.', 
        { parse_mode: 'Markdown' }
      );
    } else {
      console.log('Изменений в списке подарков не обнаружено');
    }
  } catch (error) {
    console.error('Ошибка при проверке подарков:', error.message);
    
    // Отправляем сообщение об ошибке
    try {
      await bot.sendMessage(chatId, 
        `⚠️ Произошла ошибка при проверке подарков: ${error.message}`, 
        { parse_mode: 'HTML' } // Используем HTML форматирование вместо Markdown при ошибке
      );
    } catch (sendError) {
      console.error('Не удалось отправить сообщение об ошибке:', sendError.message);
    }
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
    `🤖 *Мониторинг подарков запущен*\n\nБуду проверять наличие новых подарков каждые ${CHECK_INTERVAL / 1000} секунд и уведомлять вас о изменениях.`, 
    { parse_mode: 'Markdown' }
  );
  
  // Выполняем первую проверку сразу
  await checkAndNotify(chatId);
  
  // Запускаем периодическую проверку
  setInterval(() => checkAndNotify(chatId), CHECK_INTERVAL);
  
  // Обработка сигналов завершения для корректного завершения работы
  process.on('SIGTERM', () => gracefulShutdown('SIGTERM'));
  process.on('SIGINT', () => gracefulShutdown('SIGINT'));
}

// Функция для корректного завершения работы
async function gracefulShutdown(signal) {
  console.log(`Получен сигнал ${signal}, завершаем работу...`);
  
  try {
    const chatId = loadChatId();
    if (chatId) {
      await bot.sendMessage(chatId, 
        '⚠️ *Бот останавливается*\n\nМониторинг подарков приостановлен.', 
        { parse_mode: 'Markdown' }
      );
    }
  } catch (error) {
    console.error('Ошибка при отправке сообщения об остановке:', error.message);
  }
  
  console.log('Бот успешно остановлен');
  process.exit(0);
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
  
  // Обработка сигналов завершения
  process.on('SIGTERM', () => {
    bot.stopPolling();
    process.exit(0);
  });
  
  process.on('SIGINT', () => {
    bot.stopPolling();
    process.exit(0);
  });
}

// Функция для запуска режима polling
function startPolling(chatId) {
  console.log(`Запуск в режиме polling с интервалом ${CHECK_INTERVAL} мс`);
  
  // Включаем режим polling
  bot.startPolling();
  
  // Отправляем сообщение о запуске мониторинга
  bot.sendMessage(chatId, 
    `🤖 *Мониторинг подарков запущен*\n\nБуду проверять наличие новых подарков каждые ${CHECK_INTERVAL / 1000} секунд и уведомлять вас о изменениях.`, 
    { parse_mode: 'Markdown' }
  );
  
  // Выполняем первую проверку сразу
  checkAndNotify(chatId);
  
  // Запускаем периодическую проверку
  setInterval(() => checkAndNotify(chatId), CHECK_INTERVAL);
  
  // Обработка сигналов завершения для корректного завершения работы
  process.on('SIGTERM', () => gracefulShutdown('SIGTERM'));
  process.on('SIGINT', () => gracefulShutdown('SIGINT'));
  
  // Обработчик команды для проверки подарков
  bot.onText(/\/check/, (msg) => {
    const receivedChatId = msg.chat.id;
    if (receivedChatId.toString() === chatId.toString()) {
      bot.sendMessage(chatId, '🔍 Проверяю наличие новых подарков...');
      checkAndNotify(chatId);
    }
  });
  
  // Обработчик команды для просмотра всех подарков
  bot.onText(/\/list/, async (msg) => {
    const receivedChatId = msg.chat.id;
    if (receivedChatId.toString() === chatId.toString()) {
      // Получаем текущие подарки
      const currentGifts = await getAvailableGifts();
      
      // Если нет подарков
      if (currentGifts.length === 0) {
        await bot.sendMessage(chatId, '⚠️ Не удалось получить список подарков');
        return;
      }
      
      // Сортируем подарки по редкости
      const sortedGifts = sortGiftsByRarity(currentGifts);
      
      // Отправляем общую информацию
      await bot.sendMessage(chatId, 
        `🎁 *Доступные подарки (всего ${sortedGifts.length})*\n\nОтсортировано по редкости, самые редкие первые:`, 
        { parse_mode: 'Markdown' }
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
        await bot.sendMessage(chatId, summaryMessage, { parse_mode: 'Markdown' });
      }
      
      // Предлагаем посмотреть детальную информацию о самых редких подарках
      await bot.sendMessage(chatId, 
        '🔍 *Хотите увидеть детальную информацию о самых редких подарках?*\n\nОтправьте команду /details для просмотра.', 
        { parse_mode: 'Markdown' }
      );
    }
  });
  
  // Обработчик команды для просмотра детальной информации о самых редких подарках
  bot.onText(/\/details/, async (msg) => {
    const receivedChatId = msg.chat.id;
    if (receivedChatId.toString() === chatId.toString()) {
      // Получаем текущие подарки
      const currentGifts = await getAvailableGifts();
      
      // Если нет подарков
      if (currentGifts.length === 0) {
        await bot.sendMessage(chatId, '⚠️ Не удалось получить список подарков');
        return;
      }
      
      // Сортируем подарки по редкости
      const sortedGifts = sortGiftsByRarity(currentGifts);
      
      // Отправляем информацию о 5 самых редких подарках
      await bot.sendMessage(chatId, 
        '🔍 *Детальная информация о самых редких подарках:*', 
        { parse_mode: 'Markdown' }
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
    }
  });
  
  // Обработчик команды для получения помощи
  bot.onText(/\/help/, (msg) => {
    const receivedChatId = msg.chat.id;
    if (receivedChatId.toString() === chatId.toString()) {
      bot.sendMessage(chatId, 
        '📋 *Доступные команды:*\n\n' +
        '/check - Проверить наличие новых подарков\n' +
        '/list - Показать список всех доступных подарков\n' +
        '/details - Показать детальную информацию о самых редких подарках\n' +
        '/help - Показать это сообщение',
        { parse_mode: 'Markdown' }
      );
    }
  });
}

// Запуск приложения
startMonitoring().catch(error => {
  console.error('Ошибка при запуске мониторинга:', error.message);
}); 