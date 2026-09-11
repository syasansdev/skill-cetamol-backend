import nodemailer from 'nodemailer';
import dotenv from 'dotenv';

dotenv.config();

const emailUser = (process.env.EMAIL_USER || '').trim();
const emailPass = (process.env.EMAIL_PASS || '').replace(/[\s"']/g, '');

const transporter = nodemailer.createTransport({
  service: 'gmail',
  host: 'smtp.gmail.com',
  port: 465,
  secure: true,
  pool: true,
  maxConnections: 3,
  maxMessages: 100,
  rateDelta: 1000,
  rateLimit: 5,
  connectionTimeout: 15000,
  greetingTimeout: 10000,
  socketTimeout: 20000,
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
