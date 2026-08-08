# 작업 기록

## 2026-08-09 — 코드 평가 후 정리: 중복 제거 · 린트 0 · 테스트/CI 도입

- 변경 파일: `src/tools/hooks.ts`·`NumField.tsx`(신규), 도구 8개 전부, `src/cores/*`, `src/tools/aifig/geometry.ts`, `src/App.{tsx,css}`, `tsconfig.{app,node}.json`, `.github/workflows/ci.yml`(신규), `README.md`
- 요약: 저장소 전반을 평가하고 거기서 나온 항목을 전부 처리했습니다. 소스 약 900줄이 줄었고, 린트 43건 → 0건, 테스트·CI가 생겼습니다. 그 과정에서 **커넥터 대각선 버그**와 **Tabler 내보내기 30초 문제**를 찾아 고쳤습니다.

### ⚠️ `dedupe`의 허용 오차를 다시 키우면 대각선이 재발합니다

`geometry.ts`의 `dedupe`가 0.5px 이내로 붙은 두 점을 같은 점으로 보고 버리고 있었습니다. 문제는 그 0.5px가 **없어도 되는 오차가 아니라 실제로 필요한 이동**이라는 점입니다. 두 노드는 픽셀 단위로 정렬돼 있는 경우가 드물어서, ortho 경로에는 긴 가로 구간 두 개 사이에 0.25px짜리 세로 구간이 끼는 일이 흔합니다. 그 점을 버리면 오프셋이 사라지는 게 아니라 **양옆 구간으로 옮겨가고, 직각이어야 할 선이 대각선이 됩니다.**

2026-08-07에 "대각선을 없앴다"고 기록했지만 이 경로로 남아 있었습니다. 그때는 `roundCorners`의 `continue` 버그만 잡았고, 그 앞단계인 `dedupe`는 보지 않았습니다. 허용 오차를 0.01px로 낮춰 미세 구간을 살립니다 — 짧은 구간은 `roundCorners`가 하드 코너로 처리하므로 눈에 보이지 않습니다.

**이 버그는 눈으로 찾을 수 없습니다.** 노드 간격 4~220px를 훑는 3025개 조합 중 어긋나는 건 아주 좁은 간격 몇 개뿐이라, 한 쌍만 보면 멀쩡합니다. 그래서 스윕 테스트를 `geometry.test.ts`로 남겼습니다. 같은 스윕에서 코너의 89.4%가 온전한 반지름을 유지합니다(수정 전 88.8%).

### ⚠️ Tabler는 PNG에 웹폰트를 심지 않습니다

Tabler만 `skipFonts: false`였습니다 — 셀 글자에 본문 폰트를 유지하려던 의도인데, 대가가 컸습니다. 본문 스택의 첫 항목인 Pretendard는 CDN에서 오고, html-to-image가 그 CSS를 받아 **모든 웨이트(woff/woff2 18개, 한글이라 수십 MB)를 매 내보내기마다 base64로 인라인**했습니다. 캐시가 없는 첫 내보내기는 30초가 넘었고 그다음도 2~4초였습니다. 다른 도구는 0.25초입니다.

LaTeX Imager가 쓰는 방법(필요한 폰트만 골라 인라인)을 그대로 쓸 수 없습니다. 그건 `document.styleSheets`를 순회하는데, **Pretendard는 cross-origin 시트라 규칙을 읽을 수 없습니다.** KaTeX는 same-origin이라 되는 것뿐입니다.

폰트 스택의 폴백(Apple SD Gothic Neo · Noto Sans KR · Malgun Gothic)이 한글을 제대로 렌더하므로 시스템 폰트로 내보내기로 했습니다. 205ms / 102ms로 떨어졌습니다. 대가는 화면과 PNG의 자형이 미세하게 다르다는 것 — 자형을 정확히 맞춰야 하면 CDN CSS를 직접 fetch해 필요한 웨이트(400·700·800)만 인라인하는 방법이 남아 있습니다.

### 공통 로직을 `hooks.ts`로

도구 8개가 각각 독립 프로젝트였던 탓에 `loadState` / `withExport` / `flash` / preview fit / `savePng` / `copyPng`를 저마다 복제해 갖고 있었습니다. 실질 차이는 pixelRatio와 파일명뿐이라 `useStored` · `usePersist` · `useFitScale` · `usePngExport`로 묶었습니다. `NumField`(3개 도구에 복제)도 함께 뺐습니다. 소스 1170줄이 지워지고 273줄이 들어왔습니다.

