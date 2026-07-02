// 공유 로직 — 로컬 Express 서버(server/index.mjs)와 Vercel 서버리스 함수(api/*.mjs)가
// 동일한 코드를 재사용한다. 여기엔 라우팅/HTTP 프레임워크 코드가 없어야 한다.
import { readFileSync, existsSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

// ---- .env 로드 (로컬 개발용. Vercel/Render 등에선 플랫폼이 이미 process.env를 채워주므로
//      파일이 없으면 조용히 넘어간다) ----
const __dirname = dirname(fileURLToPath(import.meta.url));
const envPath = join(__dirname, "..", ".env");
if (existsSync(envPath)) {
  for (const line of readFileSync(envPath, "utf-8").split(/\r?\n/)) {
    const m = line.match(/^\s*([A-Z_][A-Z0-9_]*)\s*=\s*(.*)\s*$/);
    if (m && !process.env[m[1]]) process.env[m[1]] = m[2].replace(/^["']|["']$/g, "");
  }
}

export const ANTHROPIC_KEY = process.env.ANTHROPIC_API_KEY || "";
export const TTB_KEY = process.env.ALADIN_TTB_KEY || "";
export const MODEL = process.env.CLAUDE_MODEL || "claude-opus-4-8";

export const ALLOWED_MEDIA = new Set(["image/jpeg", "image/png", "image/webp", "image/gif"]);
export const MAX_IMAGE_BYTES = 8 * 1024 * 1024;
export const MAX_NOTE_LEN = 300;
const ALADIN_TIMEOUT_MS = 8000;

async function fetchWithTimeout(url, ms = ALADIN_TIMEOUT_MS) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), ms);
  try {
    return await fetch(url, { signal: controller.signal });
  } finally {
    clearTimeout(timer);
  }
}

// ---------- 1단계: 그림 분석 (Claude 비전) ----------
const ANALYSIS_SCHEMA = {
  type: "object",
  properties: {
    observations: { type: "string", description: "그림에서 눈에 보이는 것을 구체적으로 관찰한 내용 2~3문장 (소재·색·구도·표정·크기·위치). 한국어" },
    mood_reading: { type: "string", description: "그림의 색감·구도·소재에서 느껴지는 정서를 따뜻하게 풀어 읽은 3~4문장. 예: '따뜻한 노란색을 넓게 쓴 걸 보니 지금 마음이 밝고 안정돼 보여요.' 단정적 진단('~장애', '~성향이 있다')은 절대 쓰지 말고, '느껴져요/보여요/~인 것 같아요'처럼 부드럽게. 한국어" },
    emotions: { type: "array", items: { type: "string" }, description: "그림에서 읽히는 감정 키워드 2~4개" },
    interests: { type: "array", items: { type: "string" }, description: "관심사/좋아하는 것 키워드 2~4개" },
    themes: { type: "array", items: { type: "string" }, description: "책 주제로 이어질 테마 2~4개" },
    talking_points: { type: "array", items: { type: "string" }, description: "그림을 보고 아이와 나눠볼 만한 다정한 질문·대화거리 2~3개" },
    age_guess: { type: "string", description: "그림 수준으로 추정한 연령대 (참고용)" },
    search_keywords: { type: "array", items: { type: "string" }, description: "도서 검색용 한국어 키워드 3~6개 (짧은 명사구)" },
    parent_message: { type: "string", description: "보호자에게 전하는 따뜻한 한줄 코멘트" }
  },
  required: ["observations", "mood_reading", "emotions", "interests", "themes", "talking_points", "age_guess", "search_keywords", "parent_message"],
  additionalProperties: false
};

