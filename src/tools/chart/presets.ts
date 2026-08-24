/* Starting points.
 *
 * A plotting engine with twenty marks and forty options is unusable from a
 * blank page — nobody discovers a ternary diagram by reading a dropdown. Each
 * preset is a working figure with data in it, so picking one and replacing the
 * numbers is the whole workflow, and reading its spec is how the options get
 * discovered.
 *
 * ⚠️ Sample data is generated, not pasted, wherever it needs more than a dozen
 * rows. A hundred lines of literal text in this file would be unreadable and
 * unmaintainable, and the generators double as documentation of what shape
 * each mark expects. */

import type { PlotSpec } from '../../cores'

export interface Preset {
  id: string
  label: string
  group: string
  data: string
  spec: PlotSpec
}

/* ---------- deterministic sample data ---------- */

/** A tiny LCG. The samples must be the same on every load — a histogram that
 *  reshuffles itself when you switch tools is unnerving. */
function rng(seed: number) {
  let s = seed >>> 0
  return () => {
    s = (s * 1664525 + 1013904223) >>> 0
    return s / 4294967296
  }
}
/** Box–Muller, for a bell that actually looks like one. */
function normals(n: number, mu: number, sigma: number, seed: number): number[] {
  const r = rng(seed)
  const out: number[] = []
  while (out.length < n) {
    const u = Math.max(1e-9, r())
    const v = r()
    out.push(mu + sigma * Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * v))
  }
  return out
}

const tsv = (head: string[], rows: (string | number)[][]) =>
  [head.join('\t'), ...rows.map((r) => r.join('\t'))].join('\n')

function gridSample(
  head: [string, string, string],
  n: number,
  lo: number,
  hi: number,
  f: (x: number, y: number) => number,
): string {
  const rows: (string | number)[][] = []
  for (let i = 0; i <= n; i++)
    for (let j = 0; j <= n; j++) {
      const x = lo + ((hi - lo) * i) / n
      const y = lo + ((hi - lo) * j) / n
      rows.push([+x.toFixed(3), +y.toFixed(3), +f(x, y).toFixed(4)])
    }
  return tsv(head, rows)
}

/* ---------- shared spec pieces ---------- */

const base = (over: Partial<PlotSpec>): PlotSpec => ({
  width: 660,
  height: 450,
  palette: 'deep',
  columns: 1,
  panels: [],
  ...over,
})

const panel = (over: Record<string, unknown>) => ({
  id: 'p1',
  coord: 'cartesian' as const,
  legend: { pos: 'top-right' as const, frame: true },
  annotations: [],
  series: [],
  ...over,
})

/* ---------- the presets ---------- */

const lossRows = (() => {
  const names = ['mlp', 'pinn', 'gaussian-gated', 'rosenthal-gated', 'radial-gated']
  const floors = [5e-8, 4.5e-7, 1.0e-7, 6e-8, 2.6e-8]
  const rows: (string | number)[][] = []
  const rates = [8.6, 6.4, 8.0, 8.3, 9.4]
  for (let k = 0; k <= 24; k++) {
    const it = k * 5000
    const row: (string | number)[] = [it]
    names.forEach((_, i) => {
      const t = k / 24
      // decay towards each model's own floor, not towards a shared constant —
      // otherwise every curve lands on the same value and the plot is one line
      const v = floors[i] * (1 + (1e-4 / floors[i] - 1) * Math.exp(-rates[i] * t))
      row.push((v * (1 + 0.05 * Math.sin(k * 1.9 + i * 2))).toExponential(3))
    })
    rows.push(row)
  }
  return tsv(['iteration', ...names], rows)
})()