`usePngExport`에는 확장점 두 개를 뒀습니다 — `guard`(내보내기 전 거부 사유, LaTeX Imager·DS Visualizer가 사용)와 `options`(내보내기마다 계산되는 html-to-image 옵션, LaTeX Imager의 KaTeX 폰트 CSS).

### ⚠️ AI Figure Maker의 `docRef`는 `useLatest`로 바꾸면 안 됩니다

렌더 중 ref에 대입하던 곳(`docRef.current = doc` 등)을 정리하면서, `viewRef`·`selNodesRef` 같은 읽기 전용 미러는 `useLatest`(effect에서 대입)로 옮겼습니다. **`docRef`만 예외입니다.** `commit`/`live`/`undo`/`redo`가 `setDocState` 직전에 `docRef.current`를 직접 갱신하는데, 이게 있어야 같은 틱 안에서 이어지는 편집이 앞의 결과 위에 쌓입니다. `useLatest`는 커밋 이후에 쓰므로 한 프레임 늦고, 연속 편집이 서로를 덮어씁니다.

undo/redo 버튼의 활성 상태는 렌더 중 `hist.current.past.length`를 읽고 있었습니다. Grapher도 같은 패턴이었고요. 두 곳 다 스택은 ref에 두되(드래그 중 push마다 리렌더하면 안 되므로) 버튼이 쓰는 boolean 두 개만 state로 미러링합니다.

### cores는 3개 중 1개만 컴포넌트째로 붙습니다

`src/cores/`(CodeBlock · Diagram · Chart)를 아무도 import하지 않아 검증 없이 표류하고 있었습니다. 앱에서 실제로 쓰기로 했는데, 붙여보니 **Chart만 됩니다.** Chart Maker의 렌더 부분은 순수 표시라 `<Chart/>`로 교체돼 608 → 289줄이 됐습니다. 반면 Diagram의 짝은 Grapher, CodeBlock의 짝은 Highlighter인데 **둘 다 편집기**입니다 — 노드마다 이벤트·선택·ref가 필요하고, 표시 전용 컴포넌트를 그렇게 확장하면 그건 이미 그 도구입니다.

그래서 남은 둘은 **어긋나면 안 되는 부분만** 공유합니다: Prism 하이라이트 단계(`cores/highlight.ts` ← Highlighter)와 노드 팔레트(`cores/palette.ts` ← Grapher). 색이 갈리면 Grapher 편집 화면과 슬라이드에 렌더된 Diagram이 달라지는데, 이제 한 곳에서 옵니다. 팔레트를 컴포넌트 파일이 아니라 별도 파일에 둔 이유는 Fast Refresh입니다 — 컴포넌트와 상수를 같이 export하면 refresh 경계가 깨집니다.

### 그 밖에

- **`strict`가 아예 꺼져 있었습니다.** Vite 템플릿 기본값인데 tsconfig 어디에도 없었습니다. 켜고 돌려보니 **에러 0건** — 이미 strict를 만족하는 코드였고 플래그만 빠져 있었습니다.
- 린트 43건은 대부분 `eslint-plugin-react-hooks` v7의 새 규칙이었습니다. `useMemo(loadState, [])` 8건은 훅 추출로 사라졌고, 렌더 중 ref 접근 15건은 위의 방식으로, prop→state 동기화 effect는 렌더 중 조정(공식 권장 패턴)으로 바꿨습니다. 억제 주석을 남긴 곳은 Highlighter의 스크롤 clamp 한 곳뿐입니다 — DOM 측정 결과라 렌더 중에 구할 수 없고 paint 전에 반영돼야 합니다.
- 반응형: 미디어 쿼리가 0개였습니다. 앱 사이드바는 1100px 미만에서 아이콘 레일(58px)로, AI Figure Maker의 좌우 패널은 1280px 미만에서 접힌 채로 시작합니다. 접힘 상태는 접힌 패널이 자기 펼침 버튼 폭(34px)만 남기는 방식이라 컨트롤이 화면 밖으로 나가지 않습니다. 사이드바 선택은 `localStorage`에 남고, 명시적 선택이 폭 휴리스틱을 이깁니다.
- CI(`.github/workflows/ci.yml`)는 lint → test → build 순으로 돌고, 마지막에 `gen:css`를 실행해 **생성된 CSS 5개**가 커밋본과 같은지 검사합니다. 생성물을 직접 고치면 다음 `gen:css`에 조용히 지워지는데, 그걸 CI가 잡습니다. `AiFigureMaker.css`와 `ChartMaker.css`는 손으로 쓰는 파일이라 검사 대상이 아닙니다.

