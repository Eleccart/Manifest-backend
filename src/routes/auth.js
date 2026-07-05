const express = require("express");
const otp = require("../services/otp");
const requireAuth = require("../middleware/requireAuth");
const router = express.Router();
router.post("/otp/request", async (req, res, next) => {
  try {
    const { phone_number } = req.body;
    const result = await otp.requestOtp(phone_number);
    res.json({ message: "OTP sent.", ...result });
  } catch (err) { next(err); }
});
router.post("/otp/verify", async (req, res, next) => {
  try {
    const { phone_number, code, device_id } = req.body;
    const { token, user } = await otp.verifyOtp(phone_number, code, device_id);
    res.json({ token, user });
  } catch (err) { next(err); }
});
router.post("/logout", requireAuth, async (req, res, next) => {
  try {
    await otp.logout(req.session.tokenHash);
    res.json({ message: "Logged out." });
  } catch (err) { next(err); }
});
router.get("/me", requireAuth, (req, res) => res.json({ user: req.user }));
module.exports = router;
