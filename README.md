# Funky Esset Maker

수업 자료·발표 슬라이드·문서에 바로 붙일 수 있는 시각 에셋을 만들어 PNG로 내보내는 웹 도구 모음입니다. 코드 하이라이트, 수식, 표, 자료구조, 그래프, 차트 등을 한 화면에서 만들고, [`@studio-baeks/funky-ui`](https://www.npmjs.com/package/@studio-baeks/funky-ui) neo-brutalist 디자인 시스템으로 통일된 룩을 입혀 출력합니다.

## 도구

| 도구 | 설명 |
| --- | --- |
| **Highlighter** | 코드 하이라이트 (Prism.js) |
| **LaTeX Imager** | 수식 · 문서 (KaTeX) |
| **Tabler** | 표 |
| **DS Visualizer** | 자료구조 |
| **Grapher** | 그래프 · 다이어그램 |
| **AI Figure Maker** | 논문용 모델 구조도 (벡터 SVG · LaTeX) |
| **Cartesian Plotter** | 함수 그래프 |
| **Chart Maker** | 막대 · 선 · 원 · 산점도 |
| **Number Line** | 수직선 · 구간 · 부등식 |
| **Truth Table** | 진리표 |

대부분의 도구는 결과물을 `html-to-image`로 PNG 이미지로 내보냅니다. **AI Figure Maker**만 예외로, 캔버스를 SVG로 직접 그리고 그 DOM을 그대로 직렬화해 벡터 SVG·고해상도 PNG·TikZ로 내보냅니다. 마지막으로 사용한 도구는 `localStorage`에 저장돼 다음 방문 때 그대로 열립니다.

## 시작하기

```bash
npm install
npm run dev
```

`http://localhost:5173`에서 열립니다.

## 스크립트

| 명령 | 설명 |
| --- | --- |
| `npm run dev` | 개발 서버 실행 (실행 전 `gen:css` 자동 수행) |
| `npm run build` | 타입 체크 후 프로덕션 빌드 |
| `npm run preview` | 빌드 결과 미리보기 |
| `npm run lint` | ESLint 검사 |
| `npm run gen:css` | 도구별 스코프 CSS 재생성 |

## 구조

```
src/
  App.tsx          사이드바 네비게이션 + 도구 전환
  tools/           각 도구 (UI · 툴바 · 내보내기 + 생성된 스코프 CSS)
    aifig/         AI Figure Maker 모듈 (문서 모델 · 도형 · 라우팅 · LaTeX · 내보내기)
  cores/           순수 렌더 컴포넌트 (CodeBlock · Diagram · Chart)
tool-sources/      다섯 도구의 원본 App.css (스코프 CSS의 소스)
scripts/
  gen-scoped-css.mjs   tool-sources의 CSS에 스코프 prefix 붙여 src/tools로 생성
```

`src/cores/`는 툴바·내보내기 장치를 떼어낸 순수 시각 컴포넌트로, 다른 앱(예: Funky Slide)에서 import해 재사용하도록 분리해 둔 것입니다.

### 스코프 CSS

다섯 도구(Highlighter · LaTeX Imager · Tabler · DS Visualizer · Grapher)는 원래 각각 독립 프로젝트였고, 그들의 `App.css`는 `.toolbar`, `.stage` 같은 전역 클래스명을 써서 한 앱으로 합칠 때 충돌합니다. 그래서 원본 CSS를 `tool-sources/<도구>/App.css`로 두고, `gen-scoped-css.mjs`가 모든 셀렉터에 도구별 스코프 클래스(`.scope-highlighter .toolbar { … }`)를 붙여 `src/tools/*.css`로 생성합니다 — 순수 CSS이고 `@scope`는 쓰지 않습니다.

**`tool-sources/`가 이 다섯 도구 CSS의 원본입니다.** 스타일을 바꾸려면 거기서 고치고 `npm run gen:css`를 실행하세요. 생성된 `src/tools/*.css`는 커밋되어 있으므로 빌드는 스크립트 없이도 동작합니다.

> 이 다섯 도구는 예전에 별도 저장소로도 존재했지만, 코드가 이 앱과 완전히 동일해져서 2026-08-07에 아카이브했습니다 (`funky-essets-*`). 이 저장소가 유일한 원본입니다.

## AI Figure Maker

AI/ML 논문에 들어가는 모델 구조도 전용 에디터입니다. 다른 도구와 달리 캔버스를 **SVG로 직접 렌더링**하고, 내보낼 때 화면에 그려진 바로 그 `<g>` 엘리먼트를 직렬화합니다 — 화면과 파일이 어긋날 여지가 없습니다.

- **논문 규격 캔버스** — NeurIPS/ICLR·ICML·CVPR·ACL·IEEE·Nature·Science 등의 실제 단 폭 프리셋. 인쇄 시 글자가 몇 pt가 되는지 실시간으로 계산해 6 pt 미만이면 경고합니다.
- **AI figure 전용 도형** — 3D 텐서 블록, 반복 블록(N×), MLP 뉴런 팬, 패치/어텐션 히트맵, 인코더·디코더 사다리꼴, 연산자 토큰(⊕ ⊗ ⊙ ‖), 중괄호, 활성함수 미니 그래프.
- **LaTeX** — 라벨 어디에나 `$…$`. MathJax의 SVG 출력을 써서 수식이 진짜 `<path>` 글리프로 들어갑니다. Illustrator·Inkscape에서 그대로 열리고 폰트 임베딩이 필요 없습니다.
- **커넥터** — 직선·직각·곡선·호 라우팅, 경유점 편집, 화살촉 6종, 라벨(수식 가능). 직각 라우팅은 코너 반지름을 고정으로 유지하고, 그만한 코너가 들어갈 자리가 없으면 반지름을 깎는 대신 경로를 우회시킵니다.
- **이미지** — 캔버스에 끌어다 놓거나 `⌘V`로 붙여넣으면 원본 비율대로 들어갑니다. 여러 장을 한 번에 놓으면 가로로 나란히 배치돼 정성 비교 패널이 바로 만들어집니다. 긴 변 2400 px(600 dpi에서 4″)를 넘으면 자동 축소하고, 채우기 모드(늘림 / 맞춤 / 채움)와 원본 비율 복원을 지원합니다. 비트맵은 data URL로 문서에 박히므로 SVG를 내보내도 딸린 파일이 없습니다.
- **팔레트** — matplotlib tab10, Nature muted, 그레이스케일+포인트, Okabe–Ito·Paul Tol(색각 이상 안전). 팔레트를 바꾸면 기존 figure의 색이 대응 관계를 유지한 채 함께 바뀝니다.
- **템플릿** — Transformer, Attention, ViT, ResNet, U-Net, CNN 파이프라인, Encoder–Decoder, GAN, Diffusion, DeepONet, PINN, 학습 루프 등 16종.
- **내보내기** — 벡터 SVG(물리 크기를 mm로 기록해 `\includegraphics`가 단 폭에 정확히 맞음), 최대 2400 dpi PNG(sRGB 태깅), 프로젝트 JSON, TikZ 코드(근사).

MathJax는 무겁기 때문에 이 도구를 처음 열 때만 별도 청크로 지연 로드됩니다. 그 전까지 수식은 LaTeX 원문으로 잠깐 보였다가 교체됩니다.

## 배포 (Vercel)

저장소를 Vercel에 연결하면 `vercel.json` 설정대로 자동 배포됩니다 (framework `vite`, build `npm run build`, output `dist`). CLI로 배포하려면:

```bash
npm i -g vercel
vercel        # 프리뷰
vercel --prod # 프로덕션
```

이 프로젝트는 `tool-sources/`에 원본 CSS를 포함해 외부 형제 프로젝트 없이 단독으로 빌드됩니다.

## 기술 스택

React 19 · TypeScript · Vite · `@studio-baeks/funky-ui` · Prism.js · KaTeX · MathJax(SVG 출력) · MathLive · html-to-image

## 라이선스

[MIT](./LICENSE)
