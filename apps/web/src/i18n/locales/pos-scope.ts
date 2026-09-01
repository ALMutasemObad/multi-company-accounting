const ar = {
  title: "التحقق من سياق نقطة البيع", checking: "جارٍ التحقق من المستخدم والنشاط قبل إظهار بيانات البيع…",
  stopped: "توقف إعداد البيع لأن سياق الجلسة لم يعد مؤكدًا. عد إلى المستخدم والنشاط الأصليين من خيارات الحساب المعتادة، ثم تحقق هنا.",
  retained: "إن كانت هناك محاولة بيع، فعلامتها باقية ولم تُحسم. لا تعِد إرسالها؛ التحقق يقرأ النتيجة الأصلية فقط. السلة لا تُستعاد بعد إعادة تحميل الصفحة.",
  verify: "التحقق من السياق الأصلي", review: "راجع سياق البيع واعتمده قبل التأكيد.",
  noAccess: "يلزم اختيار نشاط وصلاحية عرض نقطة البيع أو إتمام البيع. لم تُقرأ بيانات بيع.",
};
type Copy = { [K in keyof typeof ar]: string };
const en: Copy = { title: "Verify point of sale context", checking: "Verifying the user and company before showing sale data…",
  stopped: "Sale preparation is stopped because the session context is no longer confirmed. Return to the original user and company using the usual account controls, then verify here.",
  retained: "Any existing sale attempt keeps its marker and remains unresolved. Do not resend it; verification only reads the original outcome. Reloading does not restore the cart.",
  verify: "Verify original context", review: "Review and approve the sale context before checkout.", noAccess: "Select a company with permission to view sales or check out. No sale data was read." };
const hi: Copy = { title: "बिक्री संदर्भ सत्यापित करें", checking: "बिक्री डेटा दिखाने से पहले उपयोगकर्ता और कंपनी की जाँच हो रही है…",
  stopped: "सत्र का संदर्भ पुष्ट नहीं है, इसलिए बिक्री की तैयारी रोक दी गई है। सामान्य खाते के नियंत्रणों से मूल उपयोगकर्ता और कंपनी पर लौटें, फिर यहाँ जाँचें।",
  retained: "मौजूदा बिक्री प्रयास का संकेत सुरक्षित है और परिणाम अनिश्चित है। उसे दोबारा न भेजें; जाँच केवल मूल परिणाम पढ़ती है। पेज दोबारा लोड करने पर कार्ट बहाल नहीं होता।",
  verify: "मूल संदर्भ की जाँच करें", review: "बिक्री पूरी करने से पहले संदर्भ की समीक्षा और पुष्टि करें।", noAccess: "बिक्री देखने या पूरी करने की अनुमति वाली कंपनी चुनें। कोई बिक्री डेटा नहीं पढ़ा गया।" };
const ur: Copy = { title: "فروخت کے سیاق کی تصدیق", checking: "فروخت دکھانے سے پہلے صارف اور کمپنی کی تصدیق جاری ہے…",
  stopped: "سیشن کا سیاق تصدیق شدہ نہیں، اس لیے فروخت کی تیاری روک دی گئی ہے۔ معمول کے اکاؤنٹ کنٹرول سے اصل صارف اور کمپنی پر واپس آئیں، پھر یہاں تصدیق کریں۔",
  retained: "فروخت کی موجودہ کوشش کا نشان برقرار ہے اور نتیجہ غیر یقینی ہے۔ دوبارہ نہ بھیجیں؛ تصدیق صرف اصل نتیجہ پڑھتی ہے۔ صفحہ دوبارہ لوڈ کرنے سے ٹوکری بحال نہیں ہوتی۔",
  verify: "اصل سیاق کی تصدیق کریں", review: "فروخت مکمل کرنے سے پہلے سیاق کا جائزہ لیں اور منظور کریں۔", noAccess: "فروخت دیکھنے یا مکمل کرنے کی اجازت والی کمپنی منتخب کریں۔ فروخت کا کوئی ڈیٹا نہیں پڑھا گیا۔" };
export const posScopeDictionaries = { ar, en, hi, ur };
