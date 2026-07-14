import nodemailer from "nodemailer";
import { env } from "../config/env.js";

const isSmtpConfigured = () => Boolean(env.brevoSmtpHost && env.brevoSmtpPort && env.brevoSmtpUser && env.brevoSmtpPass);

const getTransporter = () => {
  if (!isSmtpConfigured()) return null;

  return nodemailer.createTransport({
    host: env.brevoSmtpHost,
    port: env.brevoSmtpPort,
    secure: env.brevoSmtpPort === 465,
    auth: {
      user: env.brevoSmtpUser,
      pass: env.brevoSmtpPass
    }
  });
};

const sendMail = async ({ to, subject, text, html }) => {
  const transporter = getTransporter();
  if (!transporter) {
    return { sent: false, skipped: true, reason: "SMTP is not configured" };
  }

  await transporter.sendMail({
    from: env.mailFrom,
    to,
    subject,
    text,
    html
  });

  return { sent: true, skipped: false };
};

export const sendVerificationEmail = async ({ user, verificationToken }) => {
  const verificationUrl = `${env.apiPublicUrl}/auth/verify/${verificationToken}`;
  const safeName = escapeHtml(user.name);
  const safeUrl = escapeHtml(verificationUrl);

  return sendMail({
    to: user.email,
    subject: "Verify your DroneOps account",
    text: [
      `Hi ${user.name},`,
      "",
      "Welcome to DroneOps. Verify your account to access the operations portal:",
      verificationUrl,
      "",
      "If you did not create this account, you can ignore this email."
    ].join("\n"),
    html: `
      <!doctype html>
      <html>
        <head>
          <meta charset="utf-8" />
          <meta name="viewport" content="width=device-width,initial-scale=1" />
          <title>Verify your DroneOps account</title>
        </head>
        <body style="margin:0;padding:0;background:#08111f;font-family:Arial,Helvetica,sans-serif;color:#f8fbff;">
          <table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="background:#08111f;padding:32px 14px;">
            <tr>
              <td align="center">
                <table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="max-width:640px;border-collapse:separate;border-spacing:0;background:#0e1828;border:1px solid #22314a;border-radius:26px;overflow:hidden;box-shadow:0 28px 70px rgba(0,0,0,.35);">
                  <tr>
                    <td style="padding:34px 32px 26px;background:linear-gradient(135deg,#101c30 0%,#0b1423 58%,#132642 100%);">
                      <table role="presentation" width="100%" cellspacing="0" cellpadding="0">
                        <tr>
                          <td style="font-size:38px;line-height:1;font-weight:800;color:#ffffff;letter-spacing:0;">
                            DRONE <span style="color:#5a95ff;">OPS</span>
                          </td>
                        </tr>
                        <tr>
                          <td style="padding-top:10px;color:#9eb0c8;font-size:12px;font-weight:700;letter-spacing:2px;text-transform:uppercase;">
                            Intelligent. Autonomous. Connected.
                          </td>
                        </tr>
                      </table>
                    </td>
                  </tr>
                  <tr>
                    <td style="padding:34px 32px 10px;">
                      <div style="display:inline-block;padding:8px 12px;border:1px solid #2e65c5;border-radius:999px;background:#122a52;color:#8fb8ff;font-size:12px;font-weight:800;letter-spacing:1px;text-transform:uppercase;">
                        Account verification
                      </div>
                      <h1 style="margin:18px 0 12px;color:#ffffff;font-size:32px;line-height:1.12;font-weight:800;">
                        Confirm your DroneOps access
                      </h1>
                      <p style="margin:0;color:#c4cfdd;font-size:16px;line-height:1.65;">
                        Hi ${safeName}, your workspace is almost ready. Verify this email to unlock mission, fleet, telemetry, safety, and compliance modules.
                      </p>
                    </td>
                  </tr>
                  <tr>
                    <td style="padding:18px 32px;">
                      <table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="border:1px solid #22314a;border-radius:18px;background:#111d30;">
                        <tr>
                          <td width="33.33%" style="padding:18px 14px;text-align:center;border-right:1px solid #22314a;">
                            <div style="color:#5a95ff;font-size:22px;font-weight:800;">01</div>
                            <div style="color:#c4cfdd;font-size:13px;line-height:1.4;">Verify email</div>
                          </td>
                          <td width="33.33%" style="padding:18px 14px;text-align:center;border-right:1px solid #22314a;">
                            <div style="color:#5a95ff;font-size:22px;font-weight:800;">02</div>
                            <div style="color:#c4cfdd;font-size:13px;line-height:1.4;">Sign in</div>
                          </td>
                          <td width="33.33%" style="padding:18px 14px;text-align:center;">
                            <div style="color:#5a95ff;font-size:22px;font-weight:800;">03</div>
                            <div style="color:#c4cfdd;font-size:13px;line-height:1.4;">Start operations</div>
                          </td>
                        </tr>
                      </table>
                    </td>
                  </tr>
                  <tr>
                    <td align="center" style="padding:20px 32px 34px;">
                      <a href="${safeUrl}" style="display:block;width:100%;max-width:360px;min-height:54px;line-height:54px;background:linear-gradient(135deg,#5a95ff,#2672ea);border-radius:12px;color:#ffffff;text-decoration:none;font-size:17px;font-weight:800;text-align:center;">
                        Verify account
                      </a>
                      <p style="margin:22px 0 0;color:#8fa0b8;font-size:13px;line-height:1.55;">
                        This link is intended for your DroneOps account only. If the button does not work, paste this URL into your browser:
                      </p>
                      <p style="margin:8px 0 0;color:#9eb0c8;font-size:12px;line-height:1.6;word-break:break-all;">
                        ${safeUrl}
                      </p>
                    </td>
                  </tr>
                </table>
                <p style="max-width:640px;margin:18px auto 0;color:#74849c;font-size:12px;line-height:1.5;text-align:center;">
                  If you did not create a DroneOps account, no action is needed.
                </p>
              </td>
            </tr>
          </table>
        </body>
      </html>
    `
  });
};

