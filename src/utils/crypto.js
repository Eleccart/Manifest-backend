const crypto = require("crypto");
function generateOtp() {
  const n = crypto.randomInt(0, 1000000);
  return n.toString().padStart(6, "0");
}
function sha256(value) {
  return crypto.createHash("sha256").update(value).digest("hex");
}
function generateSessionToken() {
  return crypto.randomBytes(32).toString("hex");
}
module.exports = { generateOtp, sha256, generateSessionToken };
