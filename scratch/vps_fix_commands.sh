#!/bin/bash
# Скрипт для исправления путей загрузок на VPS
# Запустите эти команды на VPS через SSH

cd /root/monochrome-chat

# 1. Создаём папку uploads в корне проекта (если нет)
mkdir -p uploads/avatars uploads/media uploads/stories

# 2. Копируем все файлы из public/uploads в корневую uploads
cp -rn public/uploads/avatars/* uploads/avatars/ 2>/dev/null
cp -rn public/uploads/media/* uploads/media/ 2>/dev/null  
cp -rn public/uploads/stories/* uploads/stories/ 2>/dev/null

# 3. Проверяем результат
echo "=== uploads/avatars ==="
ls -la uploads/avatars/
echo "=== uploads/media ==="
ls -la uploads/media/
echo "=== uploads/stories ==="
ls -la uploads/stories/

# 4. Перезапускаем сервер
echo "=== Перезапуск сервера ==="
pm2 restart all 2>/dev/null || (pkill -f "node server.js"; sleep 1; nohup node server.js &)
echo "Готово!"