미해결로 남긴 것: `npm audit`에 postcss 관련 high 2건이 있습니다(빌드 도구 전이 의존성, 런타임 아님).

## 2026-08-07 — 저장소 하나로 정리 (독립 도구 5개 아카이브)

- 대상: 로컬 `~/Projects/Main Projects/funky-essets/`, GitHub `bsiku3622/funky-essets-*` 5개
- 요약: 앱을 `funky-essets/` 루트로 승격하고, 완전히 중복이던 독립 도구 저장소 5개를 아카이브했습니다.

정리 전에는 `funky-essets/` 아래에 폴더 6개가 나란히 있고 각각이 별도 git 저장소였습니다. 조사해 보니 **독립 도구 5개(Highlighter · LaTeX Imager · Tabler · DS Visualizer · Grapher)의 소스가 통합 앱 안의 복사본과 완전히 동일**했습니다 — `App.tsx` 줄 수까지 일치하고 CSS도 바이트 단위로 같았습니다. 마지막 커밋은 2026-06-09/10이고, Vercel에 배포된 것은 통합 앱 하나뿐이었습니다. 즉 죽은 중복이었습니다.

- 로컬: `Funky Esset Maker/`의 내용을 `funky-essets/` 루트로 올리고 폴더를 없앴습니다. 독립 도구 5개는 `~/Projects/Archive/funky-essets-standalone/`로 옮겼습니다.
- GitHub: 5개 저장소의 description을 "Merged into bsiku3622/funky-esset-maker"로 바꾼 뒤 아카이브했습니다. 삭제가 아니라 아카이브라 초기 개발 히스토리는 남아 있고, 필요하면 되돌릴 수 있습니다.

**이 작업은 로컬 폴더 재배치일 뿐 저장소 내용은 건드리지 않았습니다.** `funky-esset-maker` 저장소는 원래부터 루트에 `src/`와 `package.json`을 두고 있었고, 그것이 로컬에서 한 단계 깊은 폴더에 체크아웃돼 있었을 뿐입니다. 그래서 GitHub 구조와 Vercel 연동·도메인은 아무 영향을 받지 않았습니다. 저장소 이름도 `funky-esset-maker` 그대로 뒀습니다 — 폴더명과는 어긋나지만, 이름을 바꾸면 리다이렉트와 연동을 다시 확인해야 해서 얻는 것에 비해 번거롭습니다.

`tool-sources/`가 이제 그 다섯 도구 CSS의 **유일한 원본**입니다. 예전에는 독립 프로젝트의 `src/App.css`를 복사해 오는 흐름이었는데, 원본이 아카이브됐으니 이제 `tool-sources/`에서 직접 고치고 `npm run gen:css`를 돌리면 됩니다.

### ⚠️ 폴더명을 바꿀 때는 Claude 기록도 같이 옮겨야 합니다

정리 직후 로컬 폴더명을 저장소 이름에 맞춰 `funky-essets` → `funky-esset-maker`로 바꿨습니다. 이때 폴더만 옮기면 **그동안의 Claude Code 세션 기록과 메모리가 끊깁니다.**

Claude Code는 프로젝트의 절대경로를 슬래시→하이픈으로 인코딩한 이름으로 `~/.claude/projects/` 아래에 기록을 둡니다. 폴더를 옮기면 새 경로에 대응하는 디렉토리가 새로 생기고, 옛 기록은 존재하지 않는 경로에 묶인 채 접근할 수 없게 됩니다. 그래서 폴더와 함께 그 디렉토리도 같은 규칙으로 rename해야 합니다:

```
~/.claude/projects/-Users-baeks-Projects-Main-Projects-funky-essets
  → ~/.claude/projects/-Users-baeks-Projects-Main-Projects-funky-esset-maker
```

이번에는 챙길 게 하나 더 있었습니다. 앱이 `funky-essets/Funky Esset Maker/`에 있던 시절의 기록 디렉토리(`…-funky-essets-Funky-Esset-Maker`)에 **`memory/`가 남아 있었습니다** — "명시적 요청 없이 커밋하지 말 것" 피드백이 거기 저장돼 있었고, 그대로 뒀으면 다시는 불러와지지 않았을 겁니다. 그 `memory/`도 새 디렉토리로 옮기고 빈 껍데기는 지웠습니다.

세션 도중에 옮겨도 안전합니다. `mv`는 inode를 유지하므로 지금 쓰이고 있는 로그 파일도 그대로 따라옵니다.

## 2026-08-07 — 이미지 반입 경로 + 캔버스 줌이 페이지를 확대하던 버그

- 변경 파일: `src/tools/aifig/image.ts` (신규), `src/tools/AiFigureMaker.tsx`, `src/tools/aifig/Inspector.tsx`, `src/tools/aifig/{types,shapes,doc}.ts`, `src/tools/AiFigureMaker.css`
- 요약: 드래그&드롭 / 붙여넣기로 비트맵을 바로 넣게 하고, 트랙패드 핀치가 브라우저 페이지를 확대하던 문제를 고침.

### ⚠️ 휠·핀치는 반드시 native non-passive 리스너로

React의 `onWheel`은 위임된 **passive** 리스너로 등록되기 때문에 그 안의 `preventDefault()`가 조용히 무시됩니다. 그래서 캔버스 위에서 트랙패드로 핀치하면 캔버스도 확대되고 **브라우저 페이지도 같이 확대**됐습니다. `stageRef`에 `addEventListener('wheel', fn, { passive: false })`로 직접 붙여야 막힙니다. Safari는 핀치에 대해 `gesturestart`/`gesturechange`를 따로 쏘므로 그것도 함께 막습니다.

**`onWheel` prop으로 되돌리면 버그가 그대로 재발합니다.** 겸사겸사 줌 스텝을 `Math.exp(-deltaY * 0.01)`로 바꿨습니다 — 핀치는 작은 델타가 연속으로 오는데 고정 10% 스텝이면 계단처럼 튑니다.

### 이미지

붙여넣기를 `keydown`이 아니라 **`paste` 이벤트**에서 처리합니다. keydown에서는 클립보드에 이미지가 있는지 알 수 없어서, `⌘V`가 이미지 붙여넣기와 노드 복제를 구분하지 못했습니다. paste 이벤트는 `clipboardData`를 주므로 "이미지가 있으면 이미지, 없으면 내부 노드 클립보드"로 갈라집니다. 스크린샷은 `clipboardData.files`가 아니라 `items`로 오기 때문에 양쪽을 다 봅니다.

비트맵은 data URL로 노드에 박습니다. SVG를 내보냈을 때 딸린 파일이 없어야 하기 때문인데, 대가로 문서가 무거워집니다. 그래서 (1) 긴 변 2400 px 초과분은 반입 시 리샘플하고, (2) `saveDoc`이 성공 여부를 돌려주게 해서 **localStorage 용량 초과를 토스트로 알립니다** — 예전에는 조용히 삼켜서 자동 저장이 멈춘 줄도 모르고 작업하게 됐습니다.

## 2026-08-07 — 직각 커넥터 라우팅 재작성

- 변경 파일: `src/tools/aifig/geometry.ts`, `src/tools/aifig/shapes.tsx`
- 요약: ortho 경로에 대각선이 섞이고 코너가 찌그러지던 문제를 고침. stack 도형이 자기 노드 박스와 어긋나 있던 것도 함께 수정.

세 가지가 겹쳐 있었습니다.

**1. 코너를 건너뛰면서 정점을 지나쳤다.** `roundCorners`가 필렛을 넣기엔 너무 좁은 코너를 만나면 `continue`했는데, 그때 cursor를 갱신하지 않아 **그 정점을 거치지 않고 다음 정점으로 직선을 그었습니다** — 직각이어야 할 경로에 대각선이 생기는 정체가 이것이었습니다. 이제 필렛이 불가능하면 하드 코너로 정점을 통과합니다. 겸사겸사 일직선 위의 정점에 필렛을 넣던 것도 없앴습니다(경로만 지저분해지고 시각적 차이는 없음).

**2. 코너가 짧은 구간에서 뾰족해졌다.** 반지름을 `min(r, d1/2, d2/2)`로 깎다 보니 두 노드가 가까우면 코너가 거의 직각이 됐습니다. ⚠️ 이제는 **반대 방향**입니다 — 반지름은 고정이고, 그만한 코너가 들어갈 자리가 없으면 *경로 쪽을 바꿉니다*. `orthoPoints`가 여러 후보(직행 Z, 위/아래 우회 레인, stub 연장)를 만들고 `legsFit`으로 "모든 구간이 양 끝 코너의 필렛을 담을 만큼 긴가"를 검사해 첫 합격 후보를 씁니다. 반지름 축소는 어떤 후보도 통과 못 할 때만 일어납니다. 노드 간격을 4~220px까지 훑는 3025개 조합에서 코너의 88.8%가 온전한 반지름을 유지합니다(나머지는 간격이 10px 미만인 배치).

