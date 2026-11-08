"use client";

import { ArrowRight, Brain, FileText, Globe, MessageSquare, Sigma, Upload } from "lucide-react";
import Link from "next/link";
import { signIn } from "next-auth/react";

function GoogleMark() {
  return (
    <svg width="18" height="18" viewBox="0 0 48 48" aria-hidden>
      <path fill="#EA4335" d="M24 9.5c3.54 0 6.71 1.22 9.21 3.6l6.85-6.85C35.9 2.38 30.47 0 24 0 14.62 0 6.51 5.38 2.56 13.22l7.98 6.19C12.43 13.72 17.74 9.5 24 9.5z" />
      <path fill="#4285F4" d="M46.98 24.55c0-1.57-.15-3.09-.38-4.55H24v9.02h12.94c-.58 2.96-2.26 5.48-4.78 7.18l7.73 6c4.51-4.18 7.09-10.36 7.09-17.65z" />
      <path fill="#FBBC05" d="M10.53 28.59c-.48-1.45-.76-2.99-.76-4.59s.27-3.14.76-4.59l-7.98-6.19C.92 16.46 0 20.12 0 24c0 3.88.92 7.54 2.56 10.78l7.97-6.19z" />
      <path fill="#34A853" d="M24 48c6.48 0 11.93-2.13 15.89-5.81l-7.73-6c-2.15 1.45-4.92 2.3-8.16 2.3-6.26 0-11.57-4.22-13.47-9.91l-7.98 6.19C6.51 42.62 14.62 48 24 48z" />
    </svg>
  );
}

function StartButton({ signedIn, large = false }: { signedIn: boolean; large?: boolean }) {
  if (signedIn) {
    return (
      <Link className={`lp-btn primary${large ? " lg" : ""}`} href="/chat">
        채팅으로 이동 <ArrowRight size={18} />
      </Link>
    );
  }
  return (
    <button
      className={`lp-btn primary${large ? " lg" : ""}`}
      type="button"
      onClick={() => signIn("google", { callbackUrl: "/chat" })}
    >
      <span className="lp-g"><GoogleMark /></span>
      Google로 시작하기
    </button>
  );
}

/** Static product mock: question → answer with page citations → the cited page opened beside it. */
function ProductMock() {
  return (
    <div className="lp-mock" aria-hidden>
      <div className="lp-mock-bar">
        <span /><span /><span />
        <p>PDF Evidence AI</p>
      </div>
      <div className="lp-mock-body">
        <div className="lp-mock-chat">
          <p className="lp-mock-label">ASK</p>
          <div className="lp-q">표에서 중요한 수치만 골라 설명해줘</div>
          <div className="lp-a">
            <p className="lp-a-tag">PDF ONLY</p>
            <p className="lp-a-h">1. 센서 사양</p>
            <ul>
              <li>ToF 센서는 <b>8×8</b> 거리 지도를 <b>15Hz</b>로 측정합니다 <span className="lp-cite">3쪽</span></li>
              <li>최대 측정 거리는 <b>4m</b>, 시야각은 <b>65°</b>입니다 <span className="lp-cite">3쪽</span></li>
            </ul>
            <div className="lp-mini" role="presentation">
              <span>항목</span><span>ToF</span><span>mmWave</span>
              <span>측정 속도</span><b>15Hz</b><b>18Hz</b>
              <span>출력</span><b>8×8 거리</b><b>점 · 궤적</b>
            </div>
            <p className="lp-a-h">2. 판정 기준</p>
            <ul>
              <li>기준보다 <b>150mm</b> 이상 가까우면 점유 영역으로 봅니다 <span className="lp-cite">5쪽</span></li>
            </ul>
          </div>
          <div className="lp-input">PDF에 대해 질문하기…<span>질문</span></div>
        </div>
        <div className="lp-mock-page">
          <div className="lp-page-head"><p>PAGE</p><b>3쪽 / 9</b></div>
          <div className="lp-paper">
            <i className="w60" /><i className="w90" /><i className="w80" />
            <div className="lp-hl">
              <span className="lp-hl-tag">근거</span>
              <i className="w95" /><i className="w85" /><i className="w70" />
            </div>
            <i className="w90" /><i className="w75" />
            <div className="lp-table">
              <i /><i /><i /><i /><i /><i />
            </div>
            <i className="w85" /><i className="w60" />
          </div>
        </div>
      </div>
    </div>
  );
}