export async function analyzeDrawing(client, imageBase64, mediaType, age, note) {
  const userText = [
    "아이(또는 사용자)가 그린 그림입니다. 그림을 애정 어린 눈으로 자세히 들여다보고, 담긴 마음·관심사·이야기 테마를 따뜻하게 읽어주세요.",
    age ? `그린 사람의 나이대: ${age}` : "",
    note ? `보호자 메모: ${note}` : "",
    "",
    "[해석 방식]",
    "- 색의 밝기·따뜻함, 구도(가운데/구석/크게/작게), 소재의 선택, 인물의 표정·거리, 여백의 양 등 그림에 실제로 보이는 구체적 단서를 근거로 정서를 읽어주세요.",
    "- mood_reading은 그 단서들을 근거로 '지금 어떤 마음이 느껴지는지'를 3~4문장으로 다정하게 풀어주세요. 매번 다른 그림이니 뻔한 문장을 복사한 듯 쓰지 말고, 그 그림만의 구체적인 디테일(무엇을 크게 그렸는지, 어떤 색을 많이 썼는지, 누구와 무엇이 함께 있는지)을 콕 집어 언급하세요.",
    "- 절대 쓰지 말 것: '~장애', '~증', '~성향이 있다', '~문제가 있다', '불안정하다', '위축되어 있다' 같은 진단·병리적 단정 표현. 이것은 임상 심리검사가 아닙니다.",
    "- 절대 쓰지 말 것: '빨간색은 분노/화를 의미한다', '검은색을 많이 쓰면 우울하다' 같은 근거 없는 색채-감정 공식. 색은 그저 그 순간 좋아하는 색이거나 그림 소재상 자연스러운 선택일 수 있습니다. 색만으로 감정을 단정하지 말고, 전체 구도와 소재를 함께 보고 조심스럽게 짐작하는 톤을 유지하세요.",
    "- 항상 '~인 것 같아요 / ~게 느껴져요 / ~해 보여요'처럼 열린 표현을 쓰고, 여러 해석이 가능함을 은연중에 인정하세요.",
    "- 부정적으로 단정 짓기보다, 그림에 담긴 마음을 존중하고 다음 대화로 이어질 실마리를 주세요.",
    "",
    "search_keywords는 온라인 서점에서 실제로 검색했을 때 결과가 나올 만한 짧고 보편적인 한국어 키워드로 만들어 주세요 (예: '공룡 그림책', '우정 동화', '용기')."
  ].filter(Boolean).join("\n");

  const res = await client.messages.create({
    model: MODEL,
    max_tokens: 1200,
    thinking: { type: "disabled" },
    output_config: { effort: "low", format: { type: "json_schema", schema: ANALYSIS_SCHEMA } },
    messages: [{
      role: "user",
      content: [
        { type: "image", source: { type: "base64", media_type: mediaType, data: imageBase64 } },
        { type: "text", text: userText }
      ]
    }]
  });
  if (res.stop_reason === "refusal") throw new Error("이미지 분석이 거절되었습니다. 다른 그림으로 시도해 주세요.");
  const text = res.content.find((b) => b.type === "text")?.text;
  return JSON.parse(text);
}

// ---------- 2단계: 알라딘 도서 검색 ----------
async function searchAladin(keyword) {
  const url = new URL("https://www.aladin.co.kr/ttb/api/ItemSearch.aspx");
  url.searchParams.set("ttbkey", TTB_KEY);
  url.searchParams.set("Query", keyword);
  url.searchParams.set("QueryType", "Keyword");
  url.searchParams.set("SearchTarget", "Book");
  url.searchParams.set("MaxResults", "6");
  url.searchParams.set("start", "1");
  url.searchParams.set("Sort", "SalesPoint");
  url.searchParams.set("Cover", "Big");
  url.searchParams.set("output", "js");
  url.searchParams.set("Version", "20131101");

  let r;
  try {
    r = await fetchWithTimeout(url);
  } catch {
    return []; // 타임아웃/네트워크 오류 시 이 키워드는 조용히 건너뜀
  }
  if (!r.ok) return [];
  const data = await r.json().catch(() => null);
  if (!data?.item) return [];
  const decode = (s) => (s || "").replace(/&amp;/g, "&").replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&quot;/g, '"');
  return data.item.map((it) => ({
    isbn13: it.isbn13 || it.isbn || "",
    title: decode(it.title),
    author: decode(it.author),
    publisher: decode(it.publisher),
    pubDate: it.pubDate || "",
    cover: it.cover || "",
    link: decode(it.link),
    category: it.categoryName || "",
    description: decode(it.description).slice(0, 320)
  })).filter((b) => b.isbn13 && b.title);
}

export async function collectCandidates(keywords) {
  const results = await Promise.all(keywords.slice(0, 4).map((k) => searchAladin(k).catch(() => [])));
  const seen = new Set();
  const out = [];
  for (const list of results) {
    for (const b of list) {
      if (seen.has(b.isbn13)) continue;
      seen.add(b.isbn13);
      out.push({ cid: `c${out.length + 1}`, ...b });
    }
  }
  return out.slice(0, 18);
}

