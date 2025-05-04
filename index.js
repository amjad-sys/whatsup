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
    const testMessage = 'رسالة اختبار من السكربت';
    client.sendMessage('120363041675138011@g.us', testMessage) // استبدل بمعرف المجموعة الصحيح
        .then(() => console.log('تم إرسال رسالة اختبار بنجاح'))
        .catch(err => console.error('خطأ في إرسال رسالة اختبار:', err));
});

client.on('auth_failure', msg => {
    console.error('فشل المصادقة:', msg);
});

// وظيفة إرسال النتائج
async function sendResults() {
    try {
        console.log('جارٍ جلب النتائج...');

        if (!client.info) {
            console.log('العميل غير جاهز، جارٍ الانتظار...');
            await new Promise(resolve => client.on('ready', resolve));
        }

        // جلب آخر وقت إرسال من Firestore
        const lastCheckDoc = await db.collection('config').doc('lastCheck').get();
        let lastCheckTime = lastCheckDoc.exists
            ? lastCheckDoc.data().timestamp.toDate()
            : new Date(Date.now() - 30 * 60 * 1000); // افتراضي: آخر 30 دقيقة

        const currentCheckTime = new Date();
        const lastCheckTimestamp = Timestamp.fromDate(lastCheckTime);
        console.log('آخر فحص:', lastCheckTime.toISOString());
        console.log('الفحص الحالي:', currentCheckTime.toISOString());

        const results = await db.collection('studentResults')
            .where('timestamp', '>=', lastCheckTimestamp)
            .where('timestamp', '<=', Timestamp.fromDate(currentCheckTime))
            .get();

        console.log('عدد النتائج:', results.size);

        const groupId = '120363041675138011@g.us'; // استبدل بمعرف المجموعة الصحيح
        console.log('معرف المجموعة:', groupId);

        if (results.empty) {
            console.log('لا توجد نتائج جديدة.');
            await db.collection('config').doc('lastCheck').set({
                timestamp: Timestamp.fromDate(currentCheckTime)
            });
            return;
        }

        for (const doc of results.docs) {
            const data = doc.data();
            console.log('بيانات المستند:', data);
            
            // جلب الاسم بالعربية من studentimg باستخدام studentEmail
            let studentName = data.studentName || 'غير معروف'; // الاسم الافتراضي
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

            // إعداد الرسالة الأساسية
            let message = `عزيزي ${studentName}، درجتك: ${score}/${total}\nالمستوى: ${level}`;

            // إذا كانت هناك أسئلة خاطئة
            if (wrongQuestions.length > 0) {
                // المحاولة الأولى: إرسال تفاصيل الأسئلة الخاطئة
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
                    
                    // المحاولة الثانية: إرسال أرقام الأسئلة فقط
                    const wrongQuestionNumbers = wrongQuestions.map((q, index) => index + 1);
                    message += `\nالأسئلة الخاطئة: ${wrongQuestionNumbers.join('، ')}`;
                    await client.sendMessage(groupId, message);
                    console.log(`تم إرسال الرسالة مع أرقام الأسئلة لـ ${studentName}`);
                }
            } else {
                // إذا لم تكن هناك أسئلة خاطئة، أرسل الرسالة الأساسية
                await client.sendMessage(groupId, message);
                console.log(`تم إرسال الرسالة لـ ${studentName}`);
            }

            await new Promise(resolve => setTimeout(resolve, 5000));
        }

        // تحديث وقت آخر إرسال
        await db.collection('config').doc('lastCheck').set({
            timestamp: Timestamp.fromDate(currentCheckTime)
        });
    } catch (error) {
        console.error('خطأ في إرسال الرسائل:', error);
    }
}

// جدولة الفحص كل 30 دقيقة على مدار اليوم
cron.schedule('0,30 * * * *', () => {
    console.log('تشغيل وظيفة إرسال النتائج...');
    sendResults();
});

sendResults(); // تفعيل للاختبار اليدوي

client.initialize();