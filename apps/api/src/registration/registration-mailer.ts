import { appendFile } from 'node:fs/promises';
import { logEvent } from '../operations/logger.js';

export type RegistrationVerificationMessage = {
  to: string;
  locale: 'ar' | 'en';
  verificationUrl: string;
  expiresAt: Date;
};

export interface RegistrationMailer {
  sendVerification(message: RegistrationVerificationMessage, signal?: AbortSignal): Promise<void>;
}

export type PasswordResetMessage = {
  to: string;
  locale: 'ar' | 'en';
  resetUrl: string;
  expiresAt: Date;
};

export interface PasswordResetMailer {
  sendPasswordReset(message: PasswordResetMessage, signal?: AbortSignal): Promise<void>;
}

function escapeHtml(value: string) {
  return value.replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('>', '&gt;').replaceAll('"', '&quot;').replaceAll("'", '&#039;');
}

export class ResendRegistrationMailer implements RegistrationMailer, PasswordResetMailer {
  constructor(private readonly apiKey: string, private readonly from: string) {}

  async sendVerification(message: RegistrationVerificationMessage, signal?: AbortSignal) {
    const arabic = message.locale === 'ar';
    const subject = arabic ? 'تحقق من بريدك لإنشاء شركتك' : 'Verify your email to create your company';
    const heading = arabic ? 'إكمال التسجيل في نظام جوار المالي' : 'Complete your Jawar Finance registration';
    const action = arabic ? 'تحقق وأنشئ الشركة' : 'Verify and create company';
    const notice = arabic
      ? `تنتهي صلاحية الرابط في ${message.expiresAt.toLocaleString('ar-SA', { timeZone: 'UTC' })} بالتوقيت العالمي.`
      : `This link expires at ${message.expiresAt.toLocaleString('en-US', { timeZone: 'UTC', timeZoneName: 'short' })}.`;
    const response = await fetch('https://api.resend.com/emails', {
      method: 'POST',
      headers: { Authorization: `Bearer ${this.apiKey}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        from: this.from,
        to: [message.to],
        subject,
        html: `<div dir="${arabic ? 'rtl' : 'ltr'}" style="font-family:Arial,sans-serif;line-height:1.7"><h1>${heading}</h1><p>${notice}</p><p><a href="${escapeHtml(message.verificationUrl)}" style="background:#176b5b;color:#fff;padding:12px 18px;border-radius:8px;text-decoration:none">${action}</a></p></div>`,
      }),
      signal: signal ? AbortSignal.any([signal, AbortSignal.timeout(10_000)]) : AbortSignal.timeout(10_000),
    });
    if (!response.ok) throw new Error(`REGISTRATION_EMAIL_PROVIDER_${response.status}`);
  }

  async sendPasswordReset(message: PasswordResetMessage, signal?: AbortSignal) {
    const arabic = message.locale === 'ar';
    const subject = arabic ? 'استعادة كلمة المرور' : 'Reset your password';
    const heading = arabic ? 'تعيين كلمة مرور جديدة لنظام جوار المالي' : 'Set a new Jawar Finance password';
    const action = arabic ? 'تعيين كلمة مرور جديدة' : 'Set a new password';
    const notice = arabic
      ? `ينتهي الرابط في ${message.expiresAt.toLocaleString('ar-SA', { timeZone: 'UTC' })} بالتوقيت العالمي. تجاهل الرسالة إذا لم تطلب الاستعادة.`
      : `This link expires at ${message.expiresAt.toLocaleString('en-US', { timeZone: 'UTC', timeZoneName: 'short' })}. Ignore this message if you did not request it.`;
    const response = await fetch('https://api.resend.com/emails', {
      method: 'POST',
      headers: { Authorization: `Bearer ${this.apiKey}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        from: this.from,
        to: [message.to],
        subject,
        html: `<div dir="${arabic ? 'rtl' : 'ltr'}" style="font-family:Arial,sans-serif;line-height:1.7"><h1>${heading}</h1><p>${notice}</p><p><a href="${escapeHtml(message.resetUrl)}" style="background:#176b5b;color:#fff;padding:12px 18px;border-radius:8px;text-decoration:none">${action}</a></p></div>`,
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