export const sendPasswordResetEmail = async ({ user, resetToken }) => {
  const resetUrl = `${env.clientPublicUrl}/reset-password/${resetToken}`;
  const safeName = escapeHtml(user.name);
  const safeUrl = escapeHtml(resetUrl);

  return sendMail({
    to: user.email,
    subject: "Reset your DroneOps password",
    text: [
      `Hi ${user.name},`,
      "",
      "We received a request to reset your DroneOps password.",
      "Open this secure link to choose a new password:",
      resetUrl,
      "",
      "If you did not request this, you can ignore this email."
    ].join("\n"),
    html: `
      <!doctype html>
      <html>
        <head>
          <meta charset="utf-8" />
          <meta name="viewport" content="width=device-width,initial-scale=1" />
          <title>Reset your DroneOps password</title>
        </head>
        <body style="margin:0;padding:0;background:#08111f;font-family:Arial,Helvetica,sans-serif;color:#f8fbff;">
          <table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="background:#08111f;padding:32px 14px;">
            <tr>
              <td align="center">
                <table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="max-width:640px;border-collapse:separate;border-spacing:0;background:#0e1828;border:1px solid #22314a;border-radius:26px;overflow:hidden;box-shadow:0 28px 70px rgba(0,0,0,.35);">
                  <tr>
                    <td style="padding:34px 32px 26px;background:linear-gradient(135deg,#101c30 0%,#0b1423 58%,#132642 100%);">
                      <div style="font-size:38px;line-height:1;font-weight:800;color:#ffffff;letter-spacing:0;">DRONE <span style="color:#5a95ff;">OPS</span></div>
                      <div style="padding-top:10px;color:#9eb0c8;font-size:12px;font-weight:700;letter-spacing:2px;text-transform:uppercase;">Secure operations portal</div>
                    </td>
                  </tr>
                  <tr>
                    <td style="padding:34px 32px 10px;">
                      <div style="display:inline-block;padding:8px 12px;border:1px solid #2e65c5;border-radius:999px;background:#122a52;color:#8fb8ff;font-size:12px;font-weight:800;letter-spacing:1px;text-transform:uppercase;">Password recovery</div>
                      <h1 style="margin:18px 0 12px;color:#ffffff;font-size:32px;line-height:1.12;font-weight:800;">Create a new password</h1>
                      <p style="margin:0;color:#c4cfdd;font-size:16px;line-height:1.65;">
                        Hi ${safeName}, use this one-time link to reset your DroneOps password and return to the operations portal.
                      </p>
                    </td>
                  </tr>
                  <tr>
                    <td style="padding:18px 32px;">
                      <table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="border:1px solid #22314a;border-radius:18px;background:#111d30;">
                        <tr>
                          <td style="padding:18px 20px;color:#c4cfdd;font-size:14px;line-height:1.55;">
                            For security, only use this link if you requested a reset. The old password will keep working until you submit a new one.
                          </td>
                        </tr>
                      </table>
                    </td>
                  </tr>
                  <tr>
                    <td align="center" style="padding:20px 32px 34px;">
                      <a href="${safeUrl}" style="display:block;width:100%;max-width:360px;min-height:54px;line-height:54px;background:linear-gradient(135deg,#5a95ff,#2672ea);border-radius:12px;color:#ffffff;text-decoration:none;font-size:17px;font-weight:800;text-align:center;">
                        Reset password
                      </a>
                      <p style="margin:22px 0 0;color:#8fa0b8;font-size:13px;line-height:1.55;">If the button does not work, paste this URL into your browser:</p>
                      <p style="margin:8px 0 0;color:#9eb0c8;font-size:12px;line-height:1.6;word-break:break-all;">${safeUrl}</p>
                    </td>
                  </tr>
                </table>
                <p style="max-width:640px;margin:18px auto 0;color:#74849c;font-size:12px;line-height:1.5;text-align:center;">
                  If this was not you, no action is needed.
                </p>
              </td>
            </tr>
          </table>
        </body>
      </html>
    `
  });
};

