function initEmojiPicker() {
            const emojis = ['😀','😃','😄','😁','😆','😅','😂','🤣','🥲','🥹','😊','😇','🙂','🙃','😉','😌','😍','🥰','😘','😗','😙','😚','😋','😛','😝','😜','🤪','🤨','🧐','🤓','😎','🥸','🤩','🥳','😏','😒','😞','😔','😟','😕','🙁','☹️','😣','😖','😫','😩','🥺','😢','😭','😮‍💨','😤','😠','😡','🤬','🤯','😳','🥵','🥶','😱','😨','😰','😥','😓','🫣','🤭','🫢','🫡','🤫','🫠','🤥','😶','🫥','😐','🫤','😑','😬','🙄','😯','😦','😧','😮','😲','🥱','😴','🤤','😪','😵','😵‍💫','🤐','🥴','🤢','🤮','🤧','😷','🤒','🤕','🤑','🤠','😈','👿','👹','👺','🤡','💩','👻','💀','☠️','👽','👾','🤖','🎃','😺','😸','😹','😻','😼','😽','🙀','😿','😾','🙈','🙉','🙊','💋','💌','💘','💝','💖','💗','💓','💞','💕','💟','❣️','💔','❤️','🔥','💥','💯','💢','💬','👁️‍🗨️','🗨️','🗯️','💭','💤','👋','🤚','🖐️','✋','🖖','👌','🤌','🤏','✌️','🤞','🫰','🤟','🤘','🤙','👈','👉','👆','🖕','👇','☝️','👍','👎','✊','👊','🤛','🤜','👏','🙌','🫶','👐','🤲','🤝','🙏','✍️','💅','🤳','💪','🦾','🦿','🦵','🦶','👂','🦻','👃','🧠','🫀','🫁','🦷','🦴','👀','👁️','👅','👄','🫦'];
            const stickers = [
                'https://fonts.gstatic.com/s/e/notoemoji/latest/1f602/512.webp',
                'https://fonts.gstatic.com/s/e/notoemoji/latest/1f923/512.webp',
                'https://fonts.gstatic.com/s/e/notoemoji/latest/1f60d/512.webp',
                'https://fonts.gstatic.com/s/e/notoemoji/latest/1f970/512.webp',
                'https://fonts.gstatic.com/s/e/notoemoji/latest/1f60e/512.webp',
                'https://fonts.gstatic.com/s/e/notoemoji/latest/1f525/512.webp',
                'https://fonts.gstatic.com/s/e/notoemoji/latest/1f4af/512.webp',
                'https://fonts.gstatic.com/s/e/notoemoji/latest/1f44d/512.webp',
                'https://fonts.gstatic.com/s/e/notoemoji/latest/1f64f/512.webp',
                'https://fonts.gstatic.com/s/e/notoemoji/latest/1f389/512.webp',
                'https://fonts.gstatic.com/s/e/notoemoji/latest/1f973/512.webp',
                'https://fonts.gstatic.com/s/e/notoemoji/latest/1f914/512.webp',
                'https://fonts.gstatic.com/s/e/notoemoji/latest/1f62d/512.webp',
                'https://fonts.gstatic.com/s/e/notoemoji/latest/1f621/512.webp',
                'https://fonts.gstatic.com/s/e/notoemoji/latest/1f92f/512.webp'
            ];
            const tabEmojis = document.getElementById('tab-emojis');
            emojis.forEach(e => {
                const span = document.createElement('span'); span.className = 'emoji-item'; span.textContent = e;
                span.onclick = () => { const input = document.getElementById('message-text'); input.value += e; input.focus(); input.dispatchEvent(new Event('input')); };
                tabEmojis.appendChild(span);
            });
            const tabStickers = document.getElementById('tab-stickers');
            stickers.forEach(url => {
                const div = document.createElement('div'); div.className = 'sticker-item'; div.innerHTML = `<img src="${url}" loading="lazy">`;
                div.onclick = () => { emitMessage(url, 'sticker'); document.getElementById('emoji-picker').classList.remove('active'); };
                tabStickers.appendChild(div);
            });

            document.addEventListener('click', (e) => {
                const picker = document.getElementById('emoji-picker');
                const btn = document.getElementById('emoji-picker-btn');
                if (picker && picker.classList.contains('active') && !picker.contains(e.target) && !btn.contains(e.target)) {
                    picker.classList.remove('active');
                }
        }\n