// ---------- 상세 조회로 별점·페이지 등 보강 ----------
// 참고: fulldescription/Toc/story는 이 API 등급에서 항상 빈 값으로 확인되어 요청하지 않음.
// 실제로 채워지는 필드만 요청: ratingInfo(별점), itemPage(페이지), bestSellerRank(순위), subTitle(부제)
async function lookupDetail(isbn13) {
  const url = new URL("https://www.aladin.co.kr/ttb/api/ItemLookUp.aspx");
  url.searchParams.set("ttbkey", TTB_KEY);
  url.searchParams.set("itemIdType", "ISBN13");
  url.searchParams.set("ItemId", isbn13);
  url.searchParams.set("output", "js");
  url.searchParams.set("Version", "20131101");
  url.searchParams.set("OptResult", "ratingInfo,subTitle,bestSellerRank");
  let r;
  try {
    r = await fetchWithTimeout(url);
  } catch {
    return {};
  }
  if (!r.ok) return {};
  const data = await r.json().catch(() => null);
  const it = data?.item?.[0];
  if (!it) return {};
  const sub = it.subInfo || {};
  return {
    rating: sub.ratingInfo?.ratingScore ?? it.customerReviewRank ?? null,
    ratingCount: sub.ratingInfo?.ratingCount ?? null,
    page: sub.itemPage ?? null,
    priceStandard: it.priceStandard ?? null,
    subTitle: sub.subTitle || "",
    bestSellerRank: sub.bestSellerRank || "",
  };
}

export async function enrichPicks(picks) {
  return Promise.all(
    picks.map(async (b) => {
      try {
        const d = await lookupDetail(b.isbn13);
        return { ...b, ...d };
      } catch {
        return b;
      }
    })
  );
}

// ---------- 3단계: 후보 중 3권 선별 ----------
const PICK_SCHEMA = {
  type: "object",
  properties: {
    picks: {
      type: "array",
      items: {
        type: "object",
        properties: {
          cid: { type: "string", description: "후보 목록의 cid (예: c3)" },
          one_liner: { type: "string", description: "이 책을 소개하는 한 줄, 한국어" },
          reason: { type: "string", description: "그림 분석과 연결해 왜 이 책인지 2~3문장, 한국어" }
        },
        required: ["cid", "one_liner", "reason"],
        additionalProperties: false
      }
    },
    overall_comment: { type: "string", description: "전체 추천에 대한 따뜻한 마무리 코멘트 1~2문장" }
  },
  required: ["picks", "overall_comment"],
  additionalProperties: false
};

export async function pickBooks(client, analysis, candidates, age) {
  const res = await client.messages.create({
    model: MODEL,
    max_tokens: 1200,
    thinking: { type: "disabled" },
    output_config: { effort: "low", format: { type: "json_schema", schema: PICK_SCHEMA } },
    messages: [{
      role: "user",
      content: [
        {
          type: "text",
          text: [
            "그림 분석 결과와 도서 후보 목록입니다. 그림을 그린 사람에게 가장 잘 맞는 책 3권을 골라 주세요.",
            age ? `나이대: ${age} — 연령에 맞는 책을 우선하세요.` : "",
            "각 책의 판단 근거는 제목(title), 분류(category), 그리고 책 소개(description)입니다. 특히 책 소개 내용이 그림에서 읽힌 감정·관심사·테마와 실제로 맞닿는지 꼼꼼히 대조해 고르세요. 제목만 보고 넘겨짚지 마세요.",
            "가능하면 서로 다른 결(주제/정서)의 책 3권을 고르고, 각 책마다 그림 분석 내용과 책 소개를 함께 근거로 삼아 '왜 이 아이에게 이 책인지'를 구체적으로 2~3문장 써주세요.",
            "고른 책은 반드시 후보 목록에 있는 cid 값으로 지정하세요 (예: c3). 다른 값을 지어내지 마세요.",
            `\n[그림 분석]\n${JSON.stringify(analysis, null, 2)}`,
            `\n[도서 후보]\n${JSON.stringify(candidates.map(({ cid, title, author, category, description }) => ({ cid, title, author, category, description })), null, 2)}`
          ].filter(Boolean).join("\n")
        }
      ]
    }]
  });
  if (res.stop_reason === "refusal") throw new Error("도서 선별이 거절되었습니다.");
  const text = res.content.find((b) => b.type === "text")?.text;
  return JSON.parse(text);
}

