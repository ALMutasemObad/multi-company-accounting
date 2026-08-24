import { appendFile } from 'node:fs/promises';
import { logEvent } from '../operations/logger.js';
import type { SupportedLocale } from './supported-locales.js';

export type RegistrationVerificationMessage = {
  to: string;
  locale: SupportedLocale;
  verificationUrl: string;
  expiresAt: Date;
};

export interface RegistrationMailer {
  sendVerification(message: RegistrationVerificationMessage, signal?: AbortSignal): Promise<void>;
}

export type PasswordResetMessage = {
  to: string;
  locale: SupportedLocale;
  resetUrl: string;
  expiresAt: Date;
};

export interface PasswordResetMailer {
  sendPasswordReset(message: PasswordResetMessage, signal?: AbortSignal): Promise<void>;
}

function escapeHtml(value: string) {
  return value.replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('>', '&gt;').replaceAll('"', '&quot;').replaceAll("'", '&#039;');
}

const emailCopy = {
  ar: {
    dir: 'rtl', intl: 'ar-SA',
    verification: {
      subject: 'تحقق من بريدك لإنشاء شركتك',
      heading: 'إكمال التسجيل في نظام جوار المالي',
      action: 'تحقق وأنشئ الشركة',
      notice: (date: string) => `تنتهي صلاحية الرابط في ${date} بالتوقيت العالمي.`,
    },
    passwordReset: {
      subject: 'استعادة كلمة المرور',
      heading: 'تعيين كلمة مرور جديدة لنظام جوار المالي',
      action: 'تعيين كلمة مرور جديدة',
      notice: (date: string) => `ينتهي الرابط في ${date} بالتوقيت العالمي. تجاهل الرسالة إذا لم تطلب الاستعادة.`,
    },
  },
  en: {
    dir: 'ltr', intl: 'en-US',
    verification: {
      subject: 'Verify your email to create your company',
      heading: 'Complete your Jawar Finance registration',
      action: 'Verify and create company',
      notice: (date: string) => `This link expires at ${date}.`,
    },
    passwordReset: {
      subject: 'Reset your password',
      heading: 'Set a new Jawar Finance password',
      action: 'Set a new password',
      notice: (date: string) => `This link expires at ${date}. Ignore this message if you did not request it.`,
    },
  },
  ur: {
    dir: 'rtl', intl: 'ur-PK',
    verification: {
      subject: 'اپنی کمپنی بنانے کے لیے اپنے ای میل کی تصدیق کریں',
      heading: 'جوار مالیاتی نظام میں رجسٹریشن مکمل کریں',
      action: 'تصدیق کریں اور کمپنی بنائیں',
      notice: (date: string) => `یہ لنک ${date} (عالمی وقت) کو ختم ہو جائے گا۔`,
    },
    passwordReset: {
      subject: 'اپنا پاس ورڈ دوبارہ ترتیب دیں',
      heading: 'جوار مالیاتی نظام کے لیے نیا پاس ورڈ مقرر کریں',
      action: 'نیا پاس ورڈ مقرر کریں',
      notice: (date: string) => `یہ لنک ${date} (عالمی وقت) کو ختم ہو جائے گا۔ اگر آپ نے یہ درخواست نہیں کی تو اس پیغام کو نظر انداز کریں۔`,
    },
  },
  hi: {
    dir: 'ltr', intl: 'hi-IN',
    verification: {
      subject: 'अपनी कंपनी बनाने के लिए ईमेल सत्यापित करें',
      heading: 'जवार वित्तीय प्रणाली में पंजीकरण पूरा करें',
      action: 'सत्यापित करें और कंपनी बनाएँ',
      notice: (date: string) => `यह लिंक ${date} (UTC) पर समाप्त होगा।`,
    },
    passwordReset: {
      subject: 'अपना पासवर्ड रीसेट करें',
      heading: 'जवार वित्तीय प्रणाली के लिए नया पासवर्ड बनाएँ',
      action: 'नया पासवर्ड बनाएँ',
      notice: (date: string) => `यह लिंक ${date} (UTC) पर समाप्त होगा। यदि आपने यह अनुरोध नहीं किया है, तो इस संदेश को अनदेखा करें।`,
    },
  },
} as const satisfies Record<SupportedLocale, {
  dir: 'rtl' | 'ltr';
  intl: string;
  verification: { subject: string; heading: string; action: string; notice: (date: string) => string };
  passwordReset: { subject: string; heading: string; action: string; notice: (date: string) => string };
}>;

function formatExpiry(expiresAt: Date, locale: SupportedLocale) {
  return expiresAt.toLocaleString(emailCopy[locale].intl, { timeZone: 'UTC', timeZoneName: 'short' });
}

export class ResendRegistrationMailer implements RegistrationMailer, PasswordResetMailer {
  constructor(private readonly apiKey: string, private readonly from: string) {}

  async sendVerification(message: RegistrationVerificationMessage, signal?: AbortSignal) {
    const copy = emailCopy[message.locale];
    const notice = copy.verification.notice(formatExpiry(message.expiresAt, message.locale));
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
    if (!response.ok) throw new Error(`REGISTRATION_EMAIL_PROVIDER_${response.status}`);
  }

  async sendPasswordReset(message: PasswordResetMessage, signal?: AbortSignal) {
    const copy = emailCopy[message.locale];
    const notice = copy.passwordReset.notice(formatExpiry(message.expiresAt, message.locale));
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
    if (!response.ok) throw new Error(`PASSWORD_RESET_EMAIL_PROVIDER_${response.status}`);
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
