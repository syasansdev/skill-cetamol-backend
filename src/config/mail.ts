import nodemailer from 'nodemailer';
import dotenv from 'dotenv';

dotenv.config();

const emailUser = (process.env.EMAIL_USER || '').trim();
const emailPass = (process.env.EMAIL_PASS || '').replace(/[\s"']/g, '');

const transporter = nodemailer.createTransport({
  service: 'gmail',
  auth: {
    user: emailUser,
    pass: emailPass
  }
});

// Verify connection configuration
transporter.verify((error, success) => {
  if (error) {
    console.error('Nodemailer connection verify failed:', error.message);
  } else {
    console.log('Nodemailer SMTP server is ready to deliver messages');
  }
});

export default transporter;
