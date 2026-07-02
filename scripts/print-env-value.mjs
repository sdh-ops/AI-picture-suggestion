// .env에서 특정 키의 값만 stdout으로 출력 (배포 스크립트가 파이프로 전달받기 위함).
// 이 파일 자체엔 비밀값이 들어있지 않다.
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const key = process.argv[2];
if (!key) { console.error("usage: node print-env-value.mjs KEY"); process.exit(1); }

const __dirname = dirname(fileURLToPath(import.meta.url));
const envPath = join(__dirname, "..", ".env");
const text = readFileSync(envPath, "utf-8");
for (const line of text.split(/\r?\n/)) {
  const m = line.match(/^\s*([A-Z_][A-Z0-9_]*)\s*=\s*(.*)\s*$/);
  if (m && m[1] === key) {
    process.stdout.write(m[2].replace(/^["']|["']$/g, ""));
    process.exit(0);
  }
}
process.exit(1);
