const { Client } = require('whatsapp-web.js');
const qrcode = require('qrcode-terminal');

const client = new Client();

client.on('qr', qr => {
    console.log('امسح رمز QR:');
    qrcode.generate(qr, { small: true });
});

client.on('ready', () => {
    console.log('العميل جاهز!');
    client.getChats().then(chats => {
        const groups = chats.filter(chat => chat.isGroup);
        groups.forEach(group => {
            console.log(`اسم المجموعة: ${group.name}, المعرف: ${group.id._serialized}`);
        });
        client.destroy();
    });
});

client.initialize();