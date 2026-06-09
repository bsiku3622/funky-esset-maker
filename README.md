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
| **Cartesian Plotter** | 함수 그래프 |
| **Chart Maker** | 막대 · 선 · 원 · 산점도 |
| **Number Line** | 수직선 · 구간 · 부등식 |
| **Truth Table** | 진리표 |

각 도구는 결과물을 `html-to-image`로 PNG 이미지로 내보냅니다. 마지막으로 사용한 도구는 `localStorage`에 저장돼 다음 방문 때 그대로 열립니다.

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
  cores/           순수 렌더 컴포넌트 (CodeBlock · Diagram · Chart)
tool-sources/      독립 도구 프로젝트에서 가져온 원본 App.css (스코프 CSS의 소스)
scripts/
  gen-scoped-css.mjs   tool-sources의 CSS에 스코프 prefix 붙여 src/tools로 생성
```

`src/cores/`는 툴바·내보내기 장치를 떼어낸 순수 시각 컴포넌트로, 다른 앱(예: Funky Slide)에서 import해 재사용하도록 분리해 둔 것입니다.

### 스코프 CSS

일부 도구(Highlighter · LaTeX Imager · Tabler · DS Visualizer · Grapher)는 원래 독립 프로젝트로 만들어졌고, 그들의 `App.css`는 `.toolbar`, `.stage` 같은 전역 클래스명을 써서 합칠 때 충돌합니다. 그래서 원본 CSS를 `tool-sources/<도구>/App.css`로 가져와 두고(self-contained), `gen-scoped-css.mjs`가 모든 셀렉터에 도구별 스코프 클래스(`.scope-highlighter .toolbar { … }`)를 붙여 `src/tools/*.css`로 생성합니다 — 순수 CSS이고 `@scope`는 쓰지 않습니다.

원본 도구의 스타일이 바뀌면 해당 프로젝트의 `src/App.css`를 `tool-sources/<도구>/App.css`로 다시 복사한 뒤 `npm run gen:css`를 실행해 주세요. (생성된 `src/tools/*.css`는 커밋되어 있으므로, 빌드 시 원본이 없어도 안전하게 동작합니다.)

## 배포 (Vercel)

저장소를 Vercel에 연결하면 `vercel.json` 설정대로 자동 배포됩니다 (framework `vite`, build `npm run build`, output `dist`). CLI로 배포하려면:

```bash
npm i -g vercel
vercel        # 프리뷰
vercel --prod # 프로덕션
```

이 프로젝트는 `tool-sources/`에 원본 CSS를 포함해 외부 형제 프로젝트 없이 단독으로 빌드됩니다.

## 기술 스택

React 19 · TypeScript · Vite · `@studio-baeks/funky-ui` · Prism.js · KaTeX · html-to-image

## 라이선스

[MIT](./LICENSE)