// ---------- 목업 (키 없이 데모) ----------
export function mockResult() {
  return {
    mock: true,
    analysis: {
      observations: "밝은 태양 아래 공룡과 아이가 손을 잡고 있는 그림이에요. 공룡을 화면 가운데 크게, 아이를 그 옆에 나란히 그렸고 전체적으로 따뜻한 색을 많이 썼습니다.",
      mood_reading: "큰 공룡을 무섭게가 아니라 손잡을 친구로 그린 걸 보면, 지금 마음이 밝고 씩씩해 보여요. 노란 해와 넓은 초록을 시원하게 쓴 것도 편안하고 즐거운 기분이 담긴 것처럼 느껴집니다. 큰 존재와 '함께'하고 싶은 마음이 특히 다정하게 드러나요.",
      emotions: ["호기심", "즐거움", "함께하고 싶은 마음"],
      interests: ["공룡", "자연", "모험"],
      themes: ["우정", "탐험", "용기"],
      talking_points: ["공룡이랑 손잡고 어디에 가보고 싶어?", "이 공룡은 어떤 성격일 것 같아?"],
      age_guess: "6~8세 (참고용)",
      search_keywords: ["공룡 그림책", "우정 동화", "모험 그림책"],
      parent_message: "아이의 그림에는 큰 세계를 향한 호기심과 누군가와 함께하고 싶은 따뜻한 마음이 담겨 있어요."
    },
    picks: [
      { isbn13: "9788943308070", title: "고 녀석 맛있겠다", author: "미야니시 타츠야", publisher: "달리", cover: "", link: "https://www.aladin.co.kr", rating: 10, ratingCount: 42, page: 40, priceStandard: 12000, one_liner: "무서운 공룡도 사랑을 배워요.", reason: "공룡을 좋아하면서도 '함께'를 그린 아이에게, 티라노사우루스가 아기 공룡을 키우며 사랑을 배우는 이 책이 깊게 닿을 거예요." },
      { isbn13: "9791158360733", title: "알사탕", author: "백희나", publisher: "책읽는곰", cover: "", link: "https://www.aladin.co.kr", rating: 9, ratingCount: 88, page: 56, priceStandard: 13000, one_liner: "마음의 소리가 들리는 신기한 사탕.", reason: "친구와 손잡고 싶은 마음이 보이는 그림이에요. 마음의 소리를 듣게 되는 이 이야기가 친구 사귀는 용기를 줄 거예요." },
      { isbn13: "9788901229874", title: "여행 그림책", author: "안노 미쓰마사", publisher: "비룡소", cover: "", link: "https://www.aladin.co.kr", rating: 10, ratingCount: 15, page: 48, priceStandard: 15000, one_liner: "글 없이 떠나는 상상 여행.", reason: "넓은 풍경을 그린 아이의 탐험심에 맞춰, 페이지마다 새로운 세계를 발견하는 상상 여행을 선물해 보세요." }
    ],
    overall_comment: "그림 속 호기심이 책으로 이어지면, 아이의 세계는 한 뼘 더 자랍니다. (데모 모드 — API 키를 설정하면 실제 분석·검색 결과가 나옵니다)"
  };
}

// 후보 매칭 + 부족분 보충을 한 번에 처리 (Express 라우트와 Vercel 함수가 동일하게 사용)
export function resolvePicks(pickedPicks, candidates) {
  const byCid = new Map(candidates.map((c) => [c.cid, c]));
  const byIsbn = new Map(candidates.map((c) => [c.isbn13, c]));
  const usedCid = new Set();
  const picks = [];
  for (const p of pickedPicks || []) {
    const book = byCid.get(p.cid) || byIsbn.get(p.cid); // cid 우선, 혹시 isbn을 넣었으면 그것도 허용
    if (!book || usedCid.has(book.cid)) continue; // 중복 cid 방지
    usedCid.add(book.cid);
    picks.push({ ...book, one_liner: p.one_liner, reason: p.reason });
    if (picks.length === 3) break;
  }
  // Claude가 잘못된/중복된 cid를 줘서 3권이 안 채워졌을 경우, 판매지수 상위 후보로 채움
  if (picks.length < 3) {
    for (const c of candidates) {
      if (picks.length === 3) break;
      if (usedCid.has(c.cid)) continue;
      usedCid.add(c.cid);
      picks.push({ ...c, one_liner: c.title, reason: "그림에서 읽힌 관심사와 연결되는 인기 도서예요." });
    }
  }
  return picks;
}
