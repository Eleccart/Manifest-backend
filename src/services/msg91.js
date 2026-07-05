const axios = require("axios");
const config = require("../config");
async function sendOtpSms(phoneNumber, otp) {
  if (!config.msg91.authKey) {
    console.log(`[dev] OTP for +91${phoneNumber}: ${otp}`);
    return { simulated: true };
  }
  const response = await axios.post(
    "https://api.msg91.com/api/v5/flow/",
    { flow_id: config.msg91.templateId, sender: config.msg91.senderId, mobiles: `91${phoneNumber}`, OTP: otp },
    { headers: { authkey: config.msg91.authKey, "Content-Type": "application/json" }, timeout: 10000 }
  );
  return response.data;
}
module.exports = { sendOtpSms };
