import Anthropic from "@anthropic-ai/sdk";
import {
  ANTHROPIC_KEY, TTB_KEY,
  ALLOWED_MEDIA, MAX_IMAGE_BYTES, MAX_NOTE_LEN,
  analyzeDrawing, mockResult,
} from "../server/lib.mjs";
import { readJsonBody, sendJson } from "./_util.mjs";

export const config = { maxDuration: 30 };

export default async function handler(req, res) {
  if (req.method !== "POST") return sendJson(res, 405, { error: "Method not allowed" });

  try {
    const body = await readJsonBody(req);
    const { imageBase64, mediaType, age, note } = body || {};

    if (!imageBase64 || typeof imageBase64 !== "string") {
      return sendJson(res, 400, { error: "이미지가 없습니다. 그림 사진을 업로드해 주세요." });
    }
    if (!ALLOWED_MEDIA.has(mediaType)) {
      return sendJson(res, 400, { error: "지원하지 않는 이미지 형식입니다. (jpg/png/webp/gif)" });
    }
    if (imageBase64.length * 0.75 > MAX_IMAGE_BYTES) {
      return sendJson(res, 400, { error: "이미지가 너무 큽니다. 8MB 이하로 올려주세요." });
    }
    const safeNote = typeof note === "string" ? note.slice(0, MAX_NOTE_LEN) : "";
    const safeAge = typeof age === "string" ? age.slice(0, 20) : "";

    if (!ANTHROPIC_KEY || !TTB_KEY) {
      return sendJson(res, 200, { mock: true, analysis: mockResult().analysis, age: safeAge });
    }

    const client = new Anthropic({ apiKey: ANTHROPIC_KEY });
    const analysis = await analyzeDrawing(client, imageBase64, mediaType, safeAge, safeNote);
    sendJson(res, 200, { analysis, age: safeAge });
    // 개인정보 보호: 이미지는 메모리에서만 처리되고 저장하지 않음 (요청 종료 시 폐기)
  } catch (err) {
    console.error("[analyze] error:", err);
    const msg = err?.message?.includes("거절") ? err.message : "그림을 분석하는 중 오류가 발생했습니다. 잠시 후 다시 시도해 주세요.";
    sendJson(res, 500, { error: msg });
  }
}