const FEATURES = [
  { icon: FileText, title: "페이지별 요약", body: "올리는 순간 쪽마다 짧은 요약을 만들어, 긴 문서도 어디에 뭐가 있는지 먼저 훑어볼 수 있습니다." },
  { icon: MessageSquare, title: "근거 쪽수와 함께 답변", body: "답변 문장마다 근거가 된 쪽을 표시하고, 누르면 옆 뷰어에서 그 쪽이 바로 열립니다." },
  { icon: Sigma, title: "표 · 수식 · 그림", body: "비교표와 수식은 그대로 렌더링하고, 본문에 나온 그림도 답변 안에서 함께 보여줍니다." },
];

const STEPS = [
  { icon: Upload, title: "PDF 올리기", body: "200MB까지 올릴 수 있습니다. 원본은 내 계정에만 저장됩니다." },
  { icon: MessageSquare, title: "질문하기", body: "궁금한 걸 문장으로 묻습니다. 답변은 생성되는 대로 바로 보입니다." },
  { icon: Globe, title: "근거 확인", body: "답변 옆에서 원문 쪽을 확인하고, 필요하면 웹 검색으로 최신 정보를 보강합니다." },
];

export default function Landing({ signedIn }: { signedIn: boolean }) {
  return (
    <div className="lp">
      <header className="lp-nav">
        <div className="lp-wrap lp-nav-in">
          <span className="lp-logo"><Brain size={22} /> PDF Evidence AI</span>
          {signedIn ? (
            <Link className="lp-btn ghost" href="/chat">채팅으로 이동</Link>
          ) : (
            <Link className="lp-btn ghost" href="/login">로그인</Link>
          )}
        </div>
      </header>

      <main>
        <section className="lp-hero">
          <div className="lp-wrap lp-hero-in">
            <div className="lp-copy">
              <p className="lp-eyebrow">PDF 근거 기반 질의응답</p>
              <h1>답을 읽고,<br />근거 쪽까지<br /><em>바로</em> 확인하세요.</h1>
              <p className="lp-lead">
                PDF를 올리고 질문하면 Gemini가 문서를 읽고 답합니다.
                답변마다 근거가 된 쪽수를 붙이고, 그 쪽을 옆 뷰어에서 바로 열어 줍니다.
              </p>
              <div className="lp-ctas">
                <StartButton signedIn={signedIn} large />
                <a className="lp-btn ghost lg" href="#how">어떻게 쓰나요</a>
              </div>
              <p className="lp-note">논문 · 보고서 · 기술 문서처럼 길고 근거가 중요한 문서에 맞춰 만들었습니다.</p>
            </div>
            <ProductMock />
          </div>
        </section>

        <section className="lp-sec">
          <div className="lp-wrap">
            <h2 className="lp-h2">긴 문서를 읽을 때 필요한 것만</h2>
            <div className="lp-features">
              {FEATURES.map(({ icon: Icon, title, body }) => (
                <article key={title} className="lp-feature">
                  <span className="lp-ic"><Icon size={20} /></span>
                  <h3>{title}</h3>
                  <p>{body}</p>
                </article>
              ))}
            </div>
          </div>
        </section>

        <section className="lp-sec" id="how">
          <div className="lp-wrap">
            <h2 className="lp-h2">세 단계면 됩니다</h2>
            <ol className="lp-steps">
              {STEPS.map(({ icon: Icon, title, body }, i) => (
                <li key={title} className="lp-step">
                  <span className="lp-step-n">{i + 1}</span>
                  <div>
                    <h3><Icon size={17} /> {title}</h3>
                    <p>{body}</p>
                  </div>
                </li>
              ))}
            </ol>
            <div className="lp-final">
              <p>지금 가진 PDF 하나로 바로 시작해 보세요.</p>
              <StartButton signedIn={signedIn} />
            </div>
          </div>
        </section>
      </main>

      <footer className="lp-foot">
        <div className="lp-wrap lp-foot-in">
          <span>PDF Evidence AI</span>
          <span>Gemini 2.5 Flash · Next.js · Vercel</span>
        </div>
      </footer>
    </div>
  );
}
