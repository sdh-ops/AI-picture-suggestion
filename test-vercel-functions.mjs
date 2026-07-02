// Vercel 배포 전, api/*.mjs 핸들러를 Express 없이 직접 호출해 검증하는 브릿지.
// Vercel Node 런타임이 res에 주입하는 .status()/.json() 헬퍼를 흉내낸다.
import http from "node:http";
import zlib from "node:zlib";
import analyzeHandler from "./api/analyze.mjs";
import pickHandler from "./api/pick.mjs";
import healthHandler from "./api/health.mjs";

function makeTestPng() {
  const W = 120, H = 90;
  const px = Buffer.alloc(W * H * 3);
  for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
    const i = (y * W + x) * 3;
    px[i] = 175; px[i + 1] = 215; px[i + 2] = 235;
  }
  const raw = Buffer.alloc(H * (W * 3 + 1));
  for (let y = 0; y < H; y++) { raw[y * (W * 3 + 1)] = 0; px.copy(raw, y * (W * 3 + 1) + 1, y * W * 3, (y + 1) * W * 3); }
  const comp = zlib.deflateSync(raw);
  const table = [];
  for (let n = 0; n < 256; n++) { let c = n; for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1; table[n] = c; }
  const chunk = (type, data) => {
    const len = Buffer.alloc(4); len.writeUInt32BE(data.length);
    const t = Buffer.from(type);
    let crc = 0xffffffff; const buf = Buffer.concat([t, data]);
    for (let i = 0; i < buf.length; i++) crc = table[(crc ^ buf[i]) & 0xff] ^ (crc >>> 8);
    crc = (crc ^ 0xffffffff) >>> 0;
    const crcBuf = Buffer.alloc(4); crcBuf.writeUInt32BE(crc);
    return Buffer.concat([len, t, data, crcBuf]);
  };
  const sig = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]);
  const ihdr = Buffer.alloc(13); ihdr.writeUInt32BE(W, 0); ihdr.writeUInt32BE(H, 4); ihdr[8] = 8; ihdr[9] = 2;
  return Buffer.concat([sig, chunk("IHDR", ihdr), chunk("IDAT", comp), chunk("IEND", Buffer.alloc(0))]);
}
const TEST_PNG_B64 = makeTestPng().toString("base64");

function augmentRes(res) {
  res.status = (code) => { res.statusCode = code; return res; };
  res.json = (data) => { res.setHeader("Content-Type", "application/json; charset=utf-8"); res.end(JSON.stringify(data)); return res; };
  return res;
}

const routes = {
  "/api/analyze": analyzeHandler,
  "/api/pick": pickHandler,
  "/api/health": healthHandler,
};

const server = http.createServer(async (req, res) => {
  augmentRes(res);
  const handler = routes[req.url];
  if (!handler) { res.status(404).json({ error: "not found" }); return; }
  try {
    await handler(req, res);
  } catch (e) {
    console.error("bridge error:", e);
    if (!res.headersSent) res.status(500).json({ error: "internal" });
  }
});

const PORT = 5388;
server.listen(PORT, async () => {
  console.log(`[vercel-함수 브릿지] http://localhost:${PORT}`);

  const health = await fetch(`http://localhost:${PORT}/api/health`).then((r) => r.json());
  console.log("health:", health);

  const analyzeRes = await fetch(`http://localhost:${PORT}/api/analyze`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ imageBase64: TEST_PNG_B64, mediaType: "image/png", age: "초등 저학년", note: "" }),
  });
  const analyzeData = await analyzeRes.json();
  console.log("\nanalyze status:", analyzeRes.status, "| mock:", analyzeData.mock, "| has analysis:", !!analyzeData.analysis);

  if (analyzeData.analysis) {
    const pickRes = await fetch(`http://localhost:${PORT}/api/pick`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ analysis: analyzeData.analysis, age: "초등 저학년" }),
    });
    const pickData = await pickRes.json();
    console.log("pick status:", pickRes.status, "| mock:", pickData.mock, "| picks:", pickData.picks?.length);
  }

  // 잘못된 요청도 확인
  const badRes = await fetch(`http://localhost:${PORT}/api/analyze`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({}),
  });
  console.log("\n빈 요청 status:", badRes.status, await badRes.json());

  const badMethod = await fetch(`http://localhost:${PORT}/api/analyze`, { method: "GET" });
  console.log("GET 요청(허용 안 함) status:", badMethod.status);

  server.close();
});
