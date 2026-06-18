import { Resend } from "resend";
import { db } from "@/db/client";
import { users } from "@/db/schema/auth";
import { eq, and } from "drizzle-orm";

const resendApiKey = process.env.RESEND_API_KEY;
const resend = resendApiKey ? new Resend(resendApiKey) : null;

const FROM_ADDRESS =
  process.env.EMAIL_FROM || "noreply@docreviewer.local";
const APP_NAME = "Legal Document Analysis AI";
const APP_URL = process.env.NEXTAUTH_URL || "http://localhost:3000";


async function sendEmail(params: {
  to: string;
  subject: string;
  text: string;
  html: string;
}): Promise<void> {
  if (!resend) {
    console.warn("RESEND_API_KEY not configured — skipping email send");
    return;
  }

  const { error } = await resend.emails.send({
    from: FROM_ADDRESS,
    to: params.to,
    subject: params.subject,
    text: params.text,
    html: params.html,
  });

  if (error) {
    throw new Error(`Resend API error: ${error.message}`);
  }
}

export async function sendWelcomeEmail(
  to: string,
  name: string,
): Promise<void> {
  await sendEmail({
    to,
    subject: `Welcome to ${APP_NAME}`,
    text: `Hi ${name},\n\nYour account has been created. An administrator will review and approve your access shortly.\n\nThank you.`,
    html: `
        <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto;">
          <h1 style="color: #2563eb;">Welcome to ${APP_NAME}!</h1>
          <p>Hi ${name},</p>
          <p>Thank you for registering with ${APP_NAME}. Your account has been created successfully.</p>
          <p><strong>Important:</strong> Your account is currently pending approval from an administrator. You will receive another email once your account has been approved.</p>
          <p>Once approved, you'll be able to:</p>
          <ul>
            <li>Analyze legal documents with AI-powered tools</li>
            <li>Access comprehensive compliance checking</li>
            <li>Customize your analysis workflows</li>
            <li>Save and manage your document reviews</li>
          </ul>
          <p>If you have any questions, please don't hesitate to contact us.</p>
          <p>Best regards,<br>The ${APP_NAME} Team</p>
          <hr style="border: none; border-top: 1px solid #e5e7eb; margin: 20px 0;">
          <p style="font-size: 12px; color: #6b7280;">
            This is an automated email. Please do not reply to this message.
          </p>
        </div>
      `,
  });
}

export async function sendAdminNotification(
  adminEmail: string,
  newUserEmail: string,
  newUserName: string,
): Promise<void> {
  await sendEmail({
    to: adminEmail,
    subject: "New user registration pending approval",
    text: `A new user has registered and is awaiting approval.\n\nName: ${newUserName}\nEmail: ${newUserEmail}\n\nPlease log in to the admin panel to approve or reject this account.`,
    html: `<p>A new user has registered and is awaiting approval.</p><ul><li><strong>Name:</strong> ${newUserName}</li><li><strong>Email:</strong> ${newUserEmail}</li></ul><p>Please log in to the admin panel to approve or reject this account.</p>`,
  });
}

export async function getAdminEmails(): Promise<string[]> {
  const admins = await db
    .select({ email: users.email })
    .from(users)
    .where(and(eq(users.role, "admin"), eq(users.isActive, true)));

  return admins.map((a) => a.email);
}

