import { useState, useRef, useEffect } from "react";

type Analysis = {
  observations: string;
  mood_reading: string;
  emotions: string[];
  interests: string[];
  themes: string[];
  talking_points: string[];
  age_guess: string;
  parent_message: string;
};

type Book = {
  isbn13: string;
  title: string;
  author: string;
  publisher: string;
  cover: string;
  link: string;
  one_liner: string;
  reason: string;
  rating?: number | null;
  ratingCount?: number | null;
  page?: number | null;
  priceStandard?: number | null;
  subTitle?: string;
  bestSellerRank?: string;
};

const AGES = ["미취학", "초등 저학년", "초등 고학년", "청소년", "어른"];

const ANALYZE_STEPS = ["그림을 찬찬히 들여다보는 중…", "그림에 담긴 마음을 읽는 중…"];
const PICK_STEPS = ["서가에서 어울리는 책을 고르는 중…", "추천 이유를 정리하는 중…"];

type Stage = "idle" | "analyzing" | "picking" | "done";

export default function App() {
  const [image, setImage] = useState<{ base64: string; mediaType: string; url: string } | null>(null);
  const [age, setAge] = useState<string>("");
  const [note, setNote] = useState("");
  const [drag, setDrag] = useState(false);
  const [stage, setStage] = useState<Stage>("idle");
  const [stepIdx, setStepIdx] = useState(0);
  const [error, setError] = useState("");
  const [analysis, setAnalysis] = useState<Analysis | null>(null);
  const [picks, setPicks] = useState<Book[] | null>(null);
  const [overallComment, setOverallComment] = useState("");
  const [isMock, setIsMock] = useState(false);
  const fileRef = useRef<HTMLInputElement>(null);
  const resultRef = useRef<HTMLDivElement>(null);

  const loading = stage === "analyzing" || stage === "picking";
  const steps = stage === "analyzing" ? ANALYZE_STEPS : PICK_STEPS;

  useEffect(() => {
    if (!loading) return;
    setStepIdx(0);
    const id = setInterval(() => setStepIdx((i) => (i + 1) % steps.length), 2600);
    return () => clearInterval(id);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [stage]);

  useEffect(() => {
    if (analysis && resultRef.current) resultRef.current.scrollIntoView({ behavior: "smooth" });
  }, [analysis]);

  // 휴대폰 사진(수 MB, 때로 HEIC)을 서버에 보내기 전에 JPEG로 줄여서 변환.
  // 업로드 속도·분석 속도가 빨라지고, 형식도 서버가 항상 지원하는 JPEG로 통일됨.
  function normalizeImage(file: File): Promise<{ dataUrl: string; mediaType: string }> {
    return new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onerror = () => reject(new Error("파일을 읽을 수 없어요."));
      reader.onload = () => {
        const img = new Image();
        img.onerror = () => reject(new Error("이 브라우저에서 열 수 없는 사진 형식이에요. 사진 앱에서 '가장 호환되는 형식(JPEG)'으로 저장한 뒤 다시 시도해 주세요."));
        img.onload = () => {
          const MAX_DIM = 1600;
          let { width, height } = img;
          if (width > MAX_DIM || height > MAX_DIM) {
            if (width > height) { height = Math.round((height * MAX_DIM) / width); width = MAX_DIM; }
            else { width = Math.round((width * MAX_DIM) / height); height = MAX_DIM; }
          }
          const canvas = document.createElement("canvas");
          canvas.width = width;
          canvas.height = height;
          const ctx = canvas.getContext("2d");
          if (!ctx) { reject(new Error("이미지를 처리할 수 없어요.")); return; }
          ctx.drawImage(img, 0, 0, width, height);
          resolve({ dataUrl: canvas.toDataURL("image/jpeg", 0.85), mediaType: "image/jpeg" });
        };
        img.src = reader.result as string;
      };
      reader.readAsDataURL(file);
    });
  }

  async function handleFile(file: File) {
    setError("");
    if (!file.type.startsWith("image/")) {
      setError("이미지 파일만 올릴 수 있어요 (jpg, png, webp, gif, heic).");
      return;
    }
    if (file.size > 20 * 1024 * 1024) {
      setError("이미지가 너무 커요. 20MB 이하로 올려주세요.");
      return;
    }
    try {
      const { dataUrl, mediaType } = await normalizeImage(file);
      const base64 = dataUrl.split(",")[1];
      setImage({ base64, mediaType, url: dataUrl });
    } catch (e) {
      setError(e instanceof Error ? e.message : "이미지를 처리하지 못했어요.");
    }
  }

  async function submit() {
    if (!image) return;
    setError("");
    setAnalysis(null);
    setPicks(null);
    setOverallComment("");
    setIsMock(false);
    setStage("analyzing");
    try {
      const res1 = await fetch("/api/analyze", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ imageBase64: image.base64, mediaType: image.mediaType, age, note }),
      });
      const data1 = await res1.json();
      if (!res1.ok) throw new Error(data1.error || "그림을 분석하지 못했어요.");
      setAnalysis(data1.analysis);
      if (data1.mock) setIsMock(true);

      setStage("picking");
      const res2 = await fetch("/api/pick", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ analysis: data1.analysis, age }),
      });
      const data2 = await res2.json();
      if (!res2.ok) throw new Error(data2.error || "책을 고르지 못했어요.");
      setPicks(data2.picks || []);
      setOverallComment(data2.overall_comment || "");
      if (data2.mock) setIsMock(true);
      setStage("done");
    } catch (e) {
      setError(e instanceof Error ? e.message : "알 수 없는 오류가 발생했어요.");
      setStage(analysis ? "done" : "idle");
    }
  }

  function reset() {
    setImage(null);
    setAnalysis(null);
    setPicks(null);
    setOverallComment("");
    setIsMock(false);
    setError("");
    setStage("idle");
    setAge("");
    setNote("");
  }

  return (
    <>
      <div className="wrap">
        <header className="masthead">
          <div className="brand">
            <span className="dot" />
            마음책방
          </div>
          <span className="tagsmall">그림으로 읽는 마음 · 책으로 잇는 이야기</span>
        </header>
      </div>

      <div className="wrap">
        <section className="hero">
          <div className="hero-text">
            <svg className="doodle heart" width="34" height="34" viewBox="0 0 40 40" fill="none" aria-hidden>
              <path d="M20 34S5 25 5 14a8 8 0 0115-4 8 8 0 0115 4c0 11-15 20-15 20z" stroke="#e0674f" strokeWidth="2.5" strokeLinejoin="round" />
            </svg>
            <div className="eyebrow">심리 그림 · AI 도서 큐레이션</div>
            <h1>
              <span className="line">
                그림 한 장에 담긴 <span className="mark">마음</span>을 읽어
              </span>
              <span className="line">딱 맞는 책을 찾아드립니다</span>
            </h1>
            <p className="lede">
              아이가 그린 그림을 올려주세요. 그림 속 감정과 관심사를 읽어, 온 서점의 책 가운데 지금 이 마음에 가장
              잘 맞는 세 권을 골라드립니다.
            </p>
          </div>

          <div className="hero-art" aria-hidden>
            <svg viewBox="0 0 320 300" fill="none" xmlns="http://www.w3.org/2000/svg">
              <ellipse cx="170" cy="255" rx="120" ry="18" fill="#2e2a24" opacity="0.06" />
              <g transform="rotate(-6 150 150)">
                <rect x="60" y="70" width="180" height="150" rx="10" fill="#fbf7ef" stroke="#2e2a24" strokeWidth="3" />
                <line x1="150" y1="70" x2="150" y2="220" stroke="#d9ccb4" strokeWidth="2" />
                <path d="M78 100q30-16 58 0v96q-28-14-58 0z" fill="#6a9bb0" opacity="0.35" />
                <path d="M164 100q30-16 58 0v96q-28-14-58 0z" fill="#e0674f" opacity="0.3" />
                <circle cx="107" cy="132" r="8" fill="#e8b23a" />
                <path d="M186 140l10 16h-20z" fill="#7c9464" />
              </g>
              <g transform="translate(214 40)">
                <circle cx="24" cy="24" r="22" fill="#e8b23a" />
                <path d="M24 2v-9M24 46v9M2 24h-9M46 24h9M9 9l-6-6M39 9l6-6M9 39l-6 6M39 39l6 6" stroke="#e8b23a" strokeWidth="3" strokeLinecap="round" />
                <path d="M15 27q9 9 18 0" stroke="#2e2a24" strokeWidth="2.5" strokeLinecap="round" fill="none" />
                <circle cx="17" cy="19" r="2.4" fill="#2e2a24" />
                <circle cx="31" cy="19" r="2.4" fill="#2e2a24" />
              </g>
              <path d="M40 70q14-20 34-8" stroke="#6a9bb0" strokeWidth="2.5" strokeLinecap="round" fill="none" />
              <path d="M262 210q-16 18-6 34" stroke="#e0674f" strokeWidth="2.5" strokeLinecap="round" fill="none" />
              <path d="M50 210l6 6-6 6-6-6z" fill="#7c9464" />
            </svg>
          </div>
        </section>

        {stage === "idle" && (
          <section className="studio">
            <div className="studio-grid">
              {!image ? (
                <div
                  className={`dropzone ${drag ? "drag" : ""}`}
                  onClick={() => fileRef.current?.click()}
                  onDragOver={(e) => { e.preventDefault(); setDrag(true); }}
                  onDragLeave={() => setDrag(false)}
                  onDrop={(e) => { e.preventDefault(); setDrag(false); if (e.dataTransfer.files[0]) handleFile(e.dataTransfer.files[0]); }}
                >
                  <div className="plus">+</div>
                  <div className="dz-title">그림을 올려주세요</div>
                  <div className="dz-sub">눌러서 카메라로 찍거나 앨범에서 사진을 선택하세요. 크레용, 색연필, 낙서 무엇이든 좋아요.</div>
                  <input
                    ref={fileRef}
                    type="file"
                    accept="image/*"
                    hidden
                    onChange={(e) => e.target.files?.[0] && handleFile(e.target.files[0])}
                  />
                </div>
              ) : (
                <div className="preview-shell">
                  <img src={image.url} alt="업로드한 그림" />
                  <button className="reset" onClick={reset}>다시 올리기</button>
                </div>
              )}

              <div className="controls">
                <div className="field">
                  <label>누가 그렸나요? <span style={{ fontWeight: 400, textTransform: "none" }}>(선택)</span></label>
                  <div className="chips">
                    {AGES.map((a) => (
                      <button key={a} className={`chip ${age === a ? "on" : ""}`} onClick={() => setAge(age === a ? "" : a)}>
                        {a}
                      </button>
                    ))}
                  </div>
                </div>
                <div className="field">
                  <label>덧붙일 이야기 <span style={{ fontWeight: 400, textTransform: "none" }}>(선택)</span></label>
                  <textarea
                    rows={3}
                    maxLength={300}
                    placeholder="예: 요즘 공룡에 푹 빠져 있어요 / 동생이 생겨 마음이 복잡한 것 같아요"
                    value={note}
                    onChange={(e) => setNote(e.target.value)}
                  />
                </div>
                <button className="go" onClick={submit} disabled={!image}>
                  마음 읽고 책 찾기 <span className="arrow">→</span>
                </button>
                {error && <div className="err">{error}</div>}
                <p style={{ fontSize: "0.78rem", color: "var(--ink-soft)", lineHeight: 1.6 }}>
                  🔒 올려주신 그림은 분석에만 사용하고 저장하지 않습니다.
                </p>
              </div>
            </div>
          </section>
        )}

        {stage === "analyzing" && (
          <section className="studio">
            <div className="loading">
              <div className="orb" />
              <p>그림을 읽고 있어요</p>
              <div className="step">{ANALYZE_STEPS[stepIdx]}</div>
            </div>
          </section>
        )}
      </div>

      {analysis && (
        <div className="wrap">
          <section className="results" ref={resultRef}>
            <div className="reading">
              <div className="badge">그림이 들려준 이야기</div>
              <h2>{analysis.parent_message}</h2>
              <p className="obs">{analysis.observations}</p>
              {analysis.mood_reading && (
                <p className="mood">{analysis.mood_reading}</p>
              )}
              <div className="tag-rows">
                <div className="tag-group emo">
                  <div className="tg-label">느껴진 감정</div>
                  <div className="tg-items">{analysis.emotions.map((t) => <span key={t}>{t}</span>)}</div>
                </div>
                <div className="tag-group int">
                  <div className="tg-label">관심사</div>
                  <div className="tg-items">{analysis.interests.map((t) => <span key={t}>{t}</span>)}</div>
                </div>
                <div className="tag-group the">
                  <div className="tg-label">이야기 테마</div>
                  <div className="tg-items">{analysis.themes.map((t) => <span key={t}>{t}</span>)}</div>
                </div>
              </div>
              {analysis.talking_points?.length > 0 && (
                <div className="talk">
                  <div className="talk-label">이 그림으로 나눠볼 이야기</div>
                  <ul>
                    {analysis.talking_points.map((q, i) => <li key={i}>{q}</li>)}
                  </ul>
                </div>
              )}
            </div>

            {stage === "picking" && (
              <div className="loading picking">
                <div className="orb small" />
                <p>{PICK_STEPS[stepIdx]}</p>
              </div>
            )}

            {error && stage !== "picking" && <div className="err">{error}</div>}

            {picks && picks.length > 0 && (
              <>
                <div className="section-head">
                  <h3>이 마음에 어울리는 세 권</h3>
                  <div className="rule" />
                </div>
                <div className="books">
                  {picks.map((b) => (
                    <article className="book" key={b.isbn13}>
                      <div className="cover-wrap">
                        {b.cover ? <img src={b.cover} alt={b.title} /> : <div className="noimg">{b.title}</div>}
                      </div>
                      <div className="body">
                        <div className="oneliner">{b.one_liner}</div>
                        <div className="meta">{b.title} · {b.author} · {b.publisher}</div>
                        {b.bestSellerRank && <div className="rank">🏆 {b.bestSellerRank}</div>}
                        {(b.rating != null || b.page != null || b.priceStandard != null) && (
                          <div className="stats">
                            {b.rating != null && b.rating > 0 && (
                              <span className="stat">★ {b.rating}<em>/10</em>{b.ratingCount ? ` (${b.ratingCount})` : ""}</span>
                            )}
                            {b.page != null && b.page > 0 && <span className="stat">{b.page}쪽</span>}
                            {b.priceStandard != null && b.priceStandard > 0 && (
                              <span className="stat">{b.priceStandard.toLocaleString()}원</span>
                            )}
                          </div>
                        )}
                        <div className="reason">{b.reason}</div>
                        {b.link && (
                          <a className="buy" href={b.link} target="_blank" rel="noreferrer">
                            알라딘에서 구매하기 →
                          </a>
                        )}
                      </div>
                    </article>
                  ))}
                </div>
              </>
            )}

            {stage === "done" && overallComment && <p className="closing">{overallComment}</p>}
            {isMock && <p className="mock-note">데모 모드입니다. API 키를 설정하면 실제 분석과 검색 결과가 나옵니다.</p>}
            {stage === "done" && <button className="again" onClick={reset}>다른 그림으로 다시 해보기</button>}
          </section>
        </div>
      )}

      <div className="wrap">
        <footer>
          <span>마음책방 · 그림으로 읽는 도서 추천</span>
          <span>Claude 비전 + 알라딘 도서 API</span>
        </footer>
      </div>
    </>
  );
}
