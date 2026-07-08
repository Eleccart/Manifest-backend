const axios = require("axios");

// Optional LLM structuring pass over raw OCR text using Gemini Flash.
// Enabled when GEMINI_API_KEY is set; otherwise callers fall back to the
// regex parser. One call per scan.
async function structureWithLlm(rawText, categoryNames) {
  const key = process.env.GEMINI_API_KEY;
  if (!key || !rawText?.trim()) return null;

  const prompt = `You are cleaning up OCR text from a handwritten electrical-goods requirement slip from an Indian electrical store. The OCR is noisy: template words (NO, PARTICULARS, QTY, RATE, CGST, TOTAL, dates, page numbers) must be ignored; handwriting may be misread (e.g. "Squam"/"Soma" means "sqmm"; "Anuskabi" means "Anushakti").

Extract ONLY the actual product lines. For each, return:
- serial: sequence number starting at 1 (if the line begins with a written serial number like "1." or "2)", use it and REMOVE it from the name)
- name: cleaned product description (fix obvious OCR errors, keep coil lengths like "180mtr" in the name)
- qty: the quantity as a number (often the last bare number on the line, from the QTY column)
- category: one of ${JSON.stringify(categoryNames)} or null

Respond with ONLY a JSON array, no markdown fences, e.g.:
[{"serial":1,"name":"180mtr Apar Anushakti 1 sqmm","qty":3,"category":"Wires & Cables"}]

OCR text:
${rawText}`;

  try {
    const { data } = await axios.post(
      `https://generativelanguage.googleapis.com/v1beta/models/gemini-3.5-flash:generateContent?key=${key}`,
      { contents: [{ parts: [{ text: prompt }] }] },
      { timeout: 25000 }
    );
    const text = data.candidates?.[0]?.content?.parts?.[0]?.text || "";
    const clean = text.replace(/```json|```/g, "").trim();
    const parsed = JSON.parse(clean);
    if (!Array.isArray(parsed)) return null;
    return parsed
      .filter((p) => p && p.name)
      .map((p, i) => ({
        serial: Number(p.serial) || i + 1,
        name: String(p.name).trim(),
        qty: p.qty != null ? String(p.qty) : null,
        category: p.category || null,
      }));
  } catch (err) {
    console.error("LLM parse failed, falling back to regex parser:", err.message);
    return null;
  }
}

module.exports = { structureWithLlm };