export async function sendOrganizationInvitationEmail(params: {
  to: string;
  invitedName: string;
  inviterName: string;
  organizationName: string;
  invitationToken: string;
  baseUrl: string;
}): Promise<void> {
  const {
    to,
    invitedName,
    inviterName,
    organizationName,
    invitationToken,
    baseUrl,
  } = params;

  const signupUrl = `${baseUrl}/auth/signup?invitationToken=${encodeURIComponent(invitationToken)}&name=${encodeURIComponent(invitedName)}&email=${encodeURIComponent(to)}`;

  await sendEmail({
    to,
    subject: `Invitation to join ${organizationName}`,
    text: `Hi ${invitedName},\n\n${inviterName} has invited you to join ${organizationName} on DocReviewer.\n\nCreate your account using this link:\n${signupUrl}\n\nIf you were not expecting this invitation, you can ignore this email.`,
      html: `
          <!DOCTYPE html>
          <html>
          <head>
            <meta charset="utf-8">
            <meta name="viewport" content="width=device-width, initial-scale=1.0">
            <title>You're Invited to ${APP_NAME}</title>
            <style>
              body {
                font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, 'Helvetica Neue', Arial, sans-serif;
                line-height: 1.6;
                color: #333;
                background-color: #f5f5f5;
                margin: 0;
                padding: 0;
              }
              .container {
                max-width: 600px;
                margin: 40px auto;
                background: white;
                border-radius: 8px;
                box-shadow: 0 2px 4px rgba(0,0,0,0.1);
                overflow: hidden;
              }
              .header {
                background: linear-gradient(135deg, #667eea 0%, #764ba2 100%);
                color: white;
                padding: 40px 30px;
                text-align: center;
              }
              .header h1 {
                margin: 0;
                font-size: 28px;
                font-weight: 600;
              }
              .content {
                padding: 40px 30px;
              }
              .greeting {
                font-size: 18px;
                margin-bottom: 20px;
                color: #1f2937;
              }
              .message {
                font-size: 16px;
                color: #4b5563;
                margin-bottom: 30px;
              }
              .credentials-box {
                background: linear-gradient(135deg, #f093fb 0%, #f5576c 100%);
                border-radius: 12px;
                padding: 25px;
                margin: 30px 0;
                color: white;
              }
              .credentials-box h3 {
                margin-top: 0;
                color: white;
                font-size: 18px;
              }
              .credentials-content {
                background-color: rgba(255,255,255,0.2);
                border-radius: 8px;
                padding: 15px;
                margin: 15px 0;
              }
              .credentials-content p {
                margin: 5px 0;
              }
              .credentials-content code {
                background-color: rgba(255,255,255,0.3);
                padding: 6px 10px;
                border-radius: 6px;
                font-family: 'Courier New', monospace;
                font-size: 14px;
                letter-spacing: 1px;
              }
              .credentials-warning {
                color: rgba(255,255,255,0.9);
                font-size: 14px;
                margin-bottom: 0;
              }
              .info-box {
                background: #f3f4f6;
                border-left: 4px solid #667eea;
                padding: 16px;
                margin: 20px 0;
                border-radius: 4px;
              }
              .info-box p {
                margin: 8px 0;
                font-size: 14px;
              }
              .info-box strong {
                color: #1f2937;
              }
              .cta-button {
                display: inline-block;
                background: linear-gradient(135deg, #667eea 0%, #764ba2 100%);
                color: white !important;
                text-decoration: none;
                padding: 14px 32px;
                border-radius: 25px;
                font-weight: 600;
                font-size: 16px;
                margin: 10px;
                text-align: center;
                box-shadow: 0 4px 15px rgba(102,126,234,0.4);
              }
              .cta-button-secondary {
                display: inline-block;
                background: linear-gradient(135deg, #11998e 0%, #38ef7d 100%);
                color: white !important;
                text-decoration: none;
                padding: 14px 32px;
                border-radius: 25px;
                font-weight: 600;
                font-size: 16px;
                margin: 10px;
                text-align: center;
                box-shadow: 0 4px 15px rgba(17,153,142,0.4);
              }
              .getting-started {
                background-color: #f8f9fa;
                border-left: 5px solid #007bff;
                padding: 20px;
                margin: 30px 0;
                border-radius: 5px;
              }
              .getting-started h4 {
                margin-top: 0;
                color: #007bff;
                font-size: 16px;
              }
              .getting-started ol {
                margin-bottom: 0;
                color: #555;
                padding-left: 20px;
              }
              .getting-started li {
                margin-bottom: 8px;
              }
              .expiry-notice {
                background: #fef3c7;
                border: 1px solid #fbbf24;
                border-radius: 4px;
                padding: 12px;
                margin: 20px 0;
                font-size: 14px;
                color: #92400e;
                text-align: center;
              }
              .footer {
                background: #f9fafb;
                padding: 20px 30px;
                text-align: center;
                font-size: 12px;
                color: #6b7280;
                border-top: 1px solid #e5e7eb;
              }
              .alternative-link {
                margin-top: 20px;
                padding: 16px;
                background: #f9fafb;
                border-radius: 4px;
                font-size: 12px;
                color: #6b7280;
                word-break: break-all;
              }
            </style>
          </head>
          <body>
            <div class="container">
              <div class="header">
                <h1>🎉 You're Invited!</h1>
              </div>
              
              <div class="content">
                <p class="greeting">Hello ${invitedName},</p>
                
                <p class="message">
                  <strong>${invitedName}</strong> has invited you to join <strong>${APP_NAME}</strong>, 
                  a comprehensive AI-powered legal document analysis platform.
                </p>
                
                <div style="text-align: center; margin: 40px 0;">
                  <a href="${signupUrl}" class="cta-button">🚀 Accept Invitation</a>
                </div>

                <div class="getting-started">
                  <h4>📋 Getting Started Guide:</h4>
                  <ol>
                    <li>Click "Accept Invitation" or "Login Directly" above</li>
                    <li>Use your email and the temporary password provided</li>
                    <li>Create a new secure password when prompted</li>
                    <li>Start exploring ${APP_NAME}!</li>
                  </ol>
                </div>
                
                <div class="expiry-notice">
                  ⏰ This invitation will expire in 7 days
                </div>
                
                <p class="message" style="margin-top: 30px;">
                  By accepting this invitation, you'll be able to:
                </p>
                <ul style="color: #4b5563; font-size: 14px; line-height: 1.8;">
                  <li>Analyze legal documents with AI assistance</li>
                  <li>Search and cite relevant case law</li>
                  <li>Generate compliance assessments</li>
                  <li>Customize analysis workflows</li>
                </ul>
                
                <div class="alternative-link">
                  <p style="margin: 0 0 8px 0;">📎 Alternative Access:</p>
                  <p style="margin: 0 0 8px 0;">Or copy and paste this invitation link:</p>
                  <p style="margin: 0; background-color: #e9ecef; padding: 12px; border-radius: 6px; font-family: 'Courier New', monospace;">${signupUrl}</p>
                </div>
              </div>
              
              <div class="footer">
                <p>This invitation was sent by ${invitedName} from ${APP_NAME}</p>
                <p>If you didn't expect this invitation, you can safely ignore this email.</p>
                <p style="margin-top: 10px;">© 2025 ${APP_NAME}. All rights reserved.</p>
              </div>
            </div>
          </body>
          </html>
      `,
  });
}

