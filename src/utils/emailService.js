// utils/emailService.js

const nodemailer = require("nodemailer");
const ejs = require("ejs");
const path = require("path");

class EmailService {
  constructor({ to }) {
    this.to = to;

    const {
      SMTP_FROM,
      SMTP_PASS,
      SMTP_USER,
      SMTP_HOST,
      SMTP_PORT,
      SMTP_SECURE,
    } = process.env;

    this.from = SMTP_FROM;

    this.transporter = nodemailer.createTransport({
      host: SMTP_HOST,
      port: parseInt(SMTP_PORT) || 465,
      secure: SMTP_SECURE === "true",
      auth: {
        user: SMTP_USER,
        pass: SMTP_PASS,
      },
    });
  }

  async renderTemplate(templateName, data = {}) {
    const templatePath = path.join(
      __dirname,
      "..",
      "views",
      `${templateName}.ejs`,
    );

    return await ejs.renderFile(templatePath, data);
  }

  async send({ subject, message, template, templateData, attachments }) {
    let htmlContent = message;

    try {
      if (template) {
        htmlContent = await this.renderTemplate(template, templateData || {});
      }

      const mailOptions = {
        from: this.from,
        to: this.to,
        subject,
        text: message || "",
        html: htmlContent,
        attachments: attachments || [],
      };

      const info = await this.transporter.sendMail(mailOptions);

      console.log(`📧 Email sent to ${this.to}`);
      return info;
    } catch (error) {
      console.error(`❌ Email failed: ${error.message}`);
      throw new Error(error.message);
    }
  }
}

module.exports = EmailService;