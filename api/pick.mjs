import Anthropic from "@anthropic-ai/sdk";
import {
  ANTHROPIC_KEY, TTB_KEY,
  collectCandidates, pickBooks, enrichPicks, mockResult, resolvePicks,
} from "../server/lib.mjs";
import { readJsonBody, sendJson } from "./_util.mjs";

export const config = { maxDuration: 30 };

export default async function handler(req, res) {
  if (req.method !== "POST") return sendJson(res, 405, { error: "Method not allowed" });

  try {
    const body = await readJsonBody(req);
    const { analysis, age } = body || {};

    if (!analysis || typeof analysis !== "object" || !Array.isArray(analysis.search_keywords)) {
      return sendJson(res, 400, { error: "그림 분석 결과가 없습니다. 처음부터 다시 시도해 주세요." });
    }
    const safeAge = typeof age === "string" ? age.slice(0, 20) : "";

    if (!ANTHROPIC_KEY || !TTB_KEY) {
      const mock = mockResult();
      return sendJson(res, 200, { mock: true, picks: mock.picks, overall_comment: mock.overall_comment });
    }

    const client = new Anthropic({ apiKey: ANTHROPIC_KEY });
    const candidates = await collectCandidates(analysis.search_keywords);

    if (candidates.length < 3) {
      return sendJson(res, 200, { picks: [], overall_comment: "이 키워드로 검색된 책이 부족했어요. 다른 그림이나 메모를 추가해 다시 시도해 주세요." });
    }

    const picked = await pickBooks(client, analysis, candidates, safeAge);
    let picks = resolvePicks(picked.picks, candidates);
    picks = await enrichPicks(picks);

    sendJson(res, 200, { picks, overall_comment: picked.overall_comment });
  } catch (err) {
    console.error("[pick] error:", err);
    const msg = err?.message?.includes("거절") ? err.message : "책을 고르는 중 오류가 발생했습니다. 잠시 후 다시 시도해 주세요.";
    sendJson(res, 500, { error: msg });
  }
}
