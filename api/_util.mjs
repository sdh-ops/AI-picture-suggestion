// Vercel Node 함수용 유틸 — req.body가 이미 파싱돼 있으면 그대로 쓰고,
// 아니면 원시 스트림을 직접 읽어 JSON으로 파싱한다(런타임별 자동 파싱 차이에 안전하게 대응).
export async function readJsonBody(req) {
  if (req.body && typeof req.body === "object") return req.body;
  if (typeof req.body === "string" && req.body.length) {
    try { return JSON.parse(req.body); } catch { return {}; }
  }
  const chunks = [];
  for await (const chunk of req) chunks.push(chunk);
  const raw = Buffer.concat(chunks).toString("utf8");
  if (!raw) return {};
  try { return JSON.parse(raw); } catch { return {}; }
}

export function sendJson(res, status, data) {
  res.status(status).setHeader("Content-Type", "application/json; charset=utf-8");
  res.end(JSON.stringify(data));
}
