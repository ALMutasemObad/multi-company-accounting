export const arSellingProfile = {
  capacity: "توجد محاولات حفظ غير محسومة كثيرة. احسم محاولة سابقة قبل بدء طلب جديد.",
  title: "إعداد بيع الصنف", description: "احفظ السعر والعملة وحساب الإيراد والضريبة الافتراضية مرة واحدة. يعيد الخادم التحقق عند البيع.",
  price: "سعر الوحدة", currency: "عملة السعر", account: "حساب الإيراد", tax: "ضريبة المبيعات", noTax: "بلا ضريبة افتراضية",
  active: "ملف البيع نشط", choose: "اختر مرجعًا", unavailable: "المرجع غير متاح؛ راجع الإعداد", save: "حفظ إعداد البيع",
  saving: "جارٍ الحفظ…", saved: "حُفظ إعداد البيع.", unknown: "نتيجة الحفظ غير مؤكدة. لا تغيّر الطلب؛ أعد المحاولة نفسها أو حدّث للتحقق.",
  retry: "إعادة الطلب نفسه", reload: "تحديث للتحقق", conflict: "تغير الملف منذ فتحه. حدّث البيانات ثم راجع التعديل.",
  rejected: "لم يُحفظ الإعداد. راجع المراجع والصلاحية وحاول مجددًا.", readOnly: "العرض فقط؛ تحتاج صلاحية إدارة كتالوج البيع للحفظ.",
  references: "يلزم اختيار عملة وحساب إيراد متاحين. لا نفترضهما من الصنف أو المتصفح.",
  priceHelp: "اكتب سعرًا غير سالب حتى أربع خانات عشرية. الصفر سعر صريح، وتركه فارغًا لا ينشئ سعرًا.",
  currencyHelp: "السعر بهذه العملة فقط؛ لا يحوّل تلقائيًا إلى عملة نقطة البيع.",
} as const;
export type SellingProfileDictionary = { [K in keyof typeof arSellingProfile]: string };
export const enSellingProfile: SellingProfileDictionary = {
  capacity: "Too many unresolved saves. Resolve an earlier attempt before starting another request.",
  title: "Item selling setup", description: "Save the default price, currency, revenue account and tax once. The server revalidates them at sale time.",
  price: "Unit price", currency: "Price currency", account: "Revenue account", tax: "Sales tax", noTax: "No default tax",
  active: "Selling profile active", choose: "Choose a reference", unavailable: "Reference unavailable; review setup", save: "Save selling setup",
  saving: "Saving…", saved: "Selling setup saved.", unknown: "Save outcome is uncertain. Keep the request unchanged; retry the same request or reload to verify.",
  retry: "Retry the same request", reload: "Reload to verify", conflict: "The profile changed after you opened it. Reload and review your changes.",
  rejected: "Setup was not saved. Review references and permission, then try again.", readOnly: "Read only; managing the selling catalog requires permission.",
  references: "Choose an available currency and revenue account. Neither is inferred from the item or browser.",
  priceHelp: "Enter a non-negative price with up to four decimal places. Zero is an explicit price; blank does not create a price.",
  currencyHelp: "This price uses this currency only; it is not automatically converted to the POS currency.",
};
export const hiSellingProfile: SellingProfileDictionary = {
  capacity: "बहुत से सहेजने के प्रयास अनिश्चित हैं। नया अनुरोध शुरू करने से पहले पिछला प्रयास हल करें।",
  title: "वस्तु की बिक्री सेटिंग", description: "डिफ़ॉल्ट मूल्य, मुद्रा, आय खाता और कर एक बार सहेजें। बिक्री के समय सर्वर दोबारा जाँचता है।",
  price: "इकाई मूल्य", currency: "मूल्य की मुद्रा", account: "आय खाता", tax: "बिक्री कर", noTax: "कोई डिफ़ॉल्ट कर नहीं",
  active: "बिक्री प्रोफ़ाइल सक्रिय", choose: "संदर्भ चुनें", unavailable: "संदर्भ उपलब्ध नहीं; सेटिंग जाँचें", save: "बिक्री सेटिंग सहेजें",
  saving: "सहेजा जा रहा है…", saved: "बिक्री सेटिंग सहेजी गई।", unknown: "सहेजने का परिणाम स्पष्ट नहीं है। अनुरोध न बदलें; वही अनुरोध दोहराएँ या जाँचने के लिए पुनः लोड करें।",
  retry: "वही अनुरोध दोहराएँ", reload: "जाँचने के लिए पुनः लोड करें", conflict: "खोलने के बाद प्रोफ़ाइल बदल गई। पुनः लोड करके बदलावों की समीक्षा करें।",
  rejected: "सेटिंग नहीं सहेजी गई। संदर्भ और अनुमति जाँचकर फिर कोशिश करें।", readOnly: "केवल देख सकते हैं; बिक्री कैटलॉग बदलने की अनुमति आवश्यक है।",
  references: "उपलब्ध मुद्रा और आय खाता चुनें। वस्तु या ब्राउज़र से इन्हें स्वतः नहीं चुना जाता।",
  priceHelp: "चार दशमलव स्थानों तक शून्य या धनात्मक मूल्य दर्ज करें। शून्य स्पष्ट मूल्य है; खाली छोड़ने से मूल्य नहीं बनता।",
  currencyHelp: "यह मूल्य केवल इसी मुद्रा में है; POS मुद्रा में स्वतः परिवर्तन नहीं होता।",
};
export const urSellingProfile: SellingProfileDictionary = {
  capacity: "بہت سی محفوظ کرنے کی کوششیں غیر یقینی ہیں۔ نئی درخواست سے پہلے پچھلی کوشش کا نتیجہ واضح کریں۔",
  title: "صنف کی فروخت کی ترتیب", description: "طے شدہ قیمت، کرنسی، آمدنی کھاتہ اور ٹیکس ایک بار محفوظ کریں۔ فروخت کے وقت سرور دوبارہ جانچتا ہے۔",
  price: "فی اکائی قیمت", currency: "قیمت کی کرنسی", account: "آمدنی کھاتہ", tax: "سیلز ٹیکس", noTax: "کوئی طے شدہ ٹیکس نہیں",
  active: "فروخت کا پروفائل فعال", choose: "حوالہ منتخب کریں", unavailable: "حوالہ دستیاب نہیں؛ ترتیب دیکھیں", save: "فروخت کی ترتیب محفوظ کریں",
  saving: "محفوظ ہو رہا ہے…", saved: "فروخت کی ترتیب محفوظ ہو گئی۔", unknown: "محفوظ کرنے کا نتیجہ غیر یقینی ہے۔ درخواست نہ بدلیں؛ وہی درخواست دہرائیں یا تصدیق کے لیے دوبارہ لوڈ کریں۔",
  retry: "وہی درخواست دہرائیں", reload: "تصدیق کے لیے دوبارہ لوڈ کریں", conflict: "کھولنے کے بعد پروفائل بدل گیا۔ دوبارہ لوڈ کر کے تبدیلیاں دیکھیں۔",
  rejected: "ترتیب محفوظ نہیں ہوئی۔ حوالوں اور اجازت کی جانچ کے بعد پھر کوشش کریں۔", readOnly: "صرف مطالعہ؛ فروخت کی فہرست بدلنے کی اجازت درکار ہے۔",
  references: "دستیاب کرنسی اور آمدنی کھاتہ منتخب کریں۔ صنف یا براؤزر سے یہ خود نہیں چنے جاتے۔",
  priceHelp: "چار اعشاری ہندسوں تک غیر منفی قیمت درج کریں۔ صفر واضح قیمت ہے؛ خالی چھوڑنے سے قیمت نہیں بنتی۔",
  currencyHelp: "یہ قیمت صرف اس کرنسی میں ہے؛ POS کی کرنسی میں خودکار تبدیلی نہیں ہوتی۔",
};
export const sellingProfileDictionaries = { ar: arSellingProfile, en: enSellingProfile, hi: hiSellingProfile, ur: urSellingProfile };
