const express = require('express');
const app = express();

// نقطة نهاية بسيطة للحفاظ على الخدمة نشطة
app.get('/', (req, res) => {
    res.send('Service is alive!');
});

app.use(express.json());
const cors = require('cors');
app.use(cors());

// الاستماع إلى المنفذ الذي يوفره Render (أو 3000 محليًا)
app.listen(process.env.PORT || 3000, '0.0.0.0', () => {
    console.log('Server running on port', process.env.PORT || 3000);
});

const { Client, LocalAuth } = require('whatsapp-web.js');
const firebase = require('firebase-admin');
const cron = require('node-cron');
const qrcode = require('qrcode-terminal');
const { Timestamp } = require('firebase-admin/firestore');

// تهيئة Firebase
let serviceAccount;
try {
    serviceAccount = process.env.FIREBASE_SERVICE_ACCOUNT
        ? JSON.parse(process.env.FIREBASE_SERVICE_ACCOUNT)
        : require('./serviceAccountKey.json');
} catch (error) {
    console.error('خطأ في تحميل serviceAccountKey.json:', error.message);
    process.exit(1);
}

firebase.initializeApp({
    credential: firebase.credential.cert(serviceAccount)
});
const db = firebase.firestore();

// تهيئة WhatsApp
const client = new Client({
    authStrategy: new LocalAuth()
});

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
});
    const testMessage = 'رسالة اختبار من السكربت';
    client.sendMessage('120363041675138011@g.us', testMessage)
        .then(() => console.log('تم إرسال رسالة اختبار بنجاح'))
        .catch(err => console.error('خطأ في إرسال رسالة اختبار:', err));
});

client.on('auth_failure', msg => {
    console.error('فشل المصادقة:', msg);
});

client.on('disconnected', (reason) => {
    console.log('تم قطع الاتصال بـ WhatsApp:', reason);
    setTimeout(() => {
        client.initialize();
    }, 5000); // تأخير 5 ثوانٍ
});

// وظيفة إرسال النتائج
async function sendResults() {
    try {
        console.log('جارٍ جلب النتائج...');

        if (!client.info) {
            console.log('العميل غير جاهز، جارٍ الانتظار...');
            await new Promise(resolve => client.on('ready', resolve));
        }

        const lastCheckDoc = await db.collection('config').doc('lastCheck').get();
        let lastCheckTime = lastCheckDoc.exists
            ? lastCheckDoc.data().timestamp.toDate()
            : new Date(Date.now() - 30 * 60 * 1000);

        const currentCheckTime = new Date();
        const lastCheckTimestamp = Timestamp.fromDate(lastCheckTime);
        console.log('آخر فحص:', lastCheckTime.toISOString());
        console.log('الفحص الحالي:', currentCheckTime.toISOString());

        const results = await db.collection('studentResults')
            .where('timestamp', '>=', lastCheckTimestamp)
            .where('timestamp', '<=', Timestamp.fromDate(currentCheckTime))
            .get();

        console.log('عدد النتائج:', results.size);

        const groupId = '120363041675138011@g.us';
        console.log('معرف المجموعة:', groupId);

        if (results.empty) {
            console.log('لا توجد نتائج جديدة.');
            console.log('الاستعلام - lastCheckTimestamp:', lastCheckTimestamp.toDate().toISOString());
            console.log('الاستعلام - currentCheckTime:', currentCheckTime.toISOString());
            const allResults = await db.collection('studentResults').get();
            console.log('جميع النتائج في studentResults:', allResults.docs.map(doc => ({
                id: doc.id,
                timestamp: doc.data().timestamp?.toDate()?.toISOString()
            })));
            await db.collection('config').doc('lastCheck').set({
                timestamp: Timestamp.fromDate(currentCheckTime)
            });
            return;
        }

        for (const doc of results.docs) {
            const data = doc.data();
            console.log('بيانات المستند:', data);
            
            let studentName = data.studentName || 'غير معروف';
            if (data.studentEmail) {
                const studentDoc = await db.collection('studentimg')
                    .doc(data.studentEmail)
                    .get();
                if (studentDoc.exists) {
                    studentName = studentDoc.data().studentname || studentName;
                } else {
                    console.log(`لم يتم العثور على مستند في studentimg للإيميل: ${data.studentEmail}`);
                }
            }

            const score = data.score || 0;
            const total = data.total || 0;
            const level = data.level || 'غير محدد';
            const wrongQuestions = data.wrongQuestions || [];

            let message = `عزيزي ${studentName}، درجتك: ${score}/${total}\nالمستوى: ${level}`;

            if (wrongQuestions.length > 0) {
                let detailedMessage = message + `\nالأسئلة الخاطئة:\n`;
                wrongQuestions.forEach((q, index) => {
                    detailedMessage += `${index + 1}. ${q.question || 'غير متوفر'}\n`;
                    detailedMessage += `   إجابتك: ${q.userAnswer || 'غير متوفر'} | الإجابة الصحيحة: ${q.correctAnswer || 'غير متوفر'}\n`;
                });

                try {
                    await client.sendMessage(groupId, detailedMessage);
                    console.log(`تم إرسال الرسالة التفصيلية لـ ${studentName}`);
                } catch (error) {
                    console.error(`فشل إرسال الرسالة التفصيلية لـ ${studentName}:`, error.message);
                    const wrongQuestionNumbers = wrongQuestions.map((q, index) => index + 1);
                    message += `\nالأسئلة الخاطئة: ${wrongQuestionNumbers.join('، ')}`;
                    await client.sendMessage(groupId, message);
                    console.log(`تم إرسال الرسالة مع أرقام الأسئلة لـ ${studentName}`);
                }
            } else {
                await client.sendMessage(groupId, message);
                console.log(`تم إرسال الرسالة لـ ${studentName}`);
            }

            await new Promise(resolve => setTimeout(resolve, 300000)); // تأخير 5 دقائق // تأخير 5 ثوانٍ للاختبار المحلي
        }

        await db.collection('config').doc('lastCheck').set({
            timestamp: Timestamp.fromDate(currentCheckTime)
        });
    } catch (error) {
        console.error('خطأ في إرسال الرسائل:', error);
    }
}

// جدولة الفحص كل 3 دقائق
cron.schedule('0,30 12-23 * * *', () => {
    console.log('تشغيل وظيفة إرسال النتائج...');
    sendResults();
});

// sendResults(); // معطل للاختبار اليدوي

client.initialize();