`legsFit`은 "되돌아가는 구간"도 함께 거릅니다. 이전에는 경로가 목표점을 지나쳤다가 되돌아오면서 선이 자기 위에 겹치는 경우가 있었습니다.

**3. 마주보는 stub이 서로를 지나쳤다.** 고정 STUB(18px) 두 개가 노드 간격보다 길면 s와 e의 순서가 뒤집혀 이후 모든 라우팅이 꼬였습니다. 마주보는 경우에 한해 stub을 간격에 맞춰 대칭으로 줄입니다.

코너 곡선은 2차 베지어에서 **원호 근사(3차, κ=0.5523)** 로 바꿨습니다. 같은 반지름이라도 2차는 꼭짓점 쪽이 눌려 보여서, 사용자 눈에는 "덜 둥근" 코너로 읽힙니다.

**stack 도형 정렬** — `shapeOverflow`는 "뒷장이 오른쪽 위로 쌓인다"고 보고했는데 렌더는 앞장을 아래로 내려 그리고 있었습니다. 그래서 선택 박스·라벨·히트 영역이 전부 도형과 어긋났습니다. 앞장을 노드 박스 (0,0)에 고정하고 뒷장을 오른쪽 위로 보내 셋이 일치하게 했습니다. **도형을 새로 추가할 때 `shapeOverflow`와 실제 렌더 좌표가 맞는지 반드시 같이 확인해야 합니다** — 어긋나면 클릭 판정까지 조용히 틀어집니다.

## 2026-08-07 — AI Figure Maker 추가 (논문용 모델 구조도 에디터)

- 변경 파일: `src/tools/AiFigureMaker.tsx`, `src/tools/AiFigureMaker.css`, `src/tools/aifig/*` (11개 모듈), `src/App.tsx`, `vite.config.ts`, `README.md`
- 요약: AI/ML 논문 figure 전용 드로잉 앱을 새 도구로 추가. SVG 네이티브 렌더링 + MathJax 벡터 수식 + 논문 규격 캔버스.

### ⚠️ SVG 네이티브 렌더링 — 되돌리면 안 되는 결정

기존 도구들은 전부 HTML을 그린 뒤 `html-to-image`로 PNG를 뽑습니다. 이 도구만 캔버스를 SVG로 직접 그리고, 내보낼 때 화면에 있는 `.af-figure` `<g>`를 `XMLSerializer`로 직렬화합니다.

논문 figure는 벡터가 사실상 필수라서 PNG-only 경로는 처음부터 후보가 아니었습니다. 그리고 "SVG로 그린 뒤 그 DOM을 그대로 내보낸다"는 선택이 중요한 이유는, 렌더링 코드가 하나뿐이라 화면과 파일이 어긋날 수 없다는 점입니다. 별도의 SVG 생성기를 두는 흔한 설계는 도형 하나 고칠 때마다 두 곳을 고쳐야 하고, 반드시 한쪽이 뒤처집니다.

이 결정의 대가는 에디터 UI를 figure와 분리해야 한다는 것입니다. 그래서 선택 핸들·가이드·클릭 판정은 전부 `.af-figure` **바깥의 형제 그룹**에 있고, figure 그룹 자체는 `pointer-events="none"`입니다. 클릭은 `data-hit-node` / `data-hit-edge`를 가진 투명 hit 레이어가 받습니다. figure 안에 편집용 요소를 하나라도 넣으면 내보낸 파일에 그대로 딸려 나갑니다.

### ⚠️ LaTeX는 KaTeX가 아니라 MathJax SVG

프로젝트에 이미 KaTeX가 있지만 쓰지 않았습니다. KaTeX는 HTML+CSS로 조판하므로 SVG에 넣으려면 `<foreignObject>`가 필요한데, Illustrator·Inkscape·`\includegraphics`가 이를 무시합니다. 논문용으로는 치명적입니다.