export const sendEmailChangeVerificationEmail = async ({ user, pendingEmail, emailChangeToken }) => {
  const changeUrl = `${env.apiPublicUrl}/auth/verify-email-change/${emailChangeToken}`;
  const safeName = escapeHtml(user.name);
  const safeCurrentEmail = escapeHtml(user.email);
  const safePendingEmail = escapeHtml(pendingEmail);
  const safeUrl = escapeHtml(changeUrl);

  return sendMail({
    to: user.email,
    subject: "Confirm your DroneOps email change",
    text: [
      `Hi ${user.name},`,
      "",
      `We received a request to change your DroneOps email from ${user.email} to ${pendingEmail}.`,
      "Confirm this change from your current email address:",
      changeUrl,
      "",
      "If you did not request this change, ignore this email and keep using your current account."
    ].join("\n"),
    html: `
      <!doctype html>
      <html>
        <head>
          <meta charset="utf-8" />
          <meta name="viewport" content="width=device-width,initial-scale=1" />
          <title>Confirm your DroneOps email change</title>
        </head>
        <body style="margin:0;padding:0;background:#08111f;font-family:Arial,Helvetica,sans-serif;color:#f8fbff;">
          <table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="background:#08111f;padding:32px 14px;">
            <tr>
              <td align="center">
                <table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="max-width:640px;border-collapse:separate;border-spacing:0;background:#0e1828;border:1px solid #22314a;border-radius:26px;overflow:hidden;box-shadow:0 28px 70px rgba(0,0,0,.35);">
                  <tr>
                    <td style="padding:34px 32px 26px;background:linear-gradient(135deg,#101c30 0%,#0b1423 58%,#132642 100%);">
                      <div style="font-size:38px;line-height:1;font-weight:800;color:#ffffff;">DRONE <span style="color:#5a95ff;">OPS</span></div>
                      <div style="padding-top:10px;color:#9eb0c8;font-size:12px;font-weight:700;letter-spacing:2px;text-transform:uppercase;">Secure account change</div>
                    </td>
                  </tr>
                  <tr>
                    <td style="padding:34px 32px 10px;">
                      <div style="display:inline-block;padding:8px 12px;border:1px solid #2e65c5;border-radius:999px;background:#122a52;color:#8fb8ff;font-size:12px;font-weight:800;letter-spacing:1px;text-transform:uppercase;">Email change verification</div>
                      <h1 style="margin:18px 0 12px;color:#ffffff;font-size:32px;line-height:1.12;font-weight:800;">Confirm this email change</h1>
                      <p style="margin:0;color:#c4cfdd;font-size:16px;line-height:1.65;">
                        Hi ${safeName}, confirm from your current verified email before DroneOps switches your account address.
                      </p>
                    </td>
                  </tr>
                  <tr>
                    <td style="padding:18px 32px;">
                      <table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="border:1px solid #22314a;border-radius:18px;background:#111d30;">
                        <tr>
                          <td style="padding:18px 20px;color:#c4cfdd;font-size:14px;line-height:1.65;">
                            <strong style="color:#ffffff;">Current email</strong><br />${safeCurrentEmail}<br /><br />
                            <strong style="color:#ffffff;">New email</strong><br />${safePendingEmail}
                          </td>
                        </tr>
                      </table>
                    </td>
                  </tr>
                  <tr>
                    <td align="center" style="padding:20px 32px 34px;">
                      <a href="${safeUrl}" style="display:block;width:100%;max-width:360px;min-height:54px;line-height:54px;background:linear-gradient(135deg,#5a95ff,#2672ea);border-radius:12px;color:#ffffff;text-decoration:none;font-size:17px;font-weight:800;text-align:center;">
                        Confirm email change
                      </a>
                      <p style="margin:22px 0 0;color:#8fa0b8;font-size:13px;line-height:1.55;">If the button does not work, paste this URL into your browser:</p>
                      <p style="margin:8px 0 0;color:#9eb0c8;font-size:12px;line-height:1.6;word-break:break-all;">${safeUrl}</p>
                    </td>
                  </tr>
                </table>
                <p style="max-width:640px;margin:18px auto 0;color:#74849c;font-size:12px;line-height:1.5;text-align:center;">
                  If you did not request this email change, no action is needed.
                </p>
              </td>
            </tr>
          </table>
        </body>
      </html>
    `
  });
};

const escapeHtml = (value = "") => {
  return value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
};