export const PRESETS: Preset[] = [
  /* ---- 기본 ---- */
  {
    id: 'bar',
    label: '막대',
    group: '기본',
    data: tsv(
      ['항목', '값'],
      [
        ['사과', 30],
        ['바나나', 45],
        ['체리', 18],
        ['포도', 27],
      ],
    ),
    spec: base({
      panels: [
        panel({
          y: { grid: true, zero: true, label: '개수' },
          x: { grid: false },
          legend: { pos: 'none' },
          series: [{ id: 's1', mark: 'bar', x: '항목', y: '값', labels: true }],
        }),
      ],
    }),
  },
  {
    id: 'bar-group',
    label: '그룹 막대',
    group: '기본',
    data: tsv(
      ['분기', '작년', '올해'],
      [
        ['1Q', 42, 55],
        ['2Q', 51, 63],
        ['3Q', 38, 71],
        ['4Q', 60, 84],
      ],
    ),
    spec: base({
      panels: [
        panel({
          y: { grid: true, zero: true, label: '매출 (억)' },
          series: [
            { id: 's1', mark: 'bar', x: '분기', y: '작년' },
            { id: 's2', mark: 'bar', x: '분기', y: '올해' },
          ],
        }),
      ],
    }),
  },
  {
    id: 'bar-stack',
    label: '누적 막대',
    group: '기본',
    data: tsv(
      ['월', '고체', '액체', '기체'],
      [
        ['3월', 12, 18, 7],
        ['4월', 15, 14, 9],
        ['5월', 9, 21, 12],
        ['6월', 18, 16, 10],
      ],
    ),
    spec: base({
      panels: [
        panel({
          y: { grid: true, zero: true, label: '수거량 (t)' },
          series: [
            { id: 's1', mark: 'bar', x: '월', y: '고체', stack: 'a' },
            { id: 's2', mark: 'bar', x: '월', y: '액체', stack: 'a' },
            { id: 's3', mark: 'bar', x: '월', y: '기체', stack: 'a' },
          ],
        }),
      ],
    }),
  },
  {
    id: 'bar-h',
    label: '가로 막대 · 기준선',
    group: '기본',
    data: tsv(
      ['model', 'RMSE'],
      [
        ['mlp', 100],
        ['pinn', 57],
        ['gaussian-gated', 74],
        ['rosenthal-gated', 93],
        ['radial-gated', 145],
      ],
    ),
    spec: base({
      height: 360,
      panels: [
        panel({
          title: 'RMSE: improvement over mlp',
          x: { grid: false, label: 'whole split  [%]' },
          y: { grid: false, zero: true },
          legend: { pos: 'none' },
          annotations: [
            { id: 'a1', kind: 'vline', x: 100, dash: 'dot', color: '#8C8C8C' },
          ],
          series: [{ id: 's1', mark: 'bar', x: 'model', y: 'RMSE', orient: 'h', labels: true, labelFormat: 'int' }],
        }),
      ],
    }),
  },
  {
    id: 'line',
    label: '선 그래프',
    group: '기본',
    data: tsv(
      ['연도', '서울', '부산', '대구'],
      [
        [2019, 12.8, 15.1, 14.6],
        [2020, 13.2, 15.4, 14.9],
        [2021, 13.9, 15.2, 15.4],
        [2022, 14.1, 15.8, 15.7],
        [2023, 14.6, 16.0, 16.2],
        [2024, 14.9, 16.3, 16.5],
      ],
    ),
    spec: base({
      panels: [
        panel({
          x: { grid: false, label: '연도', format: 'int' },
          y: { grid: true, label: '연평균기온 (℃)' },
          series: [
            { id: 's1', mark: 'line', x: '연도', y: '서울', marker: 'circle' },
            { id: 's2', mark: 'line', x: '연도', y: '부산', marker: 'square' },
            { id: 's3', mark: 'line', x: '연도', y: '대구', marker: 'triangle' },
          ],
        }),
      ],
    }),
  },
  {
    id: 'line-log',
    label: '로그 축 선',
    group: '기본',
    data: lossRows,
    spec: base({
      width: 700,
      panels: [
        panel({
          title: 'Train Loss (log scaled)',
          x: { grid: false, label: 'Number of Iterations', format: 'si' },
          y: { scale: 'log', grid: true, minorGrid: true, label: 'loss' },
          legend: { pos: 'top-right', frame: true },
          series: [
            { id: 's1', mark: 'line', x: 'iteration', y: 'mlp', width: 1.6 },
            { id: 's2', mark: 'line', x: 'iteration', y: 'pinn', width: 1.6 },
            { id: 's3', mark: 'line', x: 'iteration', y: 'gaussian-gated', width: 1.6 },
            { id: 's4', mark: 'line', x: 'iteration', y: 'rosenthal-gated', width: 1.6 },
            { id: 's5', mark: 'line', x: 'iteration', y: 'radial-gated', width: 1.6 },
          ],
        }),
      ],
    }),
  },
  {
    id: 'area',
    label: '누적 영역',
    group: '기본',
    data: tsv(
      ['연도', '석탄', '가스', '재생'],
      [
        [2018, 41, 27, 8],
        [2019, 40, 26, 11],
        [2020, 36, 26, 14],
        [2021, 34, 29, 17],
        [2022, 32, 28, 21],
        [2023, 29, 27, 25],
        [2024, 26, 26, 30],
      ],
    ),
    spec: base({
      panels: [
        panel({
          x: { grid: false, label: '연도', format: 'int' },
          y: { grid: true, zero: true, label: '발전 비중 (%)' },
          series: [
            { id: 's1', mark: 'area', x: '연도', y: '석탄', stack: 'a' },
            { id: 's2', mark: 'area', x: '연도', y: '가스', stack: 'a' },
            { id: 's3', mark: 'area', x: '연도', y: '재생', stack: 'a' },
          ],
        }),
      ],
    }),
  },
  {
    id: 'scatter',
    label: '산점도 · 추세선',
    group: '기본',
    data: (() => {
      const r = rng(7)
      const rows: (string | number)[][] = []
      for (let i = 0; i < 40; i++) {
        const x = +(1 + r() * 9).toFixed(2)
        rows.push([x, +(2.1 * x + 4 + (r() - 0.5) * 8).toFixed(2)])
      }
      return tsv(['농도', '흡광도'], rows)
    })(),
    spec: base({
      panels: [
        panel({
          x: { grid: true, label: '농도 (mM)' },
          y: { grid: true, label: '흡광도' },
          legend: { pos: 'none' },
          series: [
            { id: 's1', mark: 'scatter', x: '농도', y: '흡광도', marker: 'circle', trend: 'linear', trendLabel: true },
          ],
        }),
      ],
    }),
  },
  {
    id: 'bubble',
    label: '버블 차트',
    group: '기본',
    data: tsv(
      ['국가', 'GDP', '기대수명', '인구'],
      [
        ['한국', 33121, 83.5, 51],
        ['일본', 33834, 84.0, 124],
        ['미국', 76399, 76.4, 335],
        ['중국', 12720, 78.2, 1412],
        ['인도', 2411, 70.8, 1417],
        ['독일', 48717, 80.9, 84],
        ['브라질', 8918, 75.9, 215],
      ],
    ),
    spec: base({
      panels: [
        panel({
          x: { scale: 'log', grid: true, label: '1인당 GDP (US$)' },
          y: { grid: true, label: '기대수명 (년)' },
          legend: { pos: 'none' },
          series: [
            { id: 's1', mark: 'scatter', x: 'GDP', y: '기대수명', size: '인구', opacity: 0.75, markerSize: 5, text: '국가', labels: true },
          ],
        }),
      ],
    }),
  },
  {
    id: 'step',
    label: '계단 · 스템',
    group: '기본',
    data: tsv(
      ['t', '재고', '주문'],
      [
        [0, 120, 0],
        [1, 96, 30],
        [2, 78, 0],
        [3, 108, 45],
        [4, 84, 0],
        [5, 60, 20],
        [6, 44, 0],
      ],
    ),
    spec: base({
      panels: [
        panel({
          x: { grid: false, label: '주차', format: 'int' },
          y: { grid: true, zero: true },
          series: [
            { id: 's1', mark: 'step', x: 't', y: '재고' },
            { id: 's2', mark: 'stem', x: 't', y: '주문', marker: 'circle' },
          ],
        }),
      ],
    }),
  },
  {
    id: 'errorbar',
    label: '오차 막대',
    group: '기본',
    data: tsv(
      ['조건', '평균', '표준오차'],
      [
        ['대조군', 4.2, 0.35],
        ['처리 A', 6.8, 0.51],
        ['처리 B', 5.9, 0.28],
        ['처리 C', 8.1, 0.62],
      ],
    ),
    spec: base({
      panels: [
        panel({
          y: { grid: true, zero: true, label: '반응 속도 (μmol/s)' },
          legend: { pos: 'none' },
          series: [{ id: 's1', mark: 'bar', x: '조건', y: '평균', err: '표준오차' }],
        }),
      ],
    }),
  },
  {
    id: 'pie',
    label: '원 · 도넛',
    group: '기본',
    data: tsv(
      ['성분', '비율'],
      [
        ['질소', 78.1],
        ['산소', 20.9],
        ['아르곤', 0.93],
        ['이산화탄소', 0.04],
      ],
    ),
    spec: base({
      width: 560,
      panels: [
        panel({
          title: '건조 공기의 조성',
          legend: { pos: 'right', frame: false },
          series: [{ id: 's1', mark: 'pie', x: '성분', y: '비율', hole: 0.45 }],
        }),
      ],
    }),
  },

  /* ---- 통계 ---- */
  {
    id: 'histogram',
    label: '히스토그램',
    group: '통계',
    data: tsv(
      ['키'],
      normals(180, 171, 6.2, 11).map((v) => [+v.toFixed(1)]),
    ),
    spec: base({
      panels: [
        panel({
          x: { grid: false, label: '키 (cm)' },
          y: { grid: true, zero: true, label: '빈도' },
          legend: { pos: 'none' },
          series: [{ id: 's1', mark: 'histogram', y: '키', bins: 16 }],
        }),
      ],
    }),
  },
  {
    id: 'box',
    label: '상자 그림',
    group: '통계',
    data: (() => {
      const rows: (string | number)[][] = []
      const groups: [string, number, number, number][] = [
        ['대조군', 20, 4.2, 0.9],
        ['처리 A', 20, 6.8, 1.6],
        ['처리 B', 20, 5.9, 0.7],
        ['처리 C', 20, 8.1, 2.2],
      ]
      groups.forEach(([g, n, mu, sd], i) =>
        normals(n, mu, sd, 31 + i * 7).forEach((v) => rows.push([g, +v.toFixed(2)])),
      )
      return tsv(['조건', '값'], rows)
    })(),
    spec: base({
      panels: [
        panel({
          y: { grid: true, label: '반응 속도' },
          legend: { pos: 'none' },
          series: [{ id: 's1', mark: 'box', x: '조건', y: '값' }],
        }),
      ],
    }),
  },
  {
    id: 'violin',
    label: '바이올린',
    group: '통계',
    data: (() => {
      const rows: (string | number)[][] = []
      const groups: [string, number, number][] = [
        ['A', 5.0, 1.1],
        ['B', 6.4, 0.6],
        ['C', 5.6, 1.9],
      ]
      groups.forEach(([g, mu, sd], i) =>
        normals(60, mu, sd, 101 + i * 13).forEach((v) => rows.push([g, +v.toFixed(2)])),
      )
      return tsv(['그룹', '측정값'], rows)
    })(),
    spec: base({
      panels: [
        panel({
          y: { grid: true, label: '측정값' },
          legend: { pos: 'none' },
          series: [{ id: 's1', mark: 'violin', x: '그룹', y: '측정값' }],
        }),
      ],
    }),
  },

  /* ---- 필드 ---- */
  {
    id: 'heatmap',
    label: '히트맵',
    group: '필드',
    data: (() => {
      const labels = ['개', '고양이', '말', '새']
      const rows: (string | number)[][] = []
      const conf = [
        [92, 5, 2, 1],
        [7, 88, 3, 2],
        [3, 4, 90, 3],
        [1, 3, 4, 92],
      ]
      labels.forEach((t, i) => labels.forEach((p, j) => rows.push([p, t, conf[i][j]])))
      return tsv(['예측', '실제', '비율'], rows)
    })(),
    spec: base({
      width: 520,
      height: 440,
      panels: [
        panel({
          title: '혼동 행렬 (%)',
          x: { grid: false, label: '예측' },
          y: { grid: false, label: '실제' },
          legend: { pos: 'none' },
          series: [{ id: 's1', mark: 'heatmap', x: '예측', y: '실제', value: '비율', colorMap: 'blues', labels: true }],
        }),
      ],
    }),
  },
  {
    id: 'contour',
    label: '등고선',
    group: '필드',
    data: gridSample(['x', 'y', 'z'], 24, -3, 3, (x, y) => Math.sin(x) * Math.cos(y) * Math.exp(-(x * x + y * y) / 12)),
    spec: base({
      width: 560,
      height: 470,
      panels: [
        panel({
          x: { grid: false, label: 'x' },
          y: { grid: false, label: 'y' },
          legend: { pos: 'none' },
          series: [
            { id: 's1', mark: 'heatmap', x: 'x', y: 'y', value: 'z', colorMap: 'coolwarm' },
            { id: 's2', mark: 'contour', x: 'x', y: 'y', value: 'z', levels: 10, color: '#222222', width: 0.8 },
          ],
        }),
      ],
    }),
  },
  {
    id: 'quiver',
    label: '벡터장',
    group: '필드',
    data: (() => {
      const rows: (string | number)[][] = []
      for (let i = 0; i <= 10; i++)
        for (let j = 0; j <= 10; j++) {
          const x = -2 + (4 * i) / 10
          const y = -2 + (4 * j) / 10
          rows.push([+x.toFixed(2), +y.toFixed(2), +(-y).toFixed(3), +x.toFixed(3)])
        }
      return tsv(['x', 'y', 'u', 'v'], rows)
    })(),
    spec: base({
      width: 520,
      height: 470,
      panels: [
        panel({
          x: { grid: true, label: 'x' },
          y: { grid: true, label: 'y' },
          legend: { pos: 'none' },
          series: [{ id: 's1', mark: 'quiver', x: 'x', y: 'y', u: 'u', v: 'v' }],
        }),
      ],
    }),
  },

  /* ---- 지구과학 ---- */
  {
    id: 'climograph',
    label: '기후 그래프',
    group: '지구과학',
    data: tsv(
      ['월', '강수량', '기온'],
      [
        ['1월', 16.8, -1.9],
        ['2월', 28.2, 0.7],
        ['3월', 36.9, 6.1],
        ['4월', 72.9, 12.6],
        ['5월', 103.6, 17.8],
        ['6월', 129.5, 22.2],
        ['7월', 414.4, 24.9],
        ['8월', 348.2, 25.7],
        ['9월', 141.5, 21.2],
        ['10월', 52.2, 14.8],
        ['11월', 51.1, 7.2],
        ['12월', 22.6, 0.4],
      ],
    ),
    spec: base({
      width: 700,
      panels: [
        panel({
          title: '서울 평년값 (1991–2020)',
          x: { grid: false },
          y: { grid: true, zero: true, label: '강수량 (mm)' },
          y2: { label: '기온 (℃)', grid: false },
          legend: { pos: 'top-left', frame: true },
          series: [
            { id: 's1', mark: 'bar', x: '월', y: '강수량', name: '강수량' },
            { id: 's2', mark: 'line', x: '월', y: '기온', axis: 'right', marker: 'circle', name: '기온', color: '#C44E52' },
          ],
        }),
      ],
    }),
  },
  {
    id: 'ternary',
    label: '삼각 다이어그램',
    group: '지구과학',
    data: tsv(
      ['시료', '모래', '미사', '점토'],
      [
        ['A', 70, 20, 10],
        ['B', 45, 40, 15],
        ['C', 20, 45, 35],
        ['D', 33, 33, 34],
        ['E', 15, 25, 60],
        ['F', 80, 12, 8],
      ],
    ),
    spec: base({
      width: 560,
      height: 520,
      panels: [
        panel({
          coord: 'ternary',
          title: '토양 삼각도',
          ternaryLabels: ['모래', '미사', '점토'],
          legend: { pos: 'none' },
          series: [
            { id: 's1', mark: 'ternary', x: '모래', y: '미사', y2: '점토', text: '시료', labels: true, markerSize: 6 },
          ],
        }),
      ],
    }),
  },
  {
    id: 'rose',
    label: '로즈 다이어그램',
    group: '지구과학',
    data: tsv(
      ['방위', '빈도'],
      [
        [0, 42], [22.5, 31], [45, 25], [67.5, 18],
        [90, 14], [112.5, 11], [135, 16], [157.5, 22],
        [180, 29], [202.5, 35], [225, 48], [247.5, 61],
        [270, 74], [292.5, 66], [315, 55], [337.5, 47],
      ],
    ),
    spec: base({
      width: 520,
      height: 520,
      panels: [
        panel({
          coord: 'polar',
          title: '풍향 빈도',
          sectors: 16,
          polarStart: 90,
          polarClockwise: true,
          y: { label: '빈도 (일)' },
          legend: { pos: 'none' },
          series: [{ id: 's1', mark: 'rose', x: '방위', y: '빈도' }],
        }),
      ],
    }),
  },
  {
    id: 'hr',
    label: 'H–R 다이어그램',
    group: '지구과학',
    data: tsv(
      ['별', '표면온도', '광도'],
      [
        ['태양', 5772, 1],
        ['시리우스 A', 9940, 25.4],
        ['베텔게우스', 3600, 126000],
        ['리겔', 12100, 120000],
        ['베가', 9602, 40.1],
        ['프록시마', 3042, 0.0017],
        ['알데바란', 3910, 439],
        ['안타레스', 3660, 75900],
        ['스피카', 22400, 20500],
        ['바너드별', 3134, 0.0035],
        ['아크투루스', 4286, 170],
        ['데네브', 8525, 196000],
        ['알타이르', 7550, 10.6],
        ['폴룩스', 4666, 43],
        ['카펠라', 4970, 78.7],
        ['아케르나르', 15000, 3150],
        ['레굴루스', 12460, 316],
        ['카노푸스', 7400, 10700],
        ['벨라트릭스', 22000, 9211],
        ['알니람', 27000, 537000],
      ],
    ),
    spec: base({
      width: 620,
      height: 520,
      panels: [
        panel({
          title: 'H–R 다이어그램',
          x: { scale: 'log', reverse: true, grid: true, label: '표면 온도 (K)', format: 'int' },
          y: { scale: 'log', grid: true, label: '광도 (태양 = 1)' },
          legend: { pos: 'none' },
          series: [
            { id: 's1', mark: 'scatter', x: '표면온도', y: '광도', marker: 'circle', markerSize: 5, text: '별', labels: true },
          ],
        }),
      ],
    }),
  },
  {
    id: 'surface',
    label: '3D 표면',
    group: '지구과학',
    data: gridSample(['x', 'y', 'z'], 22, -6, 6, (x, y) => {
      const r = Math.hypot(x, y)
      return r < 1e-9 ? 1 : Math.sin(r) / r
    }),
    spec: base({
      width: 620,
      height: 500,
      panels: [
        panel({
          coord: 'proj3d',
          elev: 30,
          azim: -55,
          x: { label: 'x' },
          y: { label: 'y' },
          y2: { label: 'z' },
          legend: { pos: 'none' },
          series: [{ id: 's1', mark: 'surface', x: 'x', y: 'y', value: 'z', colorMap: 'viridis' }],
        }),
      ],
    }),
  },
  {
    id: 'scatter3d',
    label: '3D 산점도',
    group: '지구과학',
    data: (() => {
      const r = rng(23)
      const rows: (string | number)[][] = []
      for (let i = 0; i < 120; i++) {
        const t = (i / 120) * Math.PI * 4
        rows.push([
          +(Math.cos(t) * (1 + i / 90) + (r() - 0.5) * 0.3).toFixed(3),
          +(Math.sin(t) * (1 + i / 90) + (r() - 0.5) * 0.3).toFixed(3),
          +(i / 12 + (r() - 0.5) * 0.4).toFixed(3),
        ])
      }
      return tsv(['x', 'y', 'z'], rows)
    })(),
    spec: base({
      width: 600,
      height: 500,
      panels: [
        panel({
          coord: 'proj3d',
          elev: 22,
          azim: -60,
          x: { label: 'x' },
          y: { label: 'y' },
          y2: { label: 'z' },
          legend: { pos: 'none' },
          series: [{ id: 's1', mark: 'scatter3d', x: 'x', y: 'y', value: 'z', colorMap: 'plasma' }],
        }),
      ],
    }),
  },

  /* ---- 레이아웃 ---- */
  {
    id: 'radar',
    label: '레이더',
    group: '레이아웃',
    data: tsv(
      ['능력', '재원', '평균'],
      [
        ['속도', 82, 60],
        ['정확도', 91, 65],
        ['체력', 68, 62],
        ['집중', 88, 58],
        ['협업', 76, 70],
      ],
    ),
    spec: base({
      width: 520,
      height: 520,
      panels: [
        panel({
          coord: 'polar',
          title: '역량 비교',
          legend: { pos: 'bottom' },
          series: [
            { id: 's1', mark: 'radar', x: '능력', y: '재원' },
            { id: 's2', mark: 'radar', x: '능력', y: '평균' },
          ],
        }),
      ],
    }),
  },
  {
    id: 'subplots',
    label: '서브플롯 2×2',
    group: '레이아웃',
    data: tsv(
      ['x', 'A', 'B', 'C', 'D'],
      Array.from({ length: 24 }, (_, i) => {
        const x = i / 2
        return [
          +x.toFixed(2),
          +Math.sin(x).toFixed(3),
          +Math.cos(x * 0.7).toFixed(3),
          +(Math.exp(-x / 6) * Math.sin(x * 2)).toFixed(3),
          +(x / 12 - 0.4).toFixed(3),
        ]
      }),
    ),
    spec: base({
      width: 740,
      height: 520,
      columns: 2,
      shareX: true,
      panels: [
        { ...panel({}), id: 'p1', title: 'A', x: { grid: false }, y: { grid: true }, legend: { pos: 'none' }, series: [{ id: 'a', mark: 'line', x: 'x', y: 'A' }] },
        { ...panel({}), id: 'p2', title: 'B', x: { grid: false }, y: { grid: true }, legend: { pos: 'none' }, series: [{ id: 'b', mark: 'line', x: 'x', y: 'B' }] },
        { ...panel({}), id: 'p3', title: 'C', x: { grid: false }, y: { grid: true }, legend: { pos: 'none' }, series: [{ id: 'c', mark: 'area', x: 'x', y: 'C' }] },
        { ...panel({}), id: 'p4', title: 'D', x: { grid: false }, y: { grid: true }, legend: { pos: 'none' }, series: [{ id: 'd', mark: 'scatter', x: 'x', y: 'D', marker: 'circle' }] },
      ],
    }),
  },
]

export const presetById = (id: string): Preset => PRESETS.find((p) => p.id === id) ?? PRESETS[0]

export const PRESET_GROUPS = [...new Set(PRESETS.map((p) => p.group))]
