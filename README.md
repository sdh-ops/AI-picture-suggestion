# 마음책방 (Maum Chaekbang)

그림 한 장에 담긴 마음을 읽어, 딱 맞는 책을 찾아주는 AI 도서 추천 웹앱.

아이(또는 누구든)가 그린 그림을 업로드하면 → **Claude 비전**이 그림 속 감정·관심사·이야기 테마를 읽고 → **알라딘 도서 API**에서 전체 도서를 검색해 → 지금 이 마음에 가장 잘 맞는 **3권**을 이유와 함께 골라줍니다.

> "심리분석"이라는 임상적 표현 대신 "그림으로 읽는 마음·관심사 기반 추천"으로 포지셔닝했습니다. 특정 출판사와 무관하게 알라딘 전체 도서 풀에서 추천합니다.

## 구조

```
maum-chaekbang/
├── server/
│   ├── lib.mjs           # 공유 로직 (분석·검색·선별·목업) — Express·Vercel 함수가 함께 사용
│   └── index.mjs         # 로컬 개발용 Express 서버 (lib.mjs를 라우팅에 연결)
├── api/                  # Vercel 서버리스 함수 (프로덕션 배포용, lib.mjs 재사용)
│   ├── analyze.mjs       # POST /api/analyze — 그림 분석
│   ├── pick.mjs          # POST /api/pick — 도서 검색 + 선별
│   ├── health.mjs        # GET  /api/health
│   └── _util.mjs         # 요청 바디 파싱 등 공통 유틸
├── src/
│   ├── App.tsx           # 업로드 → 분석 즉시 표시 → 도서 선별 (2단계 로딩)
│   ├── main.tsx
│   └── styles.css        # "스토리북 아틀리에" 디자인 (종이 질감·크레용 악센트)
├── index.html
├── vercel.json           # Vercel 빌드 설정
└── .env                  # 로컬 개발용 API 키 (.env.example 참고)
```

파이프라인은 **2단계 API**로 나뉘어 있습니다(체감 대기시간을 줄이기 위해 — 분석 결과가 먼저 뜨고 책 목록이 이어서 로딩됨):
1. **`/api/analyze`** — 이미지를 Claude에 보내 감정·관심사·테마·검색키워드를 구조화 JSON으로 추출 (~11~14초)
2. **`/api/pick`** — 검색 키워드로 알라딘 `ItemSearch` 병렬 호출 → 후보 최대 18권 → Claude가 3권 선별 → 별점·페이지·정가로 보강 (~11~16초)

로컬 개발(`server/index.mjs`)과 프로덕션 배포(`api/*.mjs`)는 **`server/lib.mjs`의 동일한 함수**를 호출하므로 로직이 두 곳에 중복되지 않습니다.

## 실행

```bash
npm install
cp .env.example .env   # 키 입력 (없으면 데모 모드로 동작)
npm run dev            # API(5210) + Vite(5211) 동시 실행
```

브라우저에서 http://localhost:5211 접속.

### 키 발급
- **ANTHROPIC_API_KEY** — https://console.anthropic.com
- **ALADIN_TTB_KEY** — https://www.aladin.co.kr/ttb/wblog_manage.aspx (블로거/제휴 API)

키가 없으면 **데모 모드**로 샘플 결과를 보여주므로, 디자인·플로우는 키 없이도 확인할 수 있습니다.

## 모델

`CLAUDE_MODEL=claude-sonnet-5` (기본값). 더 깊은 분석이 필요하면 `claude-opus-4-8`로 바꿀 수 있습니다.

## Vercel 배포

이 앱은 프론트(정적 빌드)와 백엔드(서버리스 함수)를 **한 번에** Vercel에 배포합니다. 폴더를 그냥 드래그해서 올리는 방식(정적 호스팅)은 안 됩니다 — `api/` 폴더가 Vercel의 서버리스 함수로 자동 인식되어야 Claude·알라딘 호출이 동작합니다.

### 배포 방법

1. **GitHub에 푸시** (Vercel은 Git 연동 배포가 기본):
   ```bash
   git init && git add . && git commit -m "init"
   git remote add origin <내 저장소 URL>
   git push -u origin main
   ```
2. [vercel.com](https://vercel.com) → **Add New Project** → 방금 만든 저장소 선택 → Import.
   - Framework Preset: Vite (자동 감지됨)
   - Build Command / Output Directory: `vercel.json`에 이미 지정되어 있어 그대로 두면 됨
3. **Environment Variables**에 아래 3개를 추가 (Production/Preview 둘 다 체크):
   - `ANTHROPIC_API_KEY`
   - `ALADIN_TTB_KEY`
   - `CLAUDE_MODEL` (예: `claude-sonnet-5`)
4. **Deploy** 클릭. 몇 분 뒤 `https://<프로젝트명>.vercel.app`로 접속하면 끝 — 프론트와 API가 같은 도메인이라 CORS 설정도 필요 없습니다.

### 함수 실행 시간

`api/analyze.mjs`, `api/pick.mjs`에 `export const config = { maxDuration: 30 }`를 설정해 뒀습니다. 우리 API는 보통 11~16초가 걸리므로, Vercel의 기본 함수 제한(플랜에 따라 다름) 안에서 여유 있게 동작합니다.

### CLI로 배포하고 싶다면

```bash
npm i -g vercel
vercel        # 첫 배포 (질문에 답하면서 진행)
vercel --prod # 프로덕션 배포
vercel env add ANTHROPIC_API_KEY
vercel env add ALADIN_TTB_KEY
vercel env add CLAUDE_MODEL
```

## 개인정보

업로드된 그림은 분석에만 쓰이고 서버에 저장하지 않습니다(요청 처리 후 폐기). 아동 대상 서비스이므로 실서비스 배포 시 개인정보처리방침·보호자 동의 절차를 추가하세요.
