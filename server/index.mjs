import express from "express";
import Anthropic from "@anthropic-ai/sdk";
import {
  ANTHROPIC_KEY, TTB_KEY, MODEL,
  ALLOWED_MEDIA, MAX_IMAGE_BYTES, MAX_NOTE_LEN,
  analyzeDrawing, collectCandidates, pickBooks, enrichPicks, mockResult, resolvePicks,
} from "./lib.mjs";

const PORT = Number(process.env.PORT || 5210);

const app = express();
app.use(express.json({ limit: "15mb" }));

// ---------- 라우트 ----------
app.get("/api/health", (_req, res) => {
  res.json({ ok: true, anthropic: !!ANTHROPIC_KEY, aladin: !!TTB_KEY, model: MODEL });
});

// 1단계: 그림 분석만 먼저 반환 (11~13초) — 프론트에서 이 결과를 즉시 보여줘서 체감 대기시간을 줄임
app.post("/api/analyze", async (req, res) => {
  try {
    const { imageBase64, mediaType, age, note } = req.body || {};
    if (!imageBase64 || typeof imageBase64 !== "string") {
      return res.status(400).json({ error: "이미지가 없습니다. 그림 사진을 업로드해 주세요." });
    }
    if (!ALLOWED_MEDIA.has(mediaType)) {
      return res.status(400).json({ error: "지원하지 않는 이미지 형식입니다. (jpg/png/webp/gif)" });
    }
    if (imageBase64.length * 0.75 > MAX_IMAGE_BYTES) {
      return res.status(400).json({ error: "이미지가 너무 큽니다. 8MB 이하로 올려주세요." });
    }
    const safeNote = typeof note === "string" ? note.slice(0, MAX_NOTE_LEN) : "";
    const safeAge = typeof age === "string" ? age.slice(0, 20) : "";

    if (!ANTHROPIC_KEY || !TTB_KEY) {
      await new Promise((r) => setTimeout(r, 900));
      return res.json({ mock: true, analysis: mockResult().analysis, age: safeAge });
    }

    const client = new Anthropic({ apiKey: ANTHROPIC_KEY });
    const t0 = Date.now();
    const analysis = await analyzeDrawing(client, imageBase64, mediaType, safeAge, safeNote);
    console.log(`[timing] 분석:${Date.now() - t0}ms`);
    res.json({ analysis, age: safeAge });
    // 개인정보 보호: 이미지는 메모리에서만 처리되고 저장하지 않음 (요청 종료 시 폐기)
  } catch (err) {
    console.error("[analyze] error:", err);
    const msg = err?.message?.includes("거절") ? err.message : "그림을 분석하는 중 오류가 발생했습니다. 잠시 후 다시 시도해 주세요.";
    res.status(500).json({ error: msg });
  }
});

// 2단계: 분석 결과를 받아 도서 검색 + 선별
app.post("/api/pick", async (req, res) => {
  try {
    const { analysis, age } = req.body || {};
    if (!analysis || typeof analysis !== "object" || !Array.isArray(analysis.search_keywords)) {
      return res.status(400).json({ error: "그림 분석 결과가 없습니다. 처음부터 다시 시도해 주세요." });
    }
    const safeAge = typeof age === "string" ? age.slice(0, 20) : "";

    if (!ANTHROPIC_KEY || !TTB_KEY) {
      await new Promise((r) => setTimeout(r, 900));
      const mock = mockResult();
      return res.json({ mock: true, picks: mock.picks, overall_comment: mock.overall_comment });
    }

    const client = new Anthropic({ apiKey: ANTHROPIC_KEY });
    const t0 = Date.now();
    const candidates = await collectCandidates(analysis.search_keywords);
    const t1 = Date.now();

    if (candidates.length < 3) {
      return res.json({ picks: [], overall_comment: "이 키워드로 검색된 책이 부족했어요. 다른 그림이나 메모를 추가해 다시 시도해 주세요." });
    }

    const picked = await pickBooks(client, analysis, candidates, safeAge);
    const t2 = Date.now();
    let picks = resolvePicks(picked.picks, candidates);

    // 상세 조회로 별점·페이지·정가 보강
    picks = await enrichPicks(picks);
    const t3 = Date.now();
    console.log(`[timing] 검색:${t1 - t0}ms 선별:${t2 - t1}ms 보강:${t3 - t2}ms 총:${t3 - t0}ms`);

    res.json({ picks, overall_comment: picked.overall_comment });
  } catch (err) {
    console.error("[pick] error:", err);
    const msg = err?.message?.includes("거절") ? err.message : "책을 고르는 중 오류가 발생했습니다. 잠시 후 다시 시도해 주세요.";
    res.status(500).json({ error: msg });
  }
});

app.listen(PORT, () => {
  console.log(`[마음책방] API 서버 시작: http://localhost:${PORT}`);
  console.log(`  Anthropic 키: ${ANTHROPIC_KEY ? "설정됨" : "없음(데모 모드)"} / 알라딘 TTB 키: ${TTB_KEY ? "설정됨" : "없음(데모 모드)"}`);
});
