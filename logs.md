# 작업 기록

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
