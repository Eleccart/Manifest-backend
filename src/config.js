require("dotenv").config();
function required(name, fallback) {
  const val = process.env[name] ?? fallback;
  if (val === undefined) throw new Error(`Missing required environment variable: ${name}`);
  return val;
}
module.exports = {
  nodeEnv: process.env.NODE_ENV || "development",
  port: parseInt(process.env.PORT || "4000", 10),
  databaseUrl: required("DATABASE_URL"),
  msg91: {
    authKey: process.env.MSG91_AUTH_KEY || "",
    senderId: process.env.MSG91_SENDER_ID || "MANFST",
    templateId: process.env.MSG91_TEMPLATE_ID || "",
    route: process.env.MSG91_ROUTE || "4",
  },
  googleVision: {
    apiKey: process.env.GOOGLE_VISION_API_KEY || "",
  },
  otp: {
    expiryMinutes: parseInt(process.env.OTP_EXPIRY_MINUTES || "5", 10),
    maxAttempts: parseInt(process.env.OTP_MAX_ATTEMPTS || "5", 10),
  },
};
