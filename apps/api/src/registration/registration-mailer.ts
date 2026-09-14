import { appendFile } from 'node:fs/promises';
import { logEvent } from '../operations/logger.js';
import { resolveEmailTemplateLocale, type EmailTemplateLocale, type SupportedLocale } from './supported-locales.js';

export type RegistrationVerificationMessage = {
  to: string;
  locale: SupportedLocale;
  verificationUrl: string;
  expiresAt: Date;
};

export type EmailProviderAcceptance = {
  provider: 'resend';
  messageId: string;
};

export interface RegistrationMailer {
  sendVerification(message: RegistrationVerificationMessage, signal?: AbortSignal): Promise<EmailProviderAcceptance | void>;
}

export type PasswordResetMessage = {
  to: string;
  locale: SupportedLocale;
  resetUrl: string;
  expiresAt: Date;
};

export interface PasswordResetMailer {
  sendPasswordReset(message: PasswordResetMessage, signal?: AbortSignal): Promise<EmailProviderAcceptance | void>;
}

function escapeHtml(value: string) {
  return value.replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('>', '&gt;').replaceAll('"', '&quot;').replaceAll("'", '&#039;');
}

const emailCopy = {
  ar: {
    dir: 'rtl', intl: 'ar-SA',
    verification: {
      subject: 'تحقق من بريدك لإنشاء شركتك',
      heading: 'إكمال التسجيل في النظام المحاسبي متعدد الشركات',
      action: 'تحقق وأنشئ الشركة',
      notice: (date: string) => `تنتهي صلاحية الرابط في ${date} بالتوقيت العالمي.`,
    },
    passwordReset: {
      subject: 'استعادة كلمة المرور',
      heading: 'تعيين كلمة مرور جديدة للنظام المحاسبي متعدد الشركات',
      action: 'تعيين كلمة مرور جديدة',
      notice: (date: string) => `ينتهي الرابط في ${date} بالتوقيت العالمي. تجاهل الرسالة إذا لم تطلب الاستعادة.`,
    },
  },
  en: {
    dir: 'ltr', intl: 'en-US',
    verification: {
      subject: 'Verify your email to create your company',
      heading: 'Complete your multi-company accounting registration',
      action: 'Verify and create company',
      notice: (date: string) => `This link expires at ${date}.`,
    },
    passwordReset: {
      subject: 'Reset your password',
      heading: 'Set a new multi-company accounting password',
      action: 'Set a new password',
      notice: (date: string) => `This link expires at ${date}. Ignore this message if you did not request it.`,
    },
  },
  ur: {
    dir: 'rtl', intl: 'ur-PK',
    verification: {
      subject: 'اپنی کمپنی بنانے کے لیے اپنے ای میل کی تصدیق کریں',
      heading: 'ملٹی کمپنی اکاؤنٹنگ سسٹم میں رجسٹریشن مکمل کریں',
      action: 'تصدیق کریں اور کمپنی بنائیں',
      notice: (date: string) => `یہ لنک ${date} (عالمی وقت) کو ختم ہو جائے گا۔`,
    },
    passwordReset: {
      subject: 'اپنا پاس ورڈ دوبارہ ترتیب دیں',
      heading: 'ملٹی کمپنی اکاؤنٹنگ سسٹم کے لیے نیا پاس ورڈ مقرر کریں',
      action: 'نیا پاس ورڈ مقرر کریں',
      notice: (date: string) => `یہ لنک ${date} (عالمی وقت) کو ختم ہو جائے گا۔ اگر آپ نے یہ درخواست نہیں کی تو اس پیغام کو نظر انداز کریں۔`,
    },
  },
  hi: {
    dir: 'ltr', intl: 'hi-IN',
    verification: {
      subject: 'अपनी कंपनी बनाने के लिए ईमेल सत्यापित करें',
      heading: 'बहु-कंपनी लेखा प्रणाली में पंजीकरण पूरा करें',
      action: 'सत्यापित करें और कंपनी बनाएँ',
      notice: (date: string) => `यह लिंक ${date} (UTC) पर समाप्त होगा।`,
    },
    passwordReset: {
      subject: 'अपना पासवर्ड रीसेट करें',
      heading: 'बहु-कंपनी लेखा प्रणाली के लिए नया पासवर्ड बनाएँ',
      action: 'नया पासवर्ड बनाएँ',
      notice: (date: string) => `यह लिंक ${date} (UTC) पर समाप्त होगा। यदि आपने यह अनुरोध नहीं किया है, तो इस संदेश को अनदेखा करें।`,
    },
  },
} as const satisfies Record<EmailTemplateLocale, {
  dir: 'rtl' | 'ltr';
  intl: string;
  verification: { subject: string; heading: string; action: string; notice: (date: string) => string };
  passwordReset: { subject: string; heading: string; action: string; notice: (date: string) => string };
}>;

function formatExpiry(expiresAt: Date, locale: EmailTemplateLocale) {
  return expiresAt.toLocaleString(emailCopy[locale].intl, { timeZone: 'UTC', timeZoneName: 'short' });
}

async function acceptedByResend(response: Response, errorPrefix: 'REGISTRATION_EMAIL' | 'PASSWORD_RESET_EMAIL') {
  if (!response.ok) throw new Error(`${errorPrefix}_PROVIDER_${response.status}`);
  const payload = await response.json().catch(() => null) as { id?: unknown } | null;
  if (!payload || typeof payload.id !== 'string' || !/^[A-Za-z0-9][A-Za-z0-9._-]{0,159}$/u.test(payload.id)) {
    throw new Error(`${errorPrefix}_PROVIDER_RESPONSE_INVALID`);
  }
  return { provider: 'resend', messageId: payload.id } as const;
}

export class ResendRegistrationMailer implements RegistrationMailer, PasswordResetMailer {
  constructor(private readonly apiKey: string, private readonly from: string) {}

  async sendVerification(message: RegistrationVerificationMessage, signal?: AbortSignal) {
    const templateLocale = resolveEmailTemplateLocale(message.locale);
    const copy = emailCopy[templateLocale];
    const notice = copy.verification.notice(formatExpiry(message.expiresAt, templateLocale));
    const response = await fetch('https://api.resend.com/emails', {
      method: 'POST',
      headers: { Authorization: `Bearer ${this.apiKey}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        from: this.from,
        to: [message.to],
        subject: copy.verification.subject,
        html: `<div dir="${copy.dir}" style="font-family:Arial,sans-serif;line-height:1.7"><h1>${copy.verification.heading}</h1><p>${notice}</p><p><a href="${escapeHtml(message.verificationUrl)}" style="background:#176b5b;color:#fff;padding:12px 18px;border-radius:8px;text-decoration:none">${copy.verification.action}</a></p></div>`,
      }),
      signal: signal ? AbortSignal.any([signal, AbortSignal.timeout(10_000)]) : AbortSignal.timeout(10_000),
    });
    return acceptedByResend(response, 'REGISTRATION_EMAIL');
  }

  async sendPasswordReset(message: PasswordResetMessage, signal?: AbortSignal) {
    const templateLocale = resolveEmailTemplateLocale(message.locale);
    const copy = emailCopy[templateLocale];
    const notice = copy.passwordReset.notice(formatExpiry(message.expiresAt, templateLocale));
    const response = await fetch('https://api.resend.com/emails', {
      method: 'POST',
      headers: { Authorization: `Bearer ${this.apiKey}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        from: this.from,
        to: [message.to],
        subject: copy.passwordReset.subject,
        html: `<div dir="${copy.dir}" style="font-family:Arial,sans-serif;line-height:1.7"><h1>${copy.passwordReset.heading}</h1><p>${notice}</p><p><a href="${escapeHtml(message.resetUrl)}" style="background:#176b5b;color:#fff;padding:12px 18px;border-radius:8px;text-decoration:none">${copy.passwordReset.action}</a></p></div>`,
      }),
      signal: signal ? AbortSignal.any([signal, AbortSignal.timeout(10_000)]) : AbortSignal.timeout(10_000),
    });
    return acceptedByResend(response, 'PASSWORD_RESET_EMAIL');
  }
}

/** Development-only delivery adapter. Production configuration rejects this mode. */
export class DevelopmentRegistrationMailer implements RegistrationMailer, PasswordResetMailer {
  constructor(private readonly capturePath?: string) {}

  async sendVerification(message: RegistrationVerificationMessage, signal?: AbortSignal) {
    if (signal?.aborted) throw signal.reason;
    if (this.capturePath) {
      await appendFile(this.capturePath, `${JSON.stringify({
        ...message,
        expiresAt: message.expiresAt.toISOString(),
      })}\n`, { encoding: 'utf8', mode: 0o600 });
      if (signal?.aborted) throw signal.reason;
      return;
    }
    logEvent('info', 'registration_verification_email_simulated', {
      locale: message.locale,
      expiresAt: message.expiresAt.toISOString(),
    });
  }

  async sendPasswordReset(message: PasswordResetMessage, signal?: AbortSignal) {
    if (signal?.aborted) throw signal.reason;
    if (this.capturePath) {
      await appendFile(this.capturePath, `${JSON.stringify({
        ...message,
        expiresAt: message.expiresAt.toISOString(),
      })}\n`, { encoding: 'utf8', mode: 0o600 });
      if (signal?.aborted) throw signal.reason;
      return;
    }
    logEvent('info', 'password_reset_email_simulated', {
      locale: message.locale,
      expiresAt: message.expiresAt.toISOString(),
    });
  }
}
