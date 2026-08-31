export type ZebraLabelMessages = {
  title: string;
  description: string;
  model: string;
  connection: string;
  choose: string;
  usb: string;
  network: string;
  printer: string;
  noPrinters: string;
  widthMm: string;
  heightMm: string;
  dpi: string;
  orientation: string;
  normal: string;
  rotate90: string;
  quantity: string;
  preview: string;
  send: string;
  previewTitle: string;
  previewAlt: string;
  previewHint: string;
  profileHint: string;
  limitsHint: string;
  reviewAgain: string;
  repeatWarning: string;
  preparing: string;
  sending: string;
  sent: string;
  queued: string;
  unknown: string;
  ready: string;
  unauthorized: string;
  settings: string;
  unsupportedDpi: string;
  adapterUnavailable: string;
  printerUnapproved: string;
  previewRequired: string;
  expired: string;
  busy: string;
  consumed: string;
  prepareFailed: string;
  authorizationFailed: string;
  clockInvalid: string;
};

export const zebraLabelMessages: Record<'ar' | 'en' | 'ur' | 'hi', ZebraLabelMessages> = {
  ar: {
    clockInvalid: 'تعذر الوثوق بساعة هذه الجلسة. توقف الإرسال؛ صحح الساعة وافتح جلسة إعداد جديدة.',
    title: 'ملصقات باركود Zebra',
    description: 'أعدّ ملصقًا لباركود مسجل ومصرح به، وحدد المقاس والكمية ثم راجع المعاينة قبل الإرسال. هذا المسار لملصقات الباركود وليس للطباعة الحرارية للفواتير.',
    model: 'موديل الطابعة الفعلي',
    connection: 'نوع الاتصال',
    choose: 'اختر',
    usb: 'USB',
    network: 'الشبكة',
    printer: 'الطابعة المعتمدة',
    noPrinters: 'لا توجد طابعات معتمدة متاحة.',
    widthMm: 'عرض الملصق بالملليمتر',
    heightMm: 'ارتفاع الملصق بالملليمتر',
    dpi: 'دقة الطابعة الفعلية (DPI)',
    orientation: 'اتجاه الملصق',
    normal: 'دون تدوير',
    rotate90: 'تدوير 90 درجة',
    quantity: 'عدد النسخ',
    preview: 'إعداد المعاينة',
    send: 'إرسال أمر الطباعة',
    previewTitle: 'معاينة ملصق الباركود',
    previewAlt: 'معاينة نسبية لملصق الباركود المسجل',
    previewHint: 'هذه معاينة نسبية على الشاشة، وليست دليلًا على الطباعة أو نجاح قراءة الباركود من الملصق الورقي.',
    profileHint: 'ملف الرسم الحالي يدعم 203 DPI فقط. أدخل دقة طابعتك الفعلية؛ لا نفترض أنها 203 DPI.',
    limitsHint: 'الحدود الأولية: من 1 إلى 100 نسخة، و2 MiB لكل صورة PNG و16 MiB للدفعة، و4 ملايين بكسل للملصق و16 مليون بكسل للدفعة. يجب أن يتسع المقاس للملصق دون قص أو تصغير.',
    reviewAgain: 'إعداد معاينة جديدة',
    repeatWarning: 'تحققت من الطابعة وأفهم أن إعداد معاينة جديدة قد يسمح بإرسال الملصقات نفسها مجددًا.',
    preparing: 'جارٍ إعداد المعاينة…',
    sending: 'جارٍ إرسال أمر الطباعة…',
    sent: 'تم إرسال المهمة؛ لا يؤكد ذلك اكتمال طباعة الملصقات.',
    queued: 'قُبلت المهمة في طابور الإرسال؛ لا يؤكد ذلك اكتمال طباعة الملصقات.',
    unknown: 'نتيجة الإرسال غير معروفة، وقد تكون المهمة وصلت. تحقق من الطابعة قبل طلب أي نسخ جديدة.',
    ready: 'الإعدادات والمعاينة جاهزة للإرسال؛ لا تؤكد هذه الحالة جاهزية الطابعة الفعلية.',
    unauthorized: 'لا تملك إذن طباعة هذا الباركود في الشركة الحالية.',
    settings: 'راجع إعدادات الطابعة والمقاس والاتجاه والكمية وأكمل القيم المطلوبة.',
    unsupportedDpi: 'دقة الطابعة التي أدخلتها غير مدعومة بملف الرسم الحالي. لا تغيّر القيمة عن دقة جهازك الفعلية لتجاوز هذا القيد.',
    adapterUnavailable: 'اتصال Zebra غير مثبت أو غير معتمد. لن تُكتشف أجهزة ولن تُرسل أوامر طباعة.',
    printerUnapproved: 'هذه الطابعة أو طريقة اتصالها لم تُعتمد بعد لهذا المسار.',
    previewRequired: 'أعدّ المعاينة وراجعها قبل إرسال أمر الطباعة.',
    expired: 'انتهت صلاحية المعاينة. راجع الحالة ثم أعدّ معاينة جديدة.',
    busy: 'توجد عملية إعداد أو إرسال قيد التنفيذ. انتظر نتيجتها قبل بدء عملية أخرى.',
    consumed: 'استُخدمت هذه المعاينة في محاولة إرسال. تحقق من الطابعة قبل إعداد معاينة جديدة.',
    prepareFailed: 'تعذر إعداد المعاينة. راجع البيانات وحدود المقاس والصورة.',
    authorizationFailed: 'تعذر التحقق من إذن الطباعة للشركة الحالية. يلزم التحقق منه قبل الإرسال.',
  },
  en: {
    clockInvalid: 'This session clock is invalid or moved backward. Sending is blocked; correct the clock and open a new setup session.',
    title: 'Zebra barcode labels',
    description: 'Prepare a label for a registered, authorized barcode. Set its size and quantity, then review the preview before sending. This workflow is for barcode labels, not thermal invoice printing.',
    model: 'Actual printer model',
    connection: 'Connection type',
    choose: 'Choose',
    usb: 'USB',
    network: 'Network',
    printer: 'Approved printer',
    noPrinters: 'No approved printers are available.',
    widthMm: 'Label width in millimeters',
    heightMm: 'Label height in millimeters',
    dpi: 'Actual printer resolution (DPI)',
    orientation: 'Label orientation',
    normal: 'No rotation',
    rotate90: 'Rotate 90 degrees',
    quantity: 'Number of copies',
    preview: 'Prepare preview',
    send: 'Send print command',
    previewTitle: 'Barcode label preview',
    previewAlt: 'Relative screen preview of the registered barcode label',
    previewHint: 'This is a relative screen preview. It does not prove that the label has printed or that its barcode can be read from paper.',
    profileHint: 'The current rendering profile supports only 203 DPI. Enter your actual printer resolution; 203 DPI is not assumed.',
    limitsHint: 'Initial limits: 1–100 copies, 2 MiB per PNG and 16 MiB per batch, and 4 million pixels per label and 16 million per batch. The label must fit without cropping or shrinking.',
    reviewAgain: 'Prepare a new preview',
    repeatWarning: 'I have checked the printer and understand that preparing a new preview may allow the same labels to be sent again.',
    preparing: 'Preparing the preview…',
    sending: 'Sending the print command…',
    sent: 'The job was sent. This does not confirm that the labels have finished printing.',
    queued: 'The job was accepted into the sending queue. This does not confirm that the labels have finished printing.',
    unknown: 'The sending outcome is unknown, and the job may have arrived. Check the printer before requesting any new copies.',
    ready: 'Settings and preview are ready to submit. This does not confirm that the physical printer is ready.',
    unauthorized: 'You do not have permission to print this barcode in the current company.',
    settings: 'Review the printer, size, orientation and quantity, and complete all required values.',
    unsupportedDpi: 'The current rendering profile does not support the entered printer resolution. Do not change it from the actual device resolution to bypass this limit.',
    adapterUnavailable: 'The Zebra connection is not installed or approved. No devices will be discovered and no print commands will be sent.',
    printerUnapproved: 'This printer or its connection type has not been approved for this workflow.',
    previewRequired: 'Prepare and review the preview before sending a print command.',
    expired: 'The preview has expired. Review the status before preparing a new preview.',
    busy: 'Preparation or sending is already in progress. Wait for its result before starting another operation.',
    consumed: 'This preview has already been used for a sending attempt. Check the printer before preparing a new preview.',
    prepareFailed: 'The preview could not be prepared. Review the data, size and image limits.',
    authorizationFailed: 'Print permission for the current company could not be verified. It must be verified before sending.',
  },
  ur: {
    clockInvalid: 'اس سیشن کی گھڑی درست نہیں یا پیچھے چلی گئی ہے۔ بھیجنا بند ہے؛ گھڑی درست کرکے نیا سیٹ اپ سیشن کھولیں۔',
    title: 'Zebra بارکوڈ لیبل',
    description: 'رجسٹرڈ اور مجاز بارکوڈ کا لیبل تیار کریں۔ سائز اور تعداد درج کریں، پھر بھیجنے سے پہلے پیش منظر دیکھیں۔ یہ طریقہ بارکوڈ لیبل کے لیے ہے، انوائس کی تھرمل پرنٹنگ کے لیے نہیں۔',
    model: 'پرنٹر کا اصل ماڈل',
    connection: 'کنکشن کی قسم',
    choose: 'منتخب کریں',
    usb: 'USB',
    network: 'نیٹ ورک',
    printer: 'منظور شدہ پرنٹر',
    noPrinters: 'کوئی منظور شدہ پرنٹر دستیاب نہیں ہے۔',
    widthMm: 'لیبل کی چوڑائی، ملی میٹر میں',
    heightMm: 'لیبل کی اونچائی، ملی میٹر میں',
    dpi: 'پرنٹر کی اصل ریزولیوشن (DPI)',
    orientation: 'لیبل کی سمت',
    normal: 'بغیر گھمائے',
    rotate90: '90 درجے گھمائیں',
    quantity: 'کاپیوں کی تعداد',
    preview: 'پیش منظر تیار کریں',
    send: 'پرنٹ کمانڈ بھیجیں',
    previewTitle: 'بارکوڈ لیبل کا پیش منظر',
    previewAlt: 'رجسٹرڈ بارکوڈ لیبل کا متناسب اسکرین پیش منظر',
    previewHint: 'یہ اسکرین پر ایک متناسب پیش منظر ہے۔ اس سے لیبل چھپنے یا کاغذ سے بارکوڈ کامیابی سے پڑھے جانے کی تصدیق نہیں ہوتی۔',
    profileHint: 'موجودہ رینڈرنگ پروفائل صرف 203 DPI کی معاونت کرتا ہے۔ اپنے پرنٹر کی اصل ریزولیوشن درج کریں؛ ہم اسے 203 DPI فرض نہیں کرتے۔',
    limitsHint: 'ابتدائی حدیں: 1 سے 100 کاپیاں، ہر PNG کے لیے 2 MiB اور پوری بیچ کے لیے 16 MiB، ہر لیبل کے لیے 40 لاکھ پکسل اور پوری بیچ کے لیے 1 کروڑ 60 لاکھ پکسل۔ لیبل کو کاٹے یا چھوٹا کیے بغیر مقررہ سائز میں آنا چاہیے۔',
    reviewAgain: 'نیا پیش منظر تیار کریں',
    repeatWarning: 'میں نے پرنٹر دیکھ لیا ہے اور سمجھتا/سمجھتی ہوں کہ نیا پیش منظر تیار کرنے سے وہی لیبل دوبارہ بھیجے جا سکتے ہیں۔',
    preparing: 'پیش منظر تیار ہو رہا ہے…',
    sending: 'پرنٹ کمانڈ بھیجی جا رہی ہے…',
    sent: 'کام بھیج دیا گیا ہے۔ اس سے لیبل کی چھپائی مکمل ہونے کی تصدیق نہیں ہوتی۔',
    queued: 'کام بھیجنے کی قطار میں قبول ہو گیا ہے۔ اس سے لیبل کی چھپائی مکمل ہونے کی تصدیق نہیں ہوتی۔',
    unknown: 'بھیجنے کا نتیجہ معلوم نہیں، اور کام پرنٹر تک پہنچ چکا ہو سکتا ہے۔ مزید کاپیاں مانگنے سے پہلے پرنٹر دیکھیں۔',
    ready: 'ترتیبات اور پیش منظر بھیجنے کے لیے تیار ہیں۔ اس سے اصل پرنٹر کے تیار ہونے کی تصدیق نہیں ہوتی۔',
    unauthorized: 'آپ کو موجودہ کمپنی میں اس بارکوڈ کو پرنٹ کرنے کی اجازت نہیں ہے۔',
    settings: 'پرنٹر، سائز، سمت اور تعداد دیکھیں اور تمام ضروری قدریں مکمل کریں۔',
    unsupportedDpi: 'موجودہ رینڈرنگ پروفائل درج کردہ ریزولیوشن کی معاونت نہیں کرتا۔ اس حد سے بچنے کے لیے پرنٹر کی اصل ریزولیوشن سے مختلف قدر درج نہ کریں۔',
    adapterUnavailable: 'Zebra کنکشن نصب یا منظور شدہ نہیں ہے۔ کوئی ڈیوائس تلاش نہیں کی جائے گی اور کوئی پرنٹ کمانڈ نہیں بھیجی جائے گی۔',
    printerUnapproved: 'یہ پرنٹر یا اس کے کنکشن کی قسم ابھی اس طریقے کے لیے منظور نہیں ہے۔',
    previewRequired: 'پرنٹ کمانڈ بھیجنے سے پہلے پیش منظر تیار کر کے دیکھیں۔',
    expired: 'پیش منظر کی میعاد ختم ہو گئی ہے۔ نیا پیش منظر بنانے سے پہلے حالت دیکھیں۔',
    busy: 'تیاری یا بھیجنے کا عمل جاری ہے۔ دوسرا عمل شروع کرنے سے پہلے اس کے نتیجے کا انتظار کریں۔',
    consumed: 'یہ پیش منظر بھیجنے کی ایک کوشش میں استعمال ہو چکا ہے۔ نیا پیش منظر بنانے سے پہلے پرنٹر دیکھیں۔',
    prepareFailed: 'پیش منظر تیار نہیں ہو سکا۔ ڈیٹا، سائز اور تصویر کی حدیں دیکھیں۔',
    authorizationFailed: 'موجودہ کمپنی کے لیے پرنٹ کی اجازت کی تصدیق نہیں ہو سکی۔ بھیجنے سے پہلے اس کی تصدیق ضروری ہے۔',
  },
  hi: {
    clockInvalid: 'इस सत्र की घड़ी अमान्य है या पीछे गई है। भेजना रोका गया है; घड़ी ठीक करके नया सेटअप सत्र खोलें।',
    title: 'Zebra बारकोड लेबल',
    description: 'पंजीकृत और अधिकृत बारकोड का लेबल तैयार करें। आकार और प्रतियों की संख्या भरें, फिर भेजने से पहले पूर्वावलोकन देखें। यह प्रक्रिया बारकोड लेबल के लिए है, इनवॉइस की थर्मल प्रिंटिंग के लिए नहीं।',
    model: 'प्रिंटर का वास्तविक मॉडल',
    connection: 'कनेक्शन का प्रकार',
    choose: 'चुनें',
    usb: 'USB',
    network: 'नेटवर्क',
    printer: 'स्वीकृत प्रिंटर',
    noPrinters: 'कोई स्वीकृत प्रिंटर उपलब्ध नहीं है।',
    widthMm: 'लेबल की चौड़ाई, मिलीमीटर में',
    heightMm: 'लेबल की ऊँचाई, मिलीमीटर में',
    dpi: 'प्रिंटर का वास्तविक रिज़ॉल्यूशन (DPI)',
    orientation: 'लेबल की दिशा',
    normal: 'बिना घुमाए',
    rotate90: '90 डिग्री घुमाएँ',
    quantity: 'प्रतियों की संख्या',
    preview: 'पूर्वावलोकन तैयार करें',
    send: 'प्रिंट कमांड भेजें',
    previewTitle: 'बारकोड लेबल का पूर्वावलोकन',
    previewAlt: 'पंजीकृत बारकोड लेबल का आनुपातिक स्क्रीन पूर्वावलोकन',
    previewHint: 'यह स्क्रीन पर एक आनुपातिक पूर्वावलोकन है। इससे लेबल छपने या कागज़ से बारकोड सफलतापूर्वक पढ़े जाने की पुष्टि नहीं होती।',
    profileHint: 'वर्तमान रेंडरिंग प्रोफ़ाइल केवल 203 DPI का समर्थन करती है। अपने प्रिंटर का वास्तविक रिज़ॉल्यूशन भरें; हम उसे 203 DPI नहीं मानते हैं।',
    limitsHint: 'प्रारंभिक सीमाएँ: 1 से 100 प्रतियाँ, हर PNG के लिए 2 MiB और पूरे बैच के लिए 16 MiB, हर लेबल के लिए 40 लाख पिक्सेल और पूरे बैच के लिए 1 करोड़ 60 लाख पिक्सेल। लेबल को काटे या छोटा किए बिना चुने हुए आकार में समाना चाहिए।',
    reviewAgain: 'नया पूर्वावलोकन तैयार करें',
    repeatWarning: 'मैंने प्रिंटर जाँच लिया है और समझता/समझती हूँ कि नया पूर्वावलोकन तैयार करने से वही लेबल फिर से भेजे जा सकते हैं।',
    preparing: 'पूर्वावलोकन तैयार हो रहा है…',
    sending: 'प्रिंट कमांड भेजी जा रही है…',
    sent: 'कार्य भेज दिया गया है। इससे लेबल की छपाई पूरी होने की पुष्टि नहीं होती।',
    queued: 'कार्य भेजने की कतार में स्वीकार हो गया है। इससे लेबल की छपाई पूरी होने की पुष्टि नहीं होती।',
    unknown: 'भेजने का परिणाम अज्ञात है और कार्य प्रिंटर तक पहुँच चुका हो सकता है। कोई नई प्रति माँगने से पहले प्रिंटर जाँचें।',
    ready: 'सेटिंग और पूर्वावलोकन भेजने के लिए तैयार हैं। इससे वास्तविक प्रिंटर के तैयार होने की पुष्टि नहीं होती।',
    unauthorized: 'आपको वर्तमान कंपनी में यह बारकोड प्रिंट करने की अनुमति नहीं है।',
    settings: 'प्रिंटर, आकार, दिशा और प्रतियों की संख्या जाँचें और सभी आवश्यक मान भरें।',
    unsupportedDpi: 'वर्तमान रेंडरिंग प्रोफ़ाइल भरे गए रिज़ॉल्यूशन का समर्थन नहीं करती है। इस सीमा को पार करने के लिए प्रिंटर के वास्तविक रिज़ॉल्यूशन से अलग मान न भरें।',
    adapterUnavailable: 'Zebra कनेक्शन स्थापित या स्वीकृत नहीं है। कोई डिवाइस नहीं खोजी जाएगी और कोई प्रिंट कमांड नहीं भेजी जाएगी।',
    printerUnapproved: 'यह प्रिंटर या इसके कनेक्शन का प्रकार अभी इस प्रक्रिया के लिए स्वीकृत नहीं है।',
    previewRequired: 'प्रिंट कमांड भेजने से पहले पूर्वावलोकन तैयार करें और जाँचें।',
    expired: 'पूर्वावलोकन की वैधता समाप्त हो गई है। नया पूर्वावलोकन बनाने से पहले स्थिति जाँचें।',
    busy: 'तैयारी या भेजने की प्रक्रिया जारी है। दूसरी प्रक्रिया शुरू करने से पहले इसके परिणाम की प्रतीक्षा करें।',
    consumed: 'यह पूर्वावलोकन भेजने के एक प्रयास में इस्तेमाल हो चुका है। नया पूर्वावलोकन बनाने से पहले प्रिंटर जाँचें।',
    prepareFailed: 'पूर्वावलोकन तैयार नहीं हो सका। डेटा, आकार और चित्र की सीमाएँ जाँचें।',
    authorizationFailed: 'वर्तमान कंपनी के लिए प्रिंट की अनुमति सत्यापित नहीं हो सकी। भेजने से पहले उसका सत्यापन आवश्यक है।',
  },
};
