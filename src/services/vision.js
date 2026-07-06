const axios = require("axios");
const config = require("../config");
async function detectDocumentText(imageBuffer) {
  if (!config.googleVision.apiKey) throw new Error("GOOGLE_VISION_API_KEY is not set. Add it to .env before uploading a scan.");
  const base64 = imageBuffer.toString("base64");
  const { data } = await axios.post(
    `https://vision.googleapis.com/v1/images:annotate?key=${config.googleVision.apiKey}`,
    { requests: [{ image: { content: base64 }, features: [{ type: "DOCUMENT_TEXT_DETECTION" }] }] },
    { timeout: 30000 }
  );
  const annotation = data.responses?.[0]?.fullTextAnnotation;
  if (!annotation) return { rawText: "", lines: [] };
  const lines = [];
  for (const page of annotation.pages || []) {
    for (const block of page.blocks || []) {
      for (const paragraph of block.paragraphs || []) {
        let text = "";
        let confidenceSum = 0;
        let wordCount = 0;
        for (const word of paragraph.words || []) {
          const wordText = (word.symbols || []).map((s) => s.text).join("");
          text += (text ? " " : "") + wordText;
          if (typeof word.confidence === "number") { confidenceSum += word.confidence; wordCount += 1; }
        }
        if (text.trim()) lines.push({ text: text.trim(), confidence: wordCount > 0 ? confidenceSum / wordCount : paragraph.confidence ?? 0.5 });
      }
    }
  }
  return { rawText: annotation.text || "", lines };
}
module.exports = { detectDocumentText };
