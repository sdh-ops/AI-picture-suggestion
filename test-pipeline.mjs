// 임시 테스트 스크립트 — 여러 그림 시나리오로 파이프라인을 검증
import zlib from "node:zlib";

function makePng(draw) {
  const W = 240, H = 180;
  const px = Buffer.alloc(W * H * 3);
  function set(x, y, r, g, b) {
    x = Math.round(x); y = Math.round(y);
    if (x < 0 || y < 0 || x >= W || y >= H) return;
    const i = (y * W + x) * 3;
    px[i] = r; px[i + 1] = g; px[i + 2] = b;
  }
  draw(set, W, H);
  const raw = Buffer.alloc(H * (W * 3 + 1));
  for (let y = 0; y < H; y++) { raw[y * (W * 3 + 1)] = 0; px.copy(raw, y * (W * 3 + 1) + 1, y * W * 3, (y + 1) * W * 3); }
  const comp = zlib.deflateSync(raw);
  const table = [];
  for (let n = 0; n < 256; n++) { let c = n; for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1; table[n] = c; }
  function chunk(type, data) {
    const len = Buffer.alloc(4); len.writeUInt32BE(data.length);
    const t = Buffer.from(type);
    let crc = 0xffffffff; const buf = Buffer.concat([t, data]);
    for (let i = 0; i < buf.length; i++) crc = table[(crc ^ buf[i]) & 0xff] ^ (crc >>> 8);
    crc = (crc ^ 0xffffffff) >>> 0;
    const crcBuf = Buffer.alloc(4); crcBuf.writeUInt32BE(crc);
    return Buffer.concat([len, t, data, crcBuf]);
  }
  const sig = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]);
  const ihdr = Buffer.alloc(13); ihdr.writeUInt32BE(W, 0); ihdr.writeUInt32BE(H, 4); ihdr[8] = 8; ihdr[9] = 2;
  return Buffer.concat([sig, chunk("IHDR", ihdr), chunk("IDAT", comp), chunk("IEND", Buffer.alloc(0))]);
}

const scenes = [
  {
    name: "밝은 해+집+친구(공룡)",
    note: "요즘 밖에서 노는 걸 좋아해요",
    age: "초등 저학년",
    png: makePng((set, W, H) => {
      for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) set(x, y, y < H * 0.68 ? 175 : 150, y < H * 0.68 ? 215 : 195, y < H * 0.68 ? 235 : 120);
      const sx = 200, sy = 38, sr = 26;
      for (let y = -sr; y <= sr; y++) for (let x = -sr; x <= sr; x++) if (x * x + y * y <= sr * sr) set(sx + x, sy + y, 245, 205, 70);
      for (let y = 95; y < 140; y++) for (let x = 60; x < 120; x++) set(x, y, 205, 110, 90);
      const hx = 160, hy = 120, hr = 9;
      for (let y = -hr; y <= hr; y++) for (let x = -hr; x <= hr; x++) if (x * x + y * y <= hr * hr) set(hx + x, hy + y, 235, 215, 180);
    }),
  },
  {
    name: "어두운 구름+비+작은 사람(구석)",
    note: "",
    age: "초등 저학년",
    png: makePng((set, W, H) => {
      for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) set(x, y, 90, 95, 110);
      for (let cy = 30; cy < 70; cy++) for (let cx = 20; cx < 220; cx++) if (Math.random() > 0.3) set(cx, cy, 60, 62, 75);
      for (let i = 0; i < 40; i++) { const rx = Math.random() * W, ry = 70 + Math.random() * 90; for (let t = 0; t < 8; t++) set(rx, ry + t, 140, 150, 170); }
      const hx = 25, hy = 165, hr = 6;
      for (let y = -hr; y <= hr; y++) for (let x = -hr; x <= hr; x++) if (x * x + y * y <= hr * hr) set(hx + x, hy + y, 210, 190, 160);
    }),
  },
  {
    name: "여러 사람이 손잡고 원 그리기(우정)",
    note: "친구들이랑 노는 걸 그렸대요",
    age: "초등 고학년",
    png: makePng((set, W, H) => {
      for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) set(x, y, 255, 245, 220);
      const positions = [[70, 90], [110, 70], [150, 90], [130, 130], [90, 130]];
      for (const [hx, hy] of positions) {
        const hr = 8;
        for (let y = -hr; y <= hr; y++) for (let x = -hr; x <= hr; x++) if (x * x + y * y <= hr * hr) set(hx + x, hy + y, 230, 190, 150);
      }
    }),
  },
];

const BANNED = ["장애", "성향이 있", "문제가 있", "불안정하", "위축되어", "빨간색은", "검은색을 많이"];

async function run(scene) {
  const b64 = scene.png.toString("base64");
  const t0 = Date.now();
  const r1 = await fetch("http://localhost:5210/api/analyze", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ imageBase64: b64, mediaType: "image/png", age: scene.age, note: scene.note }),
  });
  const a1 = await r1.json();
  const t1 = Date.now();
  console.log(`\n========== [${scene.name}] 분석 ${t1 - t0}ms (status ${r1.status}) ==========`);
  if (a1.error) { console.log("ERROR (analyze):", a1.error); return; }

  const r2 = await fetch("http://localhost:5210/api/pick", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ analysis: a1.analysis, age: scene.age }),
  });
  const j = await r2.json();
  const t2 = Date.now();
  console.log(`선별 ${t2 - t1}ms (status ${r2.status}) | 총 ${t2 - t0}ms`);
  if (j.error) { console.log("ERROR (pick):", j.error); return; }

  const allText = JSON.stringify(a1.analysis) + JSON.stringify(j.picks) + j.overall_comment;
  const hits = BANNED.filter((w) => allText.includes(w));
  console.log("금지어 검출:", hits.length ? hits : "없음 (OK)");

  console.log("mood_reading:", a1.analysis.mood_reading);
  console.log("emotions:", a1.analysis.emotions.join(", "));

  const cids = j.picks.map((p) => p.isbn13);
  const dupe = cids.length !== new Set(cids).size;
  console.log(`picks: ${j.picks.length}권 | 중복:`, dupe ? "있음 (BUG)" : "없음 (OK)");
  j.picks.forEach((b, i) => {
    console.log(`  ${i + 1}. ${b.title} | 별점:${b.rating ?? "-"} 순위:${b.bestSellerRank || "-"}`);
  });
  return { hits, dupe, picksLen: j.picks.length };
}

let allHits = [], anyDupe = false, anyShort = false;
for (const scene of scenes) {
  const res = await run(scene);
  if (res) {
    allHits.push(...res.hits);
    if (res.dupe) anyDupe = true;
    if (res.picksLen < 3) anyShort = true;
  }
}
console.log("\n\n=== 종합 결과 ===");
console.log("전체 금지어 검출:", allHits.length ? allHits : "없음 (모두 통과)");
console.log("중복 픽 발생:", anyDupe ? "있음 (BUG)" : "없음 (통과)");
console.log("3권 미만 발생:", anyShort ? "있음 (확인 필요)" : "없음 (통과)");