export async function sendPasswordResetEmail(params: {
  to: string;
  name: string;
  resetToken: string;
  baseUrl?: string;
}): Promise<void> {
  const { to, name, resetToken, baseUrl } = params;
  const appBaseUrl = baseUrl || APP_URL;
  const resetUrl = `${appBaseUrl}/auth/reset-password?token=${encodeURIComponent(resetToken)}`;

  await sendEmail({
    to,
    subject: `Reset your ${APP_NAME} password`,
    text: `Hi ${name},\n\nWe received a request to reset your password.\n\nUse this link to reset your password:\n${resetUrl}\n\nThis link expires in 1 hour. If you did not request this, you can ignore this email.`,
    html: `
      <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto;">
        <h2 style="color: #2563eb;">Reset your password</h2>
        <p>Hi ${name},</p>
        <p>We received a request to reset your password for ${APP_NAME}.</p>
        <p style="margin: 24px 0;">
          <a href="${resetUrl}" style="background: #2563eb; color: #fff; text-decoration: none; padding: 10px 16px; border-radius: 6px; display: inline-block;">Reset Password</a>
        </p>
        <p>This link expires in <strong>1 hour</strong>.</p>
        <p>If you did not request this, you can ignore this email.</p>
        <p style="font-size: 12px; color: #6b7280; margin-top: 20px;">If the button does not work, copy this link into your browser:<br>${resetUrl}</p>
      </div>
    `,
  });
}
