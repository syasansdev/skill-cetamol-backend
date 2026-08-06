import transporter from '../config/mail';

const getSender = () => `"Skill Cetamol Portal" <${process.env.EMAIL_USER || 'syasanscareeranalytics@gmail.com'}>`;

export const emailService = {
  // 1. Student Registration
  sendStudentRegistration: async (email: string, name: string) => {
    const html = `
      <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto; padding: 20px; border: 1px solid #e2e8f0; border-radius: 6px;">
        <h2 style="color: #10b981; border-bottom: 1px solid #e2e8f0; padding-bottom: 10px;">Registration Successful!</h2>
        <p>Dear ${name},</p>
        <p>Congratulations! Your student account on the **Skill Cetamol Examination Portal** has been successfully registered and activated.</p>
        <p>You can now log in using the email and password you created during registration.</p>
        <div style="margin: 24px 0;">
          <a href="http://localhost:5173/login" style="background-color: #2563eb; color: #ffffff; padding: 10px 18px; text-decoration: none; border-radius: 4px; font-weight: bold; font-size: 14px;">Access Portal Now</a>
        </div>
        <p style="color: #64748b; font-size: 13px; margin-top: 30px; border-top: 1px solid #e2e8f0; padding-top: 10px;">This is an automated notification. Please do not reply directly to this email.</p>
      </div>
    `;
    return transporter.sendMail({
      from: getSender(),
      to: email,
      subject: 'Skill Cetamol Exam Portal - Registration Successful',
      html
    });
  },

  // 2. Student Approval
  sendStudentApproval: async (email: string, name: string) => {
    const html = `
      <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto; padding: 20px; border: 1px solid #e2e8f0; border-radius: 6px;">
        <h2 style="color: #16a34a; border-bottom: 1px solid #e2e8f0; padding-bottom: 10px;">Account Approved!</h2>
        <p>Dear ${name},</p>
        <p>Congratulations! Your student account on the **Skill Cetamol Examination Portal** has been approved by the faculty.</p>
        <p>For security, student logins are passwordless. You must log in using a <strong>Magic Code</strong> sent to your email.</p>
        <div style="margin: 24px 0;">
          <a href="http://localhost:5173/login" style="background-color: #2563eb; color: #ffffff; padding: 10px 18px; text-decoration: none; border-radius: 4px; font-weight: bold; font-size: 14px;">Access Portal with Magic Code</a>
        </div>
        <p style="color: #64748b; font-size: 13px; margin-top: 30px; border-top: 1px solid #e2e8f0; padding-top: 10px;">Skill Cetamol Evaluation Systems</p>
      </div>
    `;
    return transporter.sendMail({
      from: getSender(),
      to: email,
      subject: 'Skill Cetamol Exam Portal - Student Account Approved',
      html
    });
  },

  // 3. Faculty / Any Account Created — Rich Welcome Email
  sendFacultyAccountCreated: async (email: string, name: string, facultyId: string, password?: string, role: string = 'faculty') => {
    const roleLabel = role.charAt(0).toUpperCase() + role.slice(1);
    const displayPassword = password || 'faculty123';
    console.log(`[EmailService] Attempting to send ${roleLabel} welcome email to ${email}...`);
    const html = `
<!DOCTYPE html>
<html lang="en">
<head><meta charset="UTF-8"/><meta name="viewport" content="width=device-width, initial-scale=1.0"/></head>
<body style="margin:0;padding:0;background-color:#f1f5f9;font-family:'Segoe UI',Arial,sans-serif;">
  <table width="100%" cellpadding="0" cellspacing="0" style="background:#f1f5f9;padding:40px 0;">
    <tr><td align="center">
      <table width="600" cellpadding="0" cellspacing="0" style="background:#ffffff;border-radius:12px;overflow:hidden;box-shadow:0 4px 24px rgba(0,0,0,0.08);">

        <!-- Header Banner -->
        <tr>
          <td style="background:linear-gradient(135deg,#1e3a5f 0%,#2563eb 100%);padding:36px 40px;text-align:center;">
            <h1 style="margin:0;color:#ffffff;font-size:26px;font-weight:700;letter-spacing:-0.5px;">Skill Cetamol Exam Portal</h1>
            <p style="margin:8px 0 0;color:#bfdbfe;font-size:14px;">Enterprise Examination Management System</p>
          </td>
        </tr>

        <!-- Welcome Body -->
        <tr>
          <td style="padding:36px 40px;">
            <p style="margin:0 0 6px;color:#64748b;font-size:13px;text-transform:uppercase;letter-spacing:1px;font-weight:600;">Account Provisioned</p>
            <h2 style="margin:0 0 16px;color:#0f172a;font-size:22px;font-weight:700;">Welcome, ${name}! 👋</h2>
            <p style="margin:0 0 24px;color:#475569;font-size:15px;line-height:1.7;">
              Your <strong>${roleLabel}</strong> account on the <strong>Skill Cetamol Examination Portal</strong> has been successfully created by the administrator. 
              You can now log in using the credentials below.
            </p>

            <!-- Credential Card -->
            <table width="100%" cellpadding="0" cellspacing="0" style="background:#f8fafc;border:1.5px solid #e2e8f0;border-radius:10px;overflow:hidden;margin-bottom:28px;">
              <tr>
                <td style="background:#1e3a5f;padding:12px 20px;">
                  <p style="margin:0;color:#93c5fd;font-size:12px;font-weight:600;text-transform:uppercase;letter-spacing:1px;">Your Login Credentials</p>
                </td>
              </tr>
              <tr>
                <td style="padding:20px;">
                  <table width="100%" cellpadding="0" cellspacing="0">
                    <tr>
                      <td style="padding:8px 0;border-bottom:1px solid #e2e8f0;">
                        <span style="color:#64748b;font-size:13px;font-weight:600;display:inline-block;width:160px;">🪪 ID / Register No.</span>
                        <code style="background:#dbeafe;color:#1d4ed8;padding:3px 10px;border-radius:4px;font-size:13px;font-weight:700;">${facultyId}</code>
                      </td>
                    </tr>
                    <tr>
                      <td style="padding:8px 0;border-bottom:1px solid #e2e8f0;">
                        <span style="color:#64748b;font-size:13px;font-weight:600;display:inline-block;width:160px;">📧 Email Address</span>
                        <code style="background:#f0fdf4;color:#166534;padding:3px 10px;border-radius:4px;font-size:13px;font-weight:700;">${email}</code>
                      </td>
                    </tr>
                    <tr>
                      <td style="padding:8px 0;border-bottom:1px solid #e2e8f0;">
                        <span style="color:#64748b;font-size:13px;font-weight:600;display:inline-block;width:160px;">🔑 Password</span>
                        <code style="background:#fef3c7;color:#92400e;padding:3px 10px;border-radius:4px;font-size:13px;font-weight:700;">${displayPassword}</code>
                      </td>
                    </tr>
                    <tr>
                      <td style="padding:8px 0;">
                        <span style="color:#64748b;font-size:13px;font-weight:600;display:inline-block;width:160px;">🎭 Role</span>
                        <code style="background:#f3e8ff;color:#7c3aed;padding:3px 10px;border-radius:4px;font-size:13px;font-weight:700;">${roleLabel}</code>
                      </td>
                    </tr>
                  </table>
                </td>
              </tr>
            </table>

            <!-- Security Note -->
            <table width="100%" cellpadding="0" cellspacing="0" style="background:#fff7ed;border:1px solid #fed7aa;border-radius:8px;margin-bottom:28px;">
              <tr>
                <td style="padding:14px 18px;">
                  <p style="margin:0;color:#9a3412;font-size:13px;line-height:1.6;">
                    <strong>⚠️ Security Notice:</strong> For your safety, please change your password immediately after your first login via <em>Profile → Change Password</em>.
                  </p>
                </td>
              </tr>
            </table>

            <!-- CTA Button -->
            <table width="100%" cellpadding="0" cellspacing="0">
              <tr>
                <td align="center">
                  <a href="http://localhost:5173/login"
                     style="display:inline-block;background:linear-gradient(135deg,#2563eb,#1d4ed8);color:#ffffff;padding:14px 40px;border-radius:8px;font-size:15px;font-weight:700;text-decoration:none;letter-spacing:0.3px;box-shadow:0 4px 14px rgba(37,99,235,0.35);">
                    → Access Portal Now
                  </a>
                </td>
              </tr>
            </table>
          </td>
        </tr>

        <!-- Footer -->
        <tr>
          <td style="background:#f8fafc;border-top:1px solid #e2e8f0;padding:20px 40px;text-align:center;">
            <p style="margin:0;color:#94a3b8;font-size:12px;line-height:1.6;">
              This is an automated message from <strong>Skill Cetamol Evaluation Systems</strong>.<br/>
              Please do not reply to this email. Contact your system administrator for support.
            </p>
          </td>
        </tr>

      </table>
    </td></tr>
  </table>
</body>
</html>
    `;
    try {
      const info = await transporter.sendMail({
        from: getSender(),
        to: email,
        subject: `✅ Skill Cetamol Portal — Your ${roleLabel} Account is Ready`,
        html
      });
      console.log(`[EmailService] Faculty welcome email sent successfully to ${email}. Message ID: ${info.messageId}`);
      return info;
    } catch (err) {
      console.error(`[EmailService] Failed to send welcome email to ${email}:`, err);
      throw err;
    }
  },

  // 4. Exam Scheduled
  sendExamScheduled: async (email: string, studentName: string, examTitle: string, startTime: string) => {
    const html = `
      <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto; padding: 20px; border: 1px solid #e2e8f0; border-radius: 6px;">
        <h2 style="color: #0f172a; border-bottom: 1px solid #e2e8f0; padding-bottom: 10px;">New Examination Scheduled</h2>
        <p>Dear ${studentName},</p>
        <p>A new examination has been scheduled for your subject program:</p>
        <div style="background-color: #f8fafc; border: 1px solid #e2e8f0; padding: 16px; border-radius: 4px; margin: 16px 0;">
          <strong>Exam Title:</strong> ${examTitle}<br/>
          <strong>Start Date & Time:</strong> ${new Date(startTime).toLocaleString()}
        </div>
        <p>Please log in to your dashboard to review instructions and prepare for the evaluation session.</p>
        <p style="color: #64748b; font-size: 13px; margin-top: 30px; border-top: 1px solid #e2e8f0; padding-top: 10px;">Skill Cetamol Evaluation Systems</p>
      </div>
    `;
    return transporter.sendMail({
      from: getSender(),
      to: email,
      subject: `Exam Notice: ${examTitle}`,
      html
    });
  },

  // 5. Exam Reminder
  sendExamReminder: async (email: string, studentName: string, examTitle: string, minutesLeft: number) => {
    const html = `
      <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto; padding: 20px; border: 1px solid #e2e8f0; border-radius: 6px; border-left: 4px solid #f59e0b;">
        <h2 style="color: #f59e0b; border-bottom: 1px solid #e2e8f0; padding-bottom: 10px;">REMINDER: Exam Starting Shortly</h2>
        <p>Dear ${studentName},</p>
        <p>This is a quick proctoring reminder that the exam **${examTitle}** is scheduled to start in **${minutesLeft} minutes**.</p>
        <p>Ensure that you have stable network connectivity and a quiet environment before initiating the fullscreen console.</p>
        <p style="color: #64748b; font-size: 13px; margin-top: 30px; border-top: 1px solid #e2e8f0; padding-top: 10px;">Skill Cetamol Evaluation Systems</p>
      </div>
    `;
    return transporter.sendMail({
      from: getSender(),
      to: email,
      subject: `Proctor Alert: ${examTitle} starting in ${minutesLeft} mins`,
      html
    });
  },

  // 6. Password Reset
  sendPasswordReset: async (email: string, name: string, token: string) => {
    const html = `
      <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto; padding: 20px; border: 1px solid #e2e8f0; border-radius: 6px;">
        <h2 style="color: #dc2626; border-bottom: 1px solid #e2e8f0; padding-bottom: 10px;">Password Reset Request</h2>
        <p>Dear ${name},</p>
        <p>A request was received to reset your password on the **Skill Cetamol Examination System**.</p>
        <p>Please click the button below to specify a new password. This link is active for 1 hour.</p>
        <div style="margin: 24px 0;">
          <a href="http://localhost:5173/reset-password?token=${token}" style="background-color: #dc2626; color: #ffffff; padding: 10px 18px; text-decoration: none; border-radius: 4px; font-weight: bold; font-size: 14px;">Reset Password</a>
        </div>
        <p style="color: #64748b; font-size: 13px; margin-top: 30px; border-top: 1px solid #e2e8f0; padding-top: 10px;">If you did not initiate this request, you can safely ignore this email.</p>
      </div>
    `;
    return transporter.sendMail({
      from: getSender(),
      to: email,
      subject: 'Skill Cetamol Exam Portal - Password Reset Link',
      html
    });
  },

  // 7. Result Published
  sendResultPublished: async (email: string, studentName: string, examTitle: string, score: number, total: number) => {
    const pct = Math.round((score / total) * 100);
    const passed = pct >= 40;
    const html = `
      <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto; padding: 20px; border: 1px solid #e2e8f0; border-radius: 6px;">
        <h2 style="color: #0f172a; border-bottom: 1px solid #e2e8f0; padding-bottom: 10px;">Exam Result Published</h2>
        <p>Dear ${studentName},</p>
        <p>Evaluation scoring logs are now ready for **${examTitle}**:</p>
        <div style="background-color: #f8fafc; border: 1px solid #e2e8f0; padding: 16px; border-radius: 4px; margin: 16px 0;">
          <strong>Exam Title:</strong> ${examTitle}<br/>
          <strong>Secured Score:</strong> ${score} / ${total} points (${pct}%)<br/>
          <strong>Status:</strong> <span style="color: ${passed ? '#16a34a' : '#dc2626'}; font-weight: bold;">${passed ? 'PASSED' : 'FAILED'}</span>
        </div>
        <p>Log in to download your official PDF scorecard and view subject-wise breakdown analyses.</p>
        <p style="color: #64748b; font-size: 13px; margin-top: 30px; border-top: 1px solid #e2e8f0; padding-top: 10px;">Skill Cetamol Evaluation Systems</p>
      </div>
    `;
    return transporter.sendMail({
      from: getSender(),
      to: email,
      subject: `Evaluation Scorecard Released: ${examTitle}`,
      html
    });
  },
  
  // 8. Magic Code Login
  sendMagicCodeEmail: async (email: string, name: string, magicCode: string) => {
    const html = `
      <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto; padding: 20px; border: 1px solid #e2e8f0; border-radius: 6px;">
        <h2 style="color: #2563eb; border-bottom: 1px solid #e2e8f0; padding-bottom: 10px;">Login Magic Code</h2>
        <p>Dear ${name},</p>
        <p>You have requested a secure verification code to log in to the **Skill Cetamol Examination Portal**.</p>
        <div style="background-color: #f8fafc; border: 1px solid #e2e8f0; padding: 20px; text-align: center; border-radius: 4px; margin: 24px 0;">
          <span style="font-size: 32px; font-weight: bold; letter-spacing: 6px; color: #1e293b;">${magicCode}</span>
        </div>
        <p>This code is valid for **10 minutes**. Do not share this code with anyone.</p>
        <p style="color: #64748b; font-size: 13px; margin-top: 30px; border-top: 1px solid #e2e8f0; padding-top: 10px;">Skill Cetamol Evaluation Systems</p>
      </div>
    `;
    return transporter.sendMail({
      from: getSender(),
      to: email,
      subject: 'Skill Cetamol Exam Portal - Login Magic Code',
      html
    });
  },

  // 9. Student Reset Password Code
  sendStudentResetCodeEmail: async (email: string, name: string, magicCode: string) => {
    const html = `
      <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto; padding: 20px; border: 1px solid #e2e8f0; border-radius: 6px;">
        <h2 style="color: #dc2626; border-bottom: 1px solid #e2e8f0; padding-bottom: 10px;">Password Reset Code</h2>
        <p>Dear ${name},</p>
        <p>You have requested a verification code to reset your password on the **Skill Cetamol Examination Portal**.</p>
        <div style="background-color: #f8fafc; border: 1px solid #e2e8f0; padding: 20px; text-align: center; border-radius: 4px; margin: 24px 0;">
          <span style="font-size: 32px; font-weight: bold; letter-spacing: 6px; color: #1e293b;">${magicCode}</span>
        </div>
        <p>This code is valid for **15 minutes**. Do not share this code with anyone.</p>
        <p style="color: #64748b; font-size: 13px; margin-top: 30px; border-top: 1px solid #e2e8f0; padding-top: 10px;">Skill Cetamol Evaluation Systems</p>
      </div>
    `;
    return transporter.sendMail({
      from: getSender(),
      to: email,
      subject: 'Skill Cetamol Exam Portal - Password Reset Code',
      html
    });
  }
};