MathJax의 SVG 출력은 진짜 `<path>` 글리프를 냅니다. `fontCache: 'none'`으로 설정해 글리프를 인라인시켰는데, 이건 파일이 조금 커지는 대신 `<use>`/`<defs>` id 충돌을 원천 차단합니다 — 수식 두 개를 한 파일에 합칠 때 id가 겹치면 조용히 깨집니다.

좌표 변환 규칙(`aifig/latex.ts`): MathJax 내부 단위는 1 em = 1000 units이고, 컨테이너 `<svg>` 안쪽 `<g>`는 이미 baseline이 y=0인 y-up 좌표계입니다. 따라서 `translate(x, baselineY) scale(fontSize/1000)`으로 감싸면 정확히 맞습니다. viewBox의 `minY`가 ascent, `height + minY`가 descent입니다.

### 함정 세 가지 (같은 자리에서 다시 밟기 쉬움)

**1. mathjax-full은 브라우저에서 그냥은 안 뜬다.** `js/components/version.js`가 자기 package.json을 읽으려고 `eval('require')`를 호출해서 `ReferenceError: require is not defined`로 죽습니다. 해결은 vite `define`으로 `PACKAGE_VERSION`을 주입하는 것 — 그 파일이 `typeof PACKAGE_VERSION === 'undefined'`일 때만 eval 분기를 타기 때문에, 상수를 정의해 두면 정적 분기로 넘어갑니다. `optimizeDeps.esbuildOptions.define`도 시도했지만 Vite 8은 rolldown을 쓰므로 deprecated 경고만 나고, 최상위 `define` 하나로 dev·build 양쪽 다 해결됩니다.

**2. MathJax 로드 완료가 구독보다 먼저 일어난다.** dynamic import가 이미 캐시된 모듈이면 microtask에서 resolve되는데, React의 passive effect는 그보다 늦게 실행됩니다. 그래서 `useEffect`에서 `onMathReady(...)`를 등록하는 시점엔 이미 "완료" 이벤트가 지나가 있고, 수식이 영원히 LaTeX 원문으로 남습니다. 콘솔에 에러도 안 납니다. `onMathReady`가 등록 시점에 이미 준비됐으면 콜백을 즉시 호출하도록 고쳤습니다.

**3. memo된 컴포넌트는 수식 캐시가 채워져도 다시 안 그린다.** `NodeView`/`EdgeView`는 `memo`인데 MathJax가 준비돼도 props가 안 바뀝니다. `rev` prop(= `mathRev`)을 넘겨 memo를 무효화합니다. 이 prop은 렌더에 쓰이지 않으니 "안 쓰는 prop"으로 보고 지우면 수식이 다시 안 나옵니다.

### 그 밖의 판단

- **캔버스 = 물리 크기.** 캔버스는 px지만 `printWidthIn`을 함께 들고 있어서, 글자 크기를 "인쇄되면 몇 pt"로 환산해 보여 주고 6 pt 미만이면 경고합니다. 논문 figure에서 가장 흔한 실수가 축소 후 글자가 안 보이는 것이라, 이 readout이 이 도구의 실질적인 핵심 기능입니다. SVG를 내보낼 때도 `width`/`height`를 mm로 적어 `\includegraphics`가 단 폭에 그대로 맞습니다.
- **팔레트는 Appendix에서 받은 관례 조합** (matplotlib tab10 / Nature muted / 그레이스케일+포인트) 에 색각 이상 안전 팔레트(Okabe–Ito, Paul Tol)를 더한 5종. 팔레트 교체는 색을 인덱스로 매핑해 바꾸므로 "어느 블록이 한 그룹인지"가 보존됩니다.
- **TikZ 내보내기는 근사입니다.** 3D 텐서·MLP·히트맵은 TikZ에 대응 도형이 없어 사각형이 됩니다. 충실한 쪽은 SVG이고 TikZ는 출발점 용도라고 README에 적어 뒀습니다. 이스케이프에 주의 — `$…$` 안의 `_`를 이스케이프하면 수식이 깨지므로 `parseLabel`로 math 구간을 구분해 텍스트만 이스케이프합니다.
- **린트**: 새 파일들은 순수 함수를 `layout.ts`·`handles.ts`·`resolve.ts`로 분리해 `react-refresh/only-export-components`를 해소했습니다. 렌더 중 ref 접근(`docRef.current = doc`) 경고는 남겨 뒀습니다 — 기존 도구 9개가 전부 같은 패턴이라 이 파일만 바꾸면 오히려 일관성이 깨집니다.
