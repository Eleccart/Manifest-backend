const pool = require("../db/pool");
const config = require("../config");
const { generateOtp, sha256, generateSessionToken } = require("../utils/crypto");
const msg91 = require("./msg91");
class OtpError extends Error {
  constructor(message, status = 400) {
    super(message);
    this.status = status;
  }
}
const PHONE_REGEX = /^[6-9]\d{9}$/;
function assertValidPhone(phoneNumber) {
  if (!PHONE_REGEX.test(phoneNumber)) throw new OtpError("Enter a valid 10-digit mobile number.");
}
async function requestOtp(phoneNumber) {
  assertValidPhone(phoneNumber);
  const otp = generateOtp();
  const codeHash = sha256(otp);
  const expiresAt = new Date(Date.now() + config.otp.expiryMinutes * 60 * 1000);
  await pool.query(
    `INSERT INTO otp_requests (phone_number, code_hash, expires_at, attempts) VALUES ($1, $2, $3, 0)`,
    [phoneNumber, codeHash, expiresAt]
  );
  await msg91.sendOtpSms(phoneNumber, otp);
  return { expiresInMinutes: config.otp.expiryMinutes };
}
async function verifyOtp(phoneNumber, code, deviceId) {
  assertValidPhone(phoneNumber);
  if (!/^\d{6}$/.test(code || "")) throw new OtpError("Enter the 6-digit code.");
  const { rows } = await pool.query(
    `SELECT id, code_hash, attempts, expires_at, verified_at FROM otp_requests WHERE phone_number = $1 ORDER BY created_at DESC LIMIT 1`,
    [phoneNumber]
  );
  const record = rows[0];
  if (!record) throw new OtpError("No OTP was requested for this number. Request a new one.");
  if (record.verified_at) throw new OtpError("This code was already used. Request a new one.");
  if (new Date(record.expires_at) < new Date()) throw new OtpError("This code has expired. Request a new one.");
  if (record.attempts >= config.otp.maxAttempts) throw new OtpError("Too many incorrect attempts. Request a new OTP.", 429);
  const codeHash = sha256(code);
  if (codeHash !== record.code_hash) {
    await pool.query(`UPDATE otp_requests SET attempts = attempts + 1 WHERE id = $1`, [record.id]);
    const remaining = config.otp.maxAttempts - (record.attempts + 1);
    throw new OtpError(remaining > 0 ? `Incorrect code. ${remaining} attempt(s) left.` : "Too many incorrect attempts. Request a new OTP.");
  }
  await pool.query(`UPDATE otp_requests SET verified_at = now() WHERE id = $1`, [record.id]);
  const userResult = await pool.query(
    `INSERT INTO users (phone_number) VALUES ($1) ON CONFLICT (phone_number) DO UPDATE SET phone_number = EXCLUDED.phone_number RETURNING id, phone_number, name, created_at`,
    [phoneNumber]
  );
  const user = userResult.rows[0];
  const token = generateSessionToken();
  const tokenHash = sha256(token);
  await pool.query(`INSERT INTO sessions (user_id, token_hash, device_id) VALUES ($1, $2, $3)`, [user.id, tokenHash, deviceId || null]);
  return { token, user };
}
async function logout(tokenHash) {
  await pool.query(`UPDATE sessions SET revoked_at = now() WHERE token_hash = $1 AND revoked_at IS NULL`, [tokenHash]);
}
module.exports = { requestOtp, verifyOtp, logout, OtpError };
