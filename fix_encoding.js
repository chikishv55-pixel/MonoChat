const fs = require('fs');
const path = require('path');

function fixFile(filePath) {
    let content = fs.readFileSync(filePath, 'utf8');
    
    // Replace garbled stars (multiple variants of encoding mess)
    content = content.replace(/в˜…|в\?|в\?\?|в\?\?\?/g, '★');
    
    // Replace common garbled Russian phrases
    content = content.replace(/РЎР±СЂР°СЃС‹РІР°РµРј/g, 'Сбрасываем');
    content = content.replace(/РњРіРЅРѕРІРµРЅРЅР°СЏ РѕС‡РёСЃС‚РєР° СЃРѕРѕР±С‰РµРЅРёР№ Рё РїРѕРєР°Р· Р»РѕР°РґРµСЂР°/g, 'Мгновенная очистка сообщений и показ лоадера');
    
    fs.writeFileSync(filePath, content, 'utf8');
    console.log(`Fixed: ${filePath}`);
}

const jsDir = path.join(__dirname, 'public/js');
fs.readdirSync(jsDir).forEach(file => {
    if (file.endsWith('.js')) {
        fixFile(path.join(jsDir, file));
    }
});
