const multer = require("multer");
const ALLOWED_MIME = ["image/jpeg", "image/png", "image/webp", "application/pdf"];
const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 20 * 1024 * 1024 },
  fileFilter: (req, file, cb) => {
    if (!ALLOWED_MIME.includes(file.mimetype)) return cb(new Error("Unsupported file type. Upload a JPG, PNG, WEBP, or PDF."));
    cb(null, true);
  },
});
module.exports = upload;
