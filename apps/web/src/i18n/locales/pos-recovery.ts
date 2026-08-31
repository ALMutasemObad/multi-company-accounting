export const arPosRecovery = {
  title: "استرجاع نتيجة البيع", unknown: "قد يكون الخادم أتم البيع. تبقى السلة مقفلة حتى تصل نتيجة مؤكدة؛ لا تنشئ بيعًا بديلًا.",
  check: "التحقق من نتيجة البيع", checking: "جارٍ التحقق من النتيجة…", pending: "جارٍ إرسال البيع…",
  confirmed: "أكد الخادم اكتمال محاولة البيع الأصلية.", historical: "هذه نتيجة التنفيذ الأصلية، وليست بيانًا بالحالة الحالية للمستندين بعد أي عكس لاحق.",
  expired: "تجاوزت المحاولة مهلة إعادة الإرسال الآمنة. التحقق للقراءة فقط؛ عدم العثور لا يثبت فشل البيع. راجع المسؤول إذا لم تظهر نتيجة.",
  clock: "وقت الجهاز غير معتبر. يبقى القفل؛ التحقق يقرأ نتيجة الخادم ولا يعيد إرسال البيع.",
  storage: "تعذر التحقق من علامة الاسترجاع في المتصفح. البيع مقفل؛ لا تمسح بيانات الموقع لتجاوز القفل. راجع المسؤول.",
  coordination: "تعذر تأمين المحاولة بين تبويبات المتصفح. لم يُسمح ببدء بيع؛ استخدم متصفحًا يدعم التنسيق الآمن.",
  permission: "يلزم سياق مستخدم ونشاط مصرح لهما لإظهار نتيجة البيع. تغيير السياق لا يحسم المحاولة السابقة.",
  invoice: "الفاتورة", receipt: "سند القبض", total: "إجمالي الخادم", newSale: "بدء بيع جديد", initializing: "جارٍ فحص علامة الاسترجاع…",
} as const;
export type PosRecoveryDictionary = { [K in keyof typeof arPosRecovery]: string };
export const enPosRecovery: PosRecoveryDictionary = {
  title: "Recover sale outcome", unknown: "The server may have completed the sale. The cart stays locked until a confirmed result arrives. Do not create a replacement sale.",
  check: "Check sale outcome", checking: "Checking the outcome…", pending: "Sending the sale…",
  confirmed: "The server confirmed completion of the original sale attempt.", historical: "This is the original command outcome, not the current status of documents after any later reversal.",
  expired: "The safe resubmission window has passed. Checking is read only; not finding a result does not mean the sale failed. Ask an administrator if no result appears.",
  clock: "The device clock is invalid. The lock remains; checking reads the server result without resending the sale.",
  storage: "The browser recovery marker could not be verified. Sales are locked. Do not clear site data to bypass this lock; ask an administrator.",
  coordination: "This browser cannot safely coordinate attempts across tabs. A sale cannot start; use a browser with safe coordination support.",
  permission: "An authorized user and company context is required to show the result. Switching context does not resolve the earlier attempt.",
  invoice: "Invoice", receipt: "Receipt", total: "Server total", newSale: "Start a new sale", initializing: "Checking the recovery marker…",
};
export const hiPosRecovery: PosRecoveryDictionary = {
  title: "बिक्री का परिणाम प्राप्त करें", unknown: "सर्वर बिक्री पूरी कर चुका हो सकता है। पुष्टि मिलने तक कार्ट बंद रहेगा। उसकी जगह दूसरी बिक्री न बनाएँ।",
  check: "बिक्री का परिणाम जाँचें", checking: "परिणाम जाँचा जा रहा है…", pending: "बिक्री भेजी जा रही है…",
  confirmed: "सर्वर ने मूल बिक्री प्रयास पूरा होने की पुष्टि की।", historical: "यह मूल आदेश का परिणाम है, बाद में हुए रिवर्सल के बाद दस्तावेज़ों की वर्तमान स्थिति नहीं।",
  expired: "सुरक्षित पुनः भेजने की समय सीमा बीत गई। जाँच केवल पढ़ती है; परिणाम न मिलना बिक्री विफल होने का प्रमाण नहीं। परिणाम न दिखे तो व्यवस्थापक से संपर्क करें।",
  clock: "डिवाइस का समय मान्य नहीं है। कार्ट बंद रहेगा; जाँच बिक्री दोबारा भेजे बिना सर्वर का परिणाम पढ़ती है।",
  storage: "ब्राउज़र में पुनर्प्राप्ति संकेत सत्यापित नहीं हुआ। बिक्री बंद है। इसे खोलने के लिए साइट डेटा न मिटाएँ; व्यवस्थापक से संपर्क करें।",
  coordination: "यह ब्राउज़र अलग टैब में प्रयासों का सुरक्षित समन्वय नहीं कर सकता। बिक्री शुरू नहीं हो सकती; समर्थित ब्राउज़र उपयोग करें।",
  permission: "परिणाम दिखाने के लिए अधिकृत उपयोगकर्ता और कंपनी आवश्यक हैं। संदर्भ बदलने से पिछला प्रयास हल नहीं होता।",
  invoice: "चालान", receipt: "रसीद", total: "सर्वर का कुल", newSale: "नई बिक्री शुरू करें", initializing: "पुनर्प्राप्ति संकेत जाँचा जा रहा है…",
};
export const urPosRecovery: PosRecoveryDictionary = {
  title: "فروخت کا نتیجہ حاصل کریں", unknown: "ممکن ہے سرور فروخت مکمل کر چکا ہو۔ تصدیق تک ٹوکری مقفل رہے گی؛ متبادل فروخت نہ بنائیں۔",
  check: "فروخت کا نتیجہ دیکھیں", checking: "نتیجہ دیکھا جا رہا ہے…", pending: "فروخت بھیجی جا رہی ہے…",
  confirmed: "سرور نے اصل فروخت کی کوشش مکمل ہونے کی تصدیق کی۔", historical: "یہ اصل عمل کا نتیجہ ہے، بعد میں کسی ریورسل کے بعد دستاویزات کی موجودہ حالت نہیں۔",
  expired: "محفوظ دوبارہ ارسال کی مدت گزر گئی۔ جانچ صرف مطالعہ ہے؛ نتیجہ نہ ملنا ناکامی کا ثبوت نہیں۔ نتیجہ نہ آئے تو منتظم سے رابطہ کریں۔",
  clock: "آلے کا وقت درست نہیں۔ تالا برقرار ہے؛ جانچ فروخت دوبارہ بھیجے بغیر سرور کا نتیجہ پڑھتی ہے۔",
  storage: "براؤزر میں بحالی کے نشان کی تصدیق نہیں ہو سکی۔ فروخت مقفل ہے۔ تالا ہٹانے کے لیے سائٹ کا ڈیٹا نہ مٹائیں؛ منتظم سے رابطہ کریں۔",
  coordination: "یہ براؤزر ٹیبز کے درمیان کوششوں کو محفوظ طریقے سے منظم نہیں کر سکتا۔ فروخت شروع نہیں ہو سکتی؛ معاون براؤزر استعمال کریں۔",
  permission: "نتیجہ دکھانے کے لیے مجاز صارف اور کمپنی درکار ہیں۔ سیاق بدلنے سے پچھلی کوشش کا نتیجہ واضح نہیں ہوتا۔",
  invoice: "انوائس", receipt: "رسید", total: "سرور کا کل", newSale: "نئی فروخت شروع کریں", initializing: "بحالی کا نشان دیکھا جا رہا ہے…",
};
export const posRecoveryDictionaries = { ar: arPosRecovery, en: enPosRecovery, hi: hiPosRecovery, ur: urPosRecovery };
