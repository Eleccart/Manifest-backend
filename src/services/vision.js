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
  // Rebuild lines by spatial row clustering instead of Vision's paragraph
  // structure: handwritten lists put the item on the left and the quantity in
  // a right-hand column, which Vision often emits as separate paragraphs.
  // Grouping words by vertical position reunites each visual row.
  const words = [];
  for (const page of annotation.pages || []) {
    for (const block of page.blocks || []) {
      for (const paragraph of block.paragraphs || []) {
        for (const word of paragraph.words || []) {
          const text = (word.symbols || []).map((s) => s.text).join("");
          if (!text.trim()) continue;
          const vertices = word.boundingBox?.vertices || [];
          const xs = vertices.map((v) => v.x || 0);
          const ys = vertices.map((v) => v.y || 0);
          words.push({
            text,
            confidence: typeof word.confidence === "number" ? word.confidence : null,
            xMin: xs.length ? Math.min(...xs) : 0,
            yCenter: ys.length ? ys.reduce((a, b) => a + b, 0) / ys.length : 0,
            height: ys.length ? Math.max(...ys) - Math.min(...ys) : 0,
          });
        }
      }
    }
  }
  const heights = words.map((w) => w.height).sort((a, b) => a - b);
  const medianHeight = heights[Math.floor(heights.length / 2)] || 20;
  words.sort((a, b) => a.yCenter - b.yCenter);
  const rows = [];
  let row = null;
  let rowY = 0;
  for (const word of words) {
    if (!row || word.yCenter - rowY > medianHeight * 0.7) {
      row = [];
      rows.push(row);
      rowY = word.yCenter;
    } else {
      rowY = (rowY * row.length + word.yCenter) / (row.length + 1);
    }
    row.push(word);
  }
  const lines = rows.map((r) => {
    r.sort((a, b) => a.xMin - b.xMin);
    const scored = r.filter((w) => w.confidence !== null);
    return {
      text: r.map((w) => w.text).join(" ").replace(/\s+([.,-])\s*/g, "$1 ").trim(),
      confidence: scored.length > 0 ? scored.reduce((sum, w) => sum + w.confidence, 0) / scored.length : 0.5,
    };
  }).filter((l) => l.text);
  return { rawText: annotation.text || "", lines };
}
module.exports = { detectDocumentText };
