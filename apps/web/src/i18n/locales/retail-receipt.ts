const ar = {
  open: 'معاينة إيصال البيع', title: 'إيصال البيع', preview: 'معاينة فقط', width: 'عرض المعاينة',
  paper58: '58 mm', paper80: '80 mm', download: 'تنزيل الفاتورة المؤرشفة PDF (A4)', downloading: 'جارٍ تنزيل PDF (A4)…',
  loading: 'جارٍ قراءة الأرشيف…', error: 'تعذرت معاينة الأرشيف. يمكنك طلب ملف الفاتورة الأصلي A4.', retry: 'إعادة قراءة الأرشيف',
  downloadError: 'تعذر تنزيل PDF. لم تُرسل أي مهمة إلى طابعة.', downloaded: 'تم طلب تنزيل PDF (A4). لا يعني ذلك أنه طُبع.',
  close: 'إغلاق المعاينة', historical: 'عرض تاريخي للفاتورة عند أرشفتها؛ لا يؤكد حالة السداد أو العكس الحالية.',
  thermalNotice: '58/80 mm مقاس معاينة فقط. PDF الحالي A4؛ لم تُعتمد طباعة حرارية أو تجربة جهاز.',
  barcodeNotice: 'لم يُحفظ باركود في هذه اللقطة التاريخية. لا يُنشأ باركود أو QR بديل.',
  invoice: 'رقم الفاتورة', date: 'تاريخ الفاتورة', currency: 'العملة', items: 'البنود', itemCode: 'رمز الصنف', unit: 'الوحدة',
  quantity: 'الكمية', unitPrice: 'سعر الوحدة', discount: 'الخصم', taxRate: 'نسبة الضريبة', tax: 'الضريبة', lineTotal: 'إجمالي البند',
  subtotal: 'المجموع الفرعي', discountTotal: 'إجمالي الخصم', taxTotal: 'إجمالي الضريبة', total: 'إجمالي الفاتورة',
  archive: 'مرجع الأرشيف', archivedAt: 'تاريخ الأرشفة', hash: 'بصمة الأرشيف', details: 'مرجع المصدر التاريخي',
};
type Copy = Record<keyof typeof ar, string>;
const en: Copy = {
  open: 'Preview sales receipt', title: 'Sales receipt', preview: 'Preview only', width: 'Preview width',
  paper58: '58 mm', paper80: '80 mm', download: 'Download archived invoice PDF (A4)', downloading: 'Downloading PDF (A4)…',
  loading: 'Reading archive…', error: 'The archive preview is unavailable. You can request the original A4 invoice.', retry: 'Read archive again',
  downloadError: 'PDF download failed. No job was sent to a printer.', downloaded: 'PDF (A4) download requested. This does not mean it was printed.',
  close: 'Close preview', historical: 'Historical invoice view at archive time; this does not confirm its current payment or reversal status.',
  thermalNotice: '58/80 mm are preview sizes only. The current PDF is A4; thermal printing and devices have not been validated.',
  barcodeNotice: 'No barcode was captured in this historical snapshot. No replacement barcode or QR is generated.',
  invoice: 'Invoice number', date: 'Invoice date', currency: 'Currency', items: 'Items', itemCode: 'Item code', unit: 'Unit',
  quantity: 'Quantity', unitPrice: 'Unit price', discount: 'Discount', taxRate: 'Tax rate', tax: 'Tax', lineTotal: 'Line total',
  subtotal: 'Subtotal', discountTotal: 'Total discount', taxTotal: 'Total tax', total: 'Invoice total',
  archive: 'Archive reference', archivedAt: 'Archived at', hash: 'Archive hash', details: 'Historical source reference',
};
const hi: Copy = {
  open: 'बिक्री रसीद का पूर्वावलोकन', title: 'बिक्री रसीद', preview: 'केवल पूर्वावलोकन', width: 'पूर्वावलोकन की चौड़ाई',
  paper58: '58 mm', paper80: '80 mm', download: 'संग्रहीत चालान PDF (A4) डाउनलोड करें', downloading: 'PDF (A4) डाउनलोड हो रहा है…',
  loading: 'अभिलेख पढ़ा जा रहा है…', error: 'अभिलेख का पूर्वावलोकन उपलब्ध नहीं है। आप मूल A4 चालान माँग सकते हैं।', retry: 'अभिलेख फिर पढ़ें',
  downloadError: 'PDF डाउनलोड नहीं हुआ। प्रिंटर को कोई कार्य नहीं भेजा गया।', downloaded: 'PDF (A4) डाउनलोड का अनुरोध किया गया। इसका अर्थ प्रिंट होना नहीं है।',
  close: 'पूर्वावलोकन बंद करें', historical: 'संग्रह के समय का चालान; यह वर्तमान भुगतान या रिवर्सल स्थिति की पुष्टि नहीं करता।',
  thermalNotice: '58/80 mm केवल पूर्वावलोकन आकार हैं। वर्तमान PDF A4 है; थर्मल प्रिंटिंग या उपकरण की जाँच नहीं हुई है।',
  barcodeNotice: 'इस ऐतिहासिक स्नैपशॉट में बारकोड नहीं है। कोई नया बारकोड या QR नहीं बनाया जाता।',
  invoice: 'चालान संख्या', date: 'चालान की तारीख', currency: 'मुद्रा', items: 'आइटम', itemCode: 'आइटम कोड', unit: 'इकाई',
  quantity: 'मात्रा', unitPrice: 'इकाई मूल्य', discount: 'छूट', taxRate: 'कर दर', tax: 'कर', lineTotal: 'पंक्ति कुल',
  subtotal: 'उप-योग', discountTotal: 'कुल छूट', taxTotal: 'कुल कर', total: 'चालान कुल',
  archive: 'अभिलेख संदर्भ', archivedAt: 'संग्रह की तारीख', hash: 'अभिलेख हैश', details: 'ऐतिहासिक स्रोत संदर्भ',
};
const ur: Copy = {
  open: 'فروخت کی رسید کا پیش منظر', title: 'فروخت کی رسید', preview: 'صرف پیش منظر', width: 'پیش منظر کی چوڑائی',
  paper58: '58 mm', paper80: '80 mm', download: 'محفوظ انوائس PDF (A4) ڈاؤن لوڈ کریں', downloading: 'PDF (A4) ڈاؤن لوڈ ہو رہا ہے…',
  loading: 'محفوظ ریکارڈ پڑھا جا رہا ہے…', error: 'محفوظ ریکارڈ کا پیش منظر دستیاب نہیں۔ اصل A4 انوائس طلب کر سکتے ہیں۔', retry: 'محفوظ ریکارڈ دوبارہ پڑھیں',
  downloadError: 'PDF ڈاؤن لوڈ نہیں ہوا۔ پرنٹر کو کوئی کام نہیں بھیجا گیا۔', downloaded: 'PDF (A4) ڈاؤن لوڈ کی درخواست ہوئی۔ اس کا مطلب پرنٹ ہونا نہیں ہے۔',
  close: 'پیش منظر بند کریں', historical: 'محفوظ کیے جانے کے وقت کی انوائس؛ موجودہ ادائیگی یا واپسی کی حالت کی تصدیق نہیں ہوتی۔',
  thermalNotice: '58/80 mm صرف پیش منظر کے سائز ہیں۔ موجودہ PDF A4 ہے؛ تھرمل پرنٹنگ یا آلات کی جانچ نہیں ہوئی۔',
  barcodeNotice: 'اس تاریخی ریکارڈ میں بارکوڈ محفوظ نہیں۔ متبادل بارکوڈ یا QR نہیں بنایا جاتا۔',
  invoice: 'انوائس نمبر', date: 'انوائس کی تاریخ', currency: 'کرنسی', items: 'آئٹمز', itemCode: 'آئٹم کوڈ', unit: 'اکائی',
  quantity: 'مقدار', unitPrice: 'فی اکائی قیمت', discount: 'رعایت', taxRate: 'ٹیکس کی شرح', tax: 'ٹیکس', lineTotal: 'سطر کا کل',
  subtotal: 'ذیلی کل', discountTotal: 'کل رعایت', taxTotal: 'کل ٹیکس', total: 'انوائس کا کل',
  archive: 'محفوظ ریکارڈ کا حوالہ', archivedAt: 'محفوظ کرنے کی تاریخ', hash: 'محفوظ ریکارڈ کا ہیش', details: 'تاریخی ماخذ کا حوالہ',
};
export const retailReceiptCopy = { ar, en, hi, ur } as const;
export type RetailReceiptLocale = keyof typeof retailReceiptCopy;
