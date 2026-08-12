/* LaTeX ↔ 한글(HWP) 수식 스크립트.
 *
 * 한글의 수식 편집기는 LaTeX가 아니라 troff eqn 계열의 자체 문법을 쓴다. 명령어
 * 이름은 백슬래시 없이 그냥 낱말이고, 분수는 중위 연산자(`{a} over {b}`), 항의
 * 경계는 빈칸이며, `{}`는 항의 묶음이지 글자가 아니다. 그래서 치환표 하나로는
 * 옮길 수 없다 — `\frac{a}{b}`의 두 인자를 알아내려면 중괄호 짝을 세어야 하고,
 * `x^{2}`의 밑을 알아내려면 바로 앞 항이 어디서 시작하는지 알아야 한다. 그래서
 * 여기 있는 것은 정규식 뭉치가 아니라 작은 재귀 하강 파서다.
 *
 * 문법의 출처는 한컴이 공개한 "한글 문서 파일 형식 - 수식" revision 1.3과
 * 한컴오피스 도움말의 수식 명령어 문서다. 확실하지 않은 이름은 지어내지 않고
 * 경고로 넘긴다 — 한글이 모르는 낱말은 조용히 틀린 기호가 되는 게 아니라 그냥
 * 그 글자 그대로 찍히기 때문에, 사용자가 무엇을 손봐야 하는지 알려주는 편이
 * 낫다.
 *
 * ⚠️ 한글 수식에는 LaTeX의 `\{`에 해당하는 "글자로서의 중괄호"가 없다. 중괄호는
 * 언제나 묶음이고, 보이는 중괄호는 `LEFT {` … `RIGHT }`로만 나온다. 그래서 `\{`
 * 하나만 있어도 LEFT/RIGHT 쌍으로 옮긴다. 짝이 맞지 않으면 경고한다.
 *
 * 되돌리는 쪽(`hwpToLatex`)은 파일 아래쪽에 있다. 기호표는 앞의 것을 뒤집어
 * 쓰므로, 새 기호를 추가하면 양방향이 함께 따라온다. */

export interface HwpResult {
  /** 옮긴 결과 — 한글 수식 스크립트, 또는 LaTeX */
  out: string
  /** 사람이 손봐야 할 것들. 변환은 실패하지 않고, 최선을 낸 뒤 여기에 남긴다 */
  warnings: string[]
}

/* ---------- 기호표 ---------- */

/** 그리스 소문자 — 이름이 그대로 같다. */
const GREEK_LOWER = [
  'alpha', 'beta', 'gamma', 'delta', 'epsilon', 'zeta', 'eta', 'theta',
  'iota', 'kappa', 'lambda', 'mu', 'nu', 'xi', 'omicron', 'pi', 'rho',
  'sigma', 'tau', 'upsilon', 'phi', 'chi', 'psi', 'omega',
  'varepsilon', 'vartheta', 'varpi', 'varsigma', 'varphi', 'varupsilon',
]

/* 그리스 대문자는 첫 글자만 대문자. 한글 수식의 명령어는 대체로 대소문자를
   가리지 않지만, 스펙이 첫 글자를 대문자로 적어 둔 것들은 그렇게 적어야 한다고
   못박고 있다 — Delta와 delta가 다른 글자인 이상 당연한 일이다. */
const GREEK_UPPER = [
  'Gamma', 'Delta', 'Theta', 'Lambda', 'Xi', 'Pi', 'Sigma', 'Upsilon',
  'Phi', 'Psi', 'Omega',
]

/** 한글이 언제나 로만체로 뽑아 주는 기본 함수·약어. 이름이 그대로 같다. */
const FUNCS = [
  'sin', 'cos', 'tan', 'cot', 'sec', 'csc', 'cosec',
  'sinh', 'cosh', 'tanh', 'coth',
  'arcsin', 'arccos', 'arctan', 'arc',
  'log', 'ln', 'lg', 'exp', 'det', 'gcd', 'lcm', 'mod', 'max', 'min',
  'lim', 'hom', 'ker', 'deg', 'arg', 'dim', 'Pr',
]

/** 이름이 그대로 옮겨가는 기호들 — 한 방향 치환으로 끝나는 것만 여기 둔다. */
const SAME = [
  'times', 'div', 'circ', 'bullet', 'ast', 'star', 'partial', 'nabla',
  'oplus', 'ominus', 'otimes', 'odot', 'oslash', 'uplus', 'coprod',
  'vee', 'wedge', 'sqcup', 'sqcap', 'dagger', 'ddagger', 'diamond',
  'subset', 'supset', 'subseteq', 'supseteq',
  'sqsubset', 'sqsupset', 'sqsubseteq', 'sqsupseteq',
  'prec', 'succ', 'in', 'notin', 'sim', 'simeq', 'cong', 'approx',
  'asymp', 'propto', 'equiv', 'doteq', 'forall', 'therefore', 'because',
  'angle', 'triangle', 'prime', 'vdash', 'models', 'top', 'bot',
  'sum', 'prod', 'int', 'oint', 'cdots', 'mapsto',
  'uparrow', 'downarrow', 'nearrow', 'nwarrow', 'searrow', 'swarrow',
]

/** 이름이 달라지는 기호들. */
const RENAME: Record<string, string> = {
  /* 연산 · 관계 */
  pm: 'PLUSMINUS',
  mp: 'MINUSPLUS',
  cdot: 'cdot',
  le: 'leq',
  leq: 'leq',
  ge: 'geq',
  geq: 'geq',
  ne: 'neq',
  neq: 'neq',
  ll: '<<',
  gg: '>>',
  lll: 'LLL',
  ggg: '>>>',
  land: 'wedge',
  lor: 'vee',
  neg: 'LNOT',
  lnot: 'LNOT',
  ni: 'owns',
  owns: 'owns',
  setminus: 'RSLANT',
  backslash: 'RSLANT',
  perp: 'BOT',
  parallel: 'VERT',
  infty: 'inf',
  emptyset: 'EMPTYSET',
  varnothing: 'EMPTYSET',
  exists: 'EXIST',
  bigcirc: 'BIGCIRC',

  /* 큰 연산자 — 한글은 첨자가 붙는 큰 기호와 줄 안에 놓이는 작은 기호를
     이름으로 구분한다. SMALL을 앞에 붙이면 첨자 없는 작은 쪽이 된다. */
  cup: 'SMALLUNION',
  cap: 'SMALLINTER',
  bigcup: 'UNION',
  bigcap: 'INTER',
  bigvee: 'vee',
  bigwedge: 'wedge',
  bigodot: 'odot',
  bigoplus: 'oplus',
  bigotimes: 'otimes',
  iint: 'DINT',
  iiint: 'TINT',

  /* 화살표 — 홑화살표는 한글에서도 ->, <-, <->로 쓰고, 겹화살표는 이름이
     따로 있다. `<=`는 한글에서 ≤로 읽힐 여지가 있어 쓰지 않는다. */
  to: '->',
  rightarrow: '->',
  gets: '<-',
  leftarrow: '<-',
  leftrightarrow: '<->',
  longrightarrow: '->',
  longleftarrow: '<-',
  longleftrightarrow: '<->',
  Rightarrow: 'RARROW',
  Leftarrow: 'LARROW',
  Leftrightarrow: 'LRARROW',
  implies: 'RARROW',
  impliedby: 'LARROW',
  iff: 'LRARROW',
  Longrightarrow: 'RARROW',
  Longleftarrow: 'LARROW',
  Longleftrightarrow: 'LRARROW',
  updownarrow: 'udarrow',
  Uparrow: 'UPARROW',
  Downarrow: 'DOWNARROW',
  Updownarrow: 'UDARROW',
  hookleftarrow: 'hookleft',
  hookrightarrow: 'hookright',

  /* 기타 */
  ldots: 'LDOTS',
  dots: 'LDOTS',
  dotsc: 'LDOTS',
  vdots: 'VDOTS',
  ddots: 'DDOTS',
  aleph: 'ALEPH',
  hbar: 'HBAR',
  imath: 'IMATH',
  jmath: 'JMATH',
  ell: 'ELL',
  wp: 'WP',
  Im: 'IMAG',
  measuredangle: 'MSANGLE',
  sphericalangle: 'SANGLE',
  triangledown: 'TRIANGLED',
  bigtriangledown: 'TRIANGLED',
  bigtriangleup: 'TRIANGLE',
  degree: 'DEG',
  celsius: 'CENTIGRADE',
  AA: 'ANGSTROM',
  angstrom: 'ANGSTROM',
  /* ⚠️ `\xor`는 LaTeX 명령이 아니다. 되돌릴 때 이 표를 뒤집으므로 여기 적힌
     이름이 곧 LaTeX 출력이 된다 — 먼저 적힌 진짜 이름이 이겨야 한다. */
  veebar: 'XOR',
  xor: 'XOR',
  oiint: 'ODINT',
  oiiint: 'OTINT',
  fallingdotseq: 'image',
  risingdotseq: 'REIMAGE',
  Bumpeq: 'ISO',
  dotplus: 'DSUM',
  dashv: 'DASHV',
  diagup: 'LSLANT',
  diagdown: 'RSLANT',
}

/** 글자 장식 — 한글도 명령어를 앞에 두고 대상을 뒤에 쓴다.
 *
 *  뒤쪽 넷(dyad·BOX·OVERBRACE·UNDERBRACE)은 한컴 스펙의 표에는 없고, 실제 HWP
 *  문서에서 뽑아 만든 OpenBapul/hml-equation-parser의 변환표에 있다. 스펙이
 *  스스로 "주요한" 명령어만 다룬다고 밝히고 있으니, 실물에서 확인된 이름은
 *  받아들인다. */
const ACCENT: Record<string, string> = {
  hat: 'hat',
  widehat: 'hat',
  bar: 'bar',
  overline: 'bar',
  vec: 'vec',
  overrightarrow: 'vec',
  dot: 'dot',
  ddot: 'ddot',
  tilde: 'tilde',
  widetilde: 'tilde',
  acute: 'acute',
  grave: 'grave',
  check: 'check',
  breve: 'arch',
  underline: 'under',
  underbar: 'under',
  overleftrightarrow: 'dyad',
  boxed: 'BOX',
  overbrace: 'OVERBRACE',
  underbrace: 'UNDERBRACE',
}

/** 빈칸. 한글은 `~`가 한 칸, 백틱이 그 1/4이다. */
const SPACING: Record<string, string> = {
  ',': '`',
  ':': '``',
  ';': '``',
  ' ': '~',
  quad: '~',
  qquad: '~~',
  enspace: '`',
  thinspace: '`',
  medspace: '``',
  thickspace: '~',
  nobreakspace: '~',
}

/** 아무것도 만들지 않고 사라지는 것들 — 조판 지시나 번호 매기기. */
const DROP = new Set([
  'displaystyle', 'textstyle', 'scriptstyle', 'scriptscriptstyle',
  'limits', 'nolimits', 'nonumber', 'notag', 'noalign',
  'bigl', 'bigr', 'Bigl', 'Bigr', 'biggl', 'biggr',
  'Biggl', 'Biggr', 'big', 'Big', 'bigg', 'Bigg', 'middle',
  'mathstrut', 'strut', 'relax', '!',
])

/** 환경 이름 → 한글의 묶음 명령어. */
const ENV: Record<string, string> = {
  matrix: 'matrix',
  smallmatrix: 'matrix',
  pmatrix: 'pmatrix',
  bmatrix: 'bmatrix',
  vmatrix: 'dmatrix',
  Vmatrix: 'dmatrix',
  Bmatrix: 'matrix',
  array: 'matrix',
  cases: 'cases',
  dcases: 'cases',
  rcases: 'cases',
  aligned: 'eqalign',
  align: 'eqalign',
  alignat: 'eqalign',
  alignedat: 'eqalign',
  eqnarray: 'eqalign',
  split: 'eqalign',
  gathered: 'pile',
  gather: 'pile',
  multline: 'pile',
}

/** 감싸기만 하고 사라지는 환경 — 안쪽 내용이 곧 수식이다. */
const BARE_ENV = new Set(['equation', 'displaymath', 'math', 'eqnarray*'])

/** `\textcolor{red}{…}`용. 한글의 COLOR는 R,G,B 값을 직접 받는다. */
const COLORS: Record<string, string> = {
  black: '0,0,0',
  white: '255,255,255',
  red: '255,0,0',
  green: '0,128,0',
  blue: '0,0,255',
  cyan: '0,255,255',
  magenta: '255,0,255',
  yellow: '255,255,0',
  orange: '255,145,0',
  purple: '120,40,200',
  gray: '128,128,128',
  grey: '128,128,128',
  pink: '255,78,186',
  brown: '150,75,0',
}

/* ---------- 낱말 나누기 ---------- */

interface Tok {
  t: 'cmd' | 'ch' | 'open' | 'close' | 'sup' | 'sub' | 'amp' | 'nl' | 'sp'
  v: string
  /** 원본에서의 시작·끝 위치. `\text{…}` 처럼 안쪽을 글자 그대로 읽어야 하는
   *  명령어가 원본을 다시 잘라 쓴다. */
  i: number
  j: number
}

function lex(src: string): Tok[] {
  const out: Tok[] = []
  let i = 0
  while (i < src.length) {
    const c = src[i]
    if (/\s/.test(c)) {
      let j = i
      while (j < src.length && /\s/.test(src[j])) j++
      out.push({ t: 'sp', v: ' ', i, j })
      i = j
      continue
    }
    if (c === '\\') {
      const name = /^[A-Za-z]+/.exec(src.slice(i + 1))
      if (name) {
        out.push({ t: 'cmd', v: name[0], i, j: i + 1 + name[0].length })
        i += 1 + name[0].length
      } else {
        const ch = src[i + 1] ?? ''
        out.push({ t: ch === '\\' ? 'nl' : 'cmd', v: ch, i, j: i + 2 })
        i += 2
      }
      continue
    }
    const t: Tok['t'] =
      c === '{' ? 'open'
        : c === '}' ? 'close'
          : c === '^' ? 'sup'
            : c === '_' ? 'sub'
              : c === '&' ? 'amp'
                : 'ch'
    out.push({ t, v: c, i, j: i + 1 })
    i++
  }
  return out
}

/* ---------- 항 ---------- */

interface Term {
  s: string
  /** 첨자의 밑이나 over의 분자로 그대로 쓸 수 있는가 — 아니면 중괄호로 묶는다 */
  atomic: boolean
  /** 앞의 항에 빈칸 없이 붙여도 되는가 */
  tightLeft?: boolean
  /** 뒤의 항이 빈칸 없이 붙어도 되는가 */
  tightRight?: boolean
  /** 원본에서 이 항 앞에 빈칸이 있었는가 */
  gap?: boolean
  /** 첨자를 중괄호로 싸지 말고 옆에 이어 붙일 항.
   *
   *  두 가지가 여기 해당한다. 하나는 이미 첨자가 달린 항 — `x_1^2`는 `x_1`
   *  전체의 제곱이 아니라 x에 첨자 둘이 붙은 것이라 `x _{1} ^{2}`로 늘어놓아야
   *  한다. 다른 하나는 `RIGHT }` 같은 괄호 항 — `{RIGHT }}`로 싸 버리면 닫는
   *  중괄호가 묶음 기호로 읽혀 수식이 통째로 깨진다. */
  flat?: boolean
}

const wrap = (t: Term): string => (t.atomic ? t.s : `{${t.s}}`)

/* 한글 수식에서 빈칸은 항의 경계일 뿐 화면에 나오지 않는다. 넉넉히 띄워도
 * 결과는 같으므로 명령어 사이는 항상 띄운다. 다만 글자들까지 다 띄워 버리면
 * `(X,Y)`가 `( X , Y )`가 되어 읽을 수 없으니, 원본에서 붙어 있던 글자는
 * 붙여 두고 원본에 있던 빈칸은 그대로 살린다. 결과가 원본과 같은 모양으로
 * 읽혀야 사용자가 어디를 고칠지 찾을 수 있다. */
function join(terms: Term[]): string {
  let out = ''
  let openRight = false
  for (const t of terms) {
    if (!t.s) continue
    if (out) out += openRight && t.tightLeft && !t.gap ? '' : ' '
    out += t.s
    openRight = !!t.tightRight
  }
  return out
}

/* ---------- 본체 ---------- */

/** 수식만 남기고 겉의 구분자를 벗긴다 — 붙여넣기는 보통 `$…$`째로 들어온다.
 *
 *  `$a$ = $b$`처럼 달러가 여러 쌍이면 벗기지 않는다. 맨 앞과 맨 끝이 달러라는
 *  것만 보고 잘라내면 가운데의 텍스트를 수식 안으로 끌고 들어오게 된다. */
function strip(src: string): string {
  let s = src.trim()
  for (;;) {
    const dollar = /^\$\$([\s\S]*)\$\$$/.exec(s) ?? /^\$([\s\S]*)\$$/.exec(s)
    if (dollar && !dollar[1].includes('$')) {
      s = dollar[1].trim()
      continue
    }
    const bracket = /^\\\[([\s\S]*)\\\]$/.exec(s) ?? /^\\\(([\s\S]*)\\\)$/.exec(s)
    if (bracket) {
      s = bracket[1].trim()
      continue
    }
    return s
  }
}

export function latexToHwp(source: string): HwpResult {
  const src = strip(source)
  const toks = lex(src)
  const warns: string[] = []
  const seen = new Set<string>()
  let p = 0
  /** 짝이 맞는지 보려고 세어 둔다 — `\{` 하나만 쓰면 한글에서는 깨진다 */
  let opened = 0
  let closed = 0

  const warn = (m: string) => {
    if (seen.has(m)) return
    seen.add(m)
    warns.push(m)
  }

  const peek = (): Tok | undefined => toks[p]
  /** 빈칸을 건너뛰고, 실제로 건너뛴 것이 있었는지 알려준다 */
  const skipSp = (): boolean => {
    const from = p
    while (toks[p] && toks[p].t === 'sp') p++
    return p !== from
  }

  /* --- 원본 조각 읽기 (글자 그대로 다뤄야 하는 인자) --- */

  function rawGroup(): string {
    skipSp()
    const head = peek()
    if (!head) return ''
    if (head.t !== 'open') {
      p++
      return src.slice(head.i, head.j)
    }
    p++
    const start = head.j
    let depth = 1
    let end = start
    while (p < toks.length) {
      const t = toks[p]
      if (t.t === 'open') depth++
      else if (t.t === 'close') {
        depth--
        if (depth === 0) {
          end = t.i
          p++
          break
        }
      }
      end = t.j
      p++
    }
    return src.slice(start, end)
  }

  /* --- 글자 그대로의 본문 --- */

  /* 한글 수식은 한 낱말이 9자를 넘으면 두 항으로 쪼개 버린다. 그래서 긴 낱말은
     따옴표로 묶어야 하나로 남는다. 빈칸도 화면에 나오지 않으므로 `~`로 바꾼다. */
  function literal(raw: string): string {
    if (raw.includes('"')) warn('본문 안의 큰따옴표는 한글 수식에서 낱말 묶음 기호라 지웠습니다')
    const words = raw.replace(/"/g, '').split(/\s+/).filter(Boolean)
    if (!words.length) return ''
    return words
      .map((w) => (/^[A-Za-z0-9]{1,8}$/.test(w) ? w : `"${w}"`))
      .join('~')
  }

  /** 글꼴을 바꾼 본문 한 덩어리. 한글의 rm·bold는 그 자리부터 끝까지 걸리는
   *  모드 전환이라, 중괄호로 묶어 그 안에서만 살게 한다. */
  function styled(font: string, raw: string): Term {
    const body = literal(raw)
    return body ? { s: `{${font} ${body}}`, atomic: true } : { s: '', atomic: true }
  }

  /* --- 괄호 --- */

  /* 한글의 LEFT·RIGHT는 글자 하나를 괄호로 받는다. 이름이 있는 것도 있지만
     꺾쇠·바닥·천장은 그냥 그 유니코드 글자를 쓴다 — 한글이 스스로 내보내는
     문자열도 `LEFT ⌊`처럼 생겼다. */
  const DELIM_CMD: Record<string, string> = {
    '{': '{', '}': '}',
    lbrace: '{', rbrace: '}',
    lbrack: '[', rbrack: ']',
    vert: '|', '|': 'VERT', Vert: 'VERT',
    backslash: 'RSLANT',
    uparrow: 'uparrow', downarrow: 'downarrow',
    langle: '⟨', rangle: '⟩',
    lfloor: '⌊', rfloor: '⌋',
    lceil: '⌈', rceil: '⌉',
  }

  const DELIM_CH = '()[]|./<>⟨⟩⌊⌋⌈⌉'

  function delim(): string {
    skipSp()
    const t = peek()
    if (!t) return '.'
    p++
    if (t.t === 'ch') {
      if (DELIM_CH.includes(t.v)) return t.v
      warn(`괄호로 쓸 수 없는 글자 "${t.v}"가 있어 빈 괄호로 두었습니다`)
      return '.'
    }
    if (t.t === 'cmd') {
      const mapped = DELIM_CMD[t.v]
      if (mapped) return mapped
    }
    p--
    return '.'
  }

  /* --- 이어붙이기 --- */

  type Stop = (t: Tok) => boolean

  function parseSeq(stop: Stop): Term[] {
    const out: Term[] = []
    for (;;) {
      const spaced = skipSp()
      const t = peek()
      if (!t || stop(t)) break
      if (t.t === 'sup' || t.t === 'sub') {
        p++
        const op = t.t === 'sup' ? '^' : '_'
        const arg = parseAtom()
        const base = out.pop()
        if (!base) {
          out.push({ s: `${op}${wrap(arg)}`, atomic: false, flat: true, gap: spaced })
          continue
        }
        const head = base.flat ? base.s : wrap(base)
        out.push({
          s: `${head} ${op}${wrap(arg)}`,
          atomic: false,
          flat: true,
          // 첨자가 붙어도 앞쪽 이음매는 밑이 정하던 그대로다
          tightLeft: base.tightLeft,
          gap: base.gap,
        })
        continue
      }
      const term = parseAtom()
      if (term.s) out.push(spaced ? { ...term, gap: true } : term)
    }
    return out
  }

  const atEnd: Stop = (t) => t.t === 'cmd' && t.v === 'end'
  const atClose: Stop = (t) => t.t === 'close'

  function group(): Term {
    const inner = parseSeq(atClose)
    if (peek()?.t === 'close') p++
    return { s: `{${join(inner)}}`, atomic: true }
  }

  function parseAtom(): Term {
    skipSp()
    const t = peek()
    if (!t) return { s: '', atomic: true }
    p++
    switch (t.t) {
      case 'open':
        return group()
      case 'close':
        /* 짝 없는 닫는 중괄호. 삼켜야 한다 — 되돌려 놓으면 같은 자리를 다시
           읽으면서 제자리를 돈다. */
        return { s: '', atomic: true }
      case 'sup':
      case 'sub':
        p-- // 인자 자리에서 만날 것이 아니다. parseSeq가 처리하게 되돌린다
        return { s: '', atomic: true }
      /* 줄바꿈과 칸 맞춤은 한 글자짜리 기호다. 양옆을 붙일 수 있게 두면
         `a &= b`의 원본 띄어쓰기가 그대로 살아남는다. */
      case 'nl':
        return { s: '#', atomic: true, tightLeft: true, tightRight: true }
      case 'amp':
        return { s: '&', atomic: true, tightLeft: true, tightRight: true }
      case 'sp':
        return { s: '', atomic: true }
      case 'ch':
        return charTerm(t.v)
      case 'cmd':
        return cmdTerm(t.v)
    }
  }

  function charTerm(c: string): Term {
    if (c === "'") return { s: 'prime', atomic: true }
    if (c === '|') return { s: 'vert', atomic: true }
    if (c === '"') {
      warn('본문 안의 큰따옴표는 한글 수식에서 낱말 묶음 기호라 지웠습니다')
      return { s: '', atomic: true }
    }
    return { s: c, atomic: true, tightLeft: true, tightRight: true }
  }

  /* --- 명령어 --- */

  function cmdTerm(name: string): Term {
    /* 구조부터. 인자를 먹는 것들이라 표로 처리할 수 없다. */
    switch (name) {
      case 'frac':
      case 'dfrac':
      case 'tfrac':
      case 'cfrac': {
        const a = parseAtom()
        const b = parseAtom()
        return { s: `${wrap(a)} over ${wrap(b)}`, atomic: false }
      }
      case 'binom':
      case 'dbinom':
      case 'tbinom': {
        const a = parseAtom()
        const b = parseAtom()
        return { s: `${wrap(a)} CHOOSE ${wrap(b)}`, atomic: false }
      }
      case 'atop':
      case 'over':
      case 'choose':
        /* 평문 TeX의 중위 연산자. 한글도 같은 자리에 같은 이름을 쓴다. */
        return { s: name === 'choose' ? 'CHOOSE' : name, atomic: false }
      case 'sqrt': {
        skipSp()
        let index: Term | null = null
        const nx = peek()
        if (nx && nx.t === 'ch' && nx.v === '[') {
          p++
          const inner = parseSeq((x) => x.t === 'ch' && x.v === ']')
          if (peek()) p++
          index = { s: join(inner), atomic: false }
        }
        const body = parseAtom()
        /* 앞의 백틱은 지수와 근호 사이를 좁히는 1/4 빈칸 — 한컴 예제가 쓰는 꼴 */
        return index
          ? { s: `\`^${wrap(index)} sqrt ${wrap(body)}`, atomic: false }
          : { s: `sqrt ${wrap(body)}`, atomic: false }
      }
      case 'left':
      case 'right': {
        const d = delim()
        if (name === 'left') opened++
        else closed++
        return {
          s: `${name === 'left' ? 'LEFT' : 'RIGHT'} ${d}`,
          atomic: false,
          flat: true,
          /* 괄호 글자로 끝나므로 다음 글자를 바로 붙여도 된다 — 중괄호만
             빼고. `LEFT {G`처럼 붙여 놓으면 한글이 그 중괄호를 괄호가 아니라
             묶음의 시작으로 읽어 버릴 여지가 있다. */
          tightRight: d !== '{' && d !== '}',
        }
      }
      case '{':
      case '}': {
        /* 한글에는 글자로서의 중괄호가 없다 — 보이는 중괄호는 LEFT/RIGHT뿐이다 */
        if (name === '{') opened++
        else closed++
        return { s: name === '{' ? 'LEFT {' : 'RIGHT }', atomic: false, flat: true }
      }
      case 'text':
      case 'textrm':
      case 'mathrm':
      case 'operatorname':
      case 'mathop':
        return styled('rm', rawGroup())
      case 'textbf':
      case 'mathbf':
        return styled('rmbold', rawGroup())
      case 'bm':
      case 'boldsymbol':
      case 'pmb':
        return { s: `bold ${wrap(parseAtom())}`, atomic: false }
      case 'textit':
      case 'mathit':
      case 'emph':
        return styled('it', rawGroup())
      case 'mathsf':
      case 'mathtt':
      case 'texttt':
      case 'textsf':
        warn('한글 수식에는 산세리프·고정폭 수식 글꼴이 없어 로만체로 바꿨습니다')
        return styled('rm', rawGroup())
      case 'mathbb':
        warn('칠판체(\\mathbb)는 한글 수식에 없어 굵은 로만체로 바꿨습니다')
        return styled('rmbold', rawGroup())
      case 'mathcal':
      case 'mathscr': {
        const raw = rawGroup().trim()
        /* ℒ만은 한글에 진짜 글자가 있다 — 라플라스 변환 기호로 들어 있다 */
        if (raw === 'L') return { s: 'LAPLACE', atomic: true }
        warn('필기체(\\mathcal)는 한글 수식에 없어 그냥 로만체로 바꿨습니다')
        return styled('rm', raw)
      }
      case 'mathfrak':
        warn('프락투어체(\\mathfrak)는 한글 수식에 없어 그냥 로만체로 바꿨습니다')
        return styled('rm', rawGroup())
      case 'textcolor':
      case 'color': {
        const key = rawGroup().trim().toLowerCase()
        const rgb = COLORS[key]
        if (!rgb) {
          warn(`색 이름 "${key}"를 몰라 색을 빼고 옮겼습니다`)
          return name === 'color' ? { s: '', atomic: true } : parseAtom()
        }
        if (name === 'color') {
          warn('\\color는 뒤쪽 전체에 걸리는 명령이라 옮기지 못했습니다 — \\textcolor를 쓰세요')
          return { s: '', atomic: true }
        }
        return { s: `{COLOR {${rgb}} ${wrap(parseAtom())}}`, atomic: true }
      }
      case 'begin':
        return envTerm(rawGroup().trim())
      case 'end':
        rawGroup()
        return { s: '', atomic: true }
      case 'not': {
        /* 한글의 not은 바로 뒤 글자에 사선을 긋는다 — LaTeX와 같은 자리다 */
        return { s: 'not', atomic: true }
      }
      case 'stackrel':
      case 'overset': {
        const top = parseAtom()
        const base = parseAtom()
        warn('\\stackrel·\\overset은 한글에서 위아래 쌓기(atop)로만 흉내 냈습니다 — 윗글자가 작아지지 않습니다')
        return { s: `${wrap(top)} atop ${wrap(base)}`, atomic: false }
      }
      case 'underset': {
        const bottom = parseAtom()
        const base = parseAtom()
        warn('\\underset은 한글에서 위아래 쌓기(atop)로만 흉내 냈습니다 — 아랫글자가 작아지지 않습니다')
        return { s: `${wrap(base)} atop ${wrap(bottom)}`, atomic: false }
      }
      case 'phantom':
      case 'hphantom':
      case 'vphantom':
        parseAtom()
        warn(`\\${name}는 한글 수식에 대응이 없어 지웠습니다`)
        return { s: '', atomic: true }
      case 'substack': {
        /* 안쪽의 `\\`는 이미 #으로 바뀌어 나온다. 한글에서 그 줄들을 실제로
           쌓아 주는 것은 pile이다. */
        const body = parseAtom()
        return { s: `pile${wrap(body)}`, atomic: true }
      }
      case 'label':
      case 'tag':
      case 'ref':
      case 'eqref':
        rawGroup()
        return { s: '', atomic: true }
      case 'sup':
        /* LaTeX의 상한(supremum). 한글에서 sup은 윗첨자 명령이라 그대로 두면 안 된다 */
        return { s: '{rm sup}', atomic: true }
      case 'inf':
        warn('\\inf(하한)를 로만체 inf로 옮겼습니다 — 한글의 inf는 무한대 기호입니다')
        return { s: '{rm inf}', atomic: true }
      case 'liminf':
      case 'limsup':
        return { s: `lim {rm ${name.slice(3)}}`, atomic: false }
      case 'bmod':
      case 'pmod':
        return { s: 'mod', atomic: true }
      case 'Re':
        warn('\\Re(실수부 ℜ)는 한글 수식에 없어 로만체 Re로 두었습니다')
        return { s: '{rm Re}', atomic: true }
      case 'nexists':
        warn('\\nexists(∄)는 한글 수식에 없어 not EXIST로 옮겼습니다')
        return { s: 'not EXIST', atomic: false }
    }

    if (ACCENT[name]) {
      const body = wrap(parseAtom())
      return body
        ? { s: `${ACCENT[name]} ${body}`, atomic: false }
        : { s: ACCENT[name], atomic: true }
    }
    if (SPACING[name] !== undefined) return { s: SPACING[name], atomic: true }
    if (DROP.has(name)) return { s: '', atomic: true }
    if (RENAME[name]) return { s: RENAME[name], atomic: true }
    if (GREEK_LOWER.includes(name)) return { s: name, atomic: true }
    if (GREEK_UPPER.includes(name)) return { s: name, atomic: true }
    if (FUNCS.includes(name)) return { s: name, atomic: true }
    if (SAME.includes(name)) return { s: name, atomic: true }

    /* 한 글자짜리 이스케이프 — `\%`처럼 LaTeX에서만 특별한 글자들 */
    if (name.length === 1 && !/[A-Za-z]/.test(name)) {
      if (name === '#') {
        warn('\\#는 한글 수식에서 줄바꿈 기호라 그대로 쓸 수 없습니다')
        return { s: '', atomic: true }
      }
      if (name === '&') {
        warn('\\&는 한글 수식에서 칸 맞춤 기호라 그대로 쓸 수 없습니다')
        return { s: '', atomic: true }
      }
      if (name === '_') return { s: '', atomic: true }
      return { s: name, atomic: true, tightLeft: true, tightRight: true }
    }

    warn(`\\${name}은(는) 대응하는 한글 명령어를 찾지 못해 이름 그대로 두었습니다`)
    return { s: name, atomic: true }
  }

  /* --- 환경 --- */

  function envTerm(name: string): Term {
    /* array·tabular는 열 정렬을 인자로 받는다 — 한글에는 없으니 버린다 */
    if (name === 'array' || name === 'tabular' || name.startsWith('alignat')) {
      skipSp()
      if (peek()?.t === 'open') rawGroup()
    }
    const body = join(parseSeq(atEnd))
    if (peek()?.t === 'cmd' && peek()?.v === 'end') {
      p++
      rawGroup()
    }
    const key = name.replace(/\*$/, '')
    if (BARE_ENV.has(name) || BARE_ENV.has(key)) return { s: body, atomic: false }
    const cmd = ENV[key]
    if (!cmd) {
      warn(`\\begin{${name}} 환경은 대응이 없어 내용만 남겼습니다`)
      return { s: body, atomic: false }
    }
    if (key === 'Vmatrix') warn('겹세로줄 행렬(Vmatrix)은 한글에 없어 홑세로줄(dmatrix)로 바꿨습니다')
    if (key === 'Bmatrix') warn('중괄호 행렬(Bmatrix)은 한글에 없어 괄호 없는 행렬로 바꿨습니다')
    return { s: `${cmd}{${body}}`, atomic: true }
  }

  /* --- 실행 --- */

  const out = join(parseSeq(() => false))
  if (opened !== closed)
    warn('여는 괄호와 닫는 괄호의 수가 다릅니다 — 한글 수식은 LEFT와 RIGHT가 짝이 맞아야 합니다')

  return { out, warnings: warns }
}

/* ==================================================================
 * 한글(HWP) 수식 스크립트 → LaTeX
 * ================================================================== */

/* 되돌리는 쪽은 앞과 대칭이 아니다. 세 가지가 다르다.
 *
 * 1. `over`는 **중위** 연산자이고, 양옆에서 정확히 한 항씩만 가져간다. 한컴
 *    예제의 `10a^3 over b^2 times □`가 (10a³/b²)×□로 나오는 것이 그 증거다 —
 *    분모는 `b^2`에서 끝나고 `times`까지 삼키지 않는다. 그래서 여러 항을 쓰려면
 *    중괄호로 묶어야 하고, 되돌릴 때는 앞뒤 한 항씩만 집으면 된다.
 *
 * 2. 모르는 낱말에 경고하지 않는다. 한글에서 `abc`는 그냥 기울임체 글자 셋이지
 *    빠진 명령어가 아니다. 되돌릴 때 모르는 낱말은 거의 언제나 사용자의 변수
 *    이름이므로 그대로 내보낸다. 진짜로 LaTeX에 대응이 없는 것들(LADDER,
 *    LONGDIV, REL 같은)만 이름을 알고 있으니 그것만 경고한다.
 *
 * 3. LaTeX는 수식 안의 빈칸을 무시한다. 그래서 빈칸을 잘못 넣어 결과가 깨질
 *    일은 없고, 붙이고 띄우는 것은 순전히 읽기 좋으라고 하는 일이다. */

/** 대소문자가 뜻을 가르는 이름들 — [모두 소문자일 때, 대문자가 섞였을 때].
 *
 *  한글은 명령어 대소문자를 대체로 가리지 않지만 이것들은 예외다. 규칙은
 *  "모두 소문자면 작은 쪽, 대문자가 하나라도 있으면 큰 쪽" — 한글이 스스로
 *  내보내는 문자열이 `NABLA`와 `Partial`을 섞어 쓰는 것과 같은 규칙이다. */
const CASED: Record<string, [string, string]> = {
  larrow: ['\\leftarrow', '\\Leftarrow'],
  rarrow: ['\\rightarrow', '\\Rightarrow'],
  lrarrow: ['\\leftrightarrow', '\\Leftrightarrow'],
  uparrow: ['\\uparrow', '\\Uparrow'],
  downarrow: ['\\downarrow', '\\Downarrow'],
  udarrow: ['\\updownarrow', '\\Updownarrow'],
  vert: ['|', '\\|'],
  deg: ['\\deg', '^{\\circ}'],
}

/** 그리스 소문자 이름의 대문자 짝. 대문자 글리프가 로마자와 같은 것은 그 글자를
 *  그대로 쓴다 — `\Alpha`는 LaTeX에 없다. */
const GREEK_CAP: Record<string, string> = {
  gamma: '\\Gamma', delta: '\\Delta', theta: '\\Theta', lambda: '\\Lambda',
  xi: '\\Xi', pi: '\\Pi', sigma: '\\Sigma', upsilon: '\\Upsilon',
  phi: '\\Phi', psi: '\\Psi', omega: '\\Omega',
  alpha: 'A', beta: 'B', epsilon: 'E', zeta: 'Z', eta: 'H', iota: 'I',
  kappa: 'K', mu: 'M', nu: 'N', omicron: 'O', rho: 'P', tau: 'T', chi: 'X',
}

/** 앞의 표를 뒤집을 때 골라야 하는 것들.
 *
 *  LaTeX 이름이 여럿인 기호(`\le`와 `\leq`)는 표를 뒤집으면 먼저 적힌 쪽이
 *  이기는데, 그게 늘 읽기 좋은 이름은 아니다. 여기서 덮어쓴다. */
const REV_FIX: Record<string, string> = {
  leq: '\\leq',
  geq: '\\geq',
  neq: '\\neq',
  inf: '\\infty',
  lnot: '\\neg',
  bot: '\\perp',
  exist: '\\exists',
  /* IDENTICAL은 ≡가 아니라 비례식의 ∷다. 대응하는 LaTeX 명령이 없어 글자를
     그대로 쓴다 — ≡로 옮기면 조용히 다른 뜻이 된다. */
  identical: '\\mathrel{∷}',
  divide: '\\div',
  plusminus: '\\pm',
  minusplus: '\\mp',
  ldots: '\\ldots',
  laplace: '\\mathcal{L}',
  emptyset: '\\emptyset',
  /* 스펙의 기호표는 CAP을 ∪로 적어 두었지만, 그 문서의 워크된 예제와 실무
     자료가 모두 cap을 ∩로 쓴다. 사람들이 쓰는 쪽을 따른다. */
  cap: '\\cap',
  cup: '\\cup',
  smallunion: '\\cup',
  smallinter: '\\cap',
  smallprod: '\\prod',
  union: '\\bigcup',
  inter: '\\bigcap',
  prod: '\\prod',
  sum: '\\sum',
  dint: '\\iint',
  tint: '\\iiint',
  odint: '\\oiint',
  otint: '\\oiiint',
  prime: "'",
  lim: '\\lim',
  centigrade: '{}^{\\circ}\\mathrm{C}',
  fahrenheit: '{}^{\\circ}\\mathrm{F}',
  /* 한글이 언제나 로만체로 뽑아 주는 예약어. LaTeX에는 같은 이름의 명령이
     없으므로 로만체 묶음으로 옮긴다 — 두면 기울임체 변수 셋이 되어 버린다. */
  if: '\\mathrm{if}',
  for: '\\mathrm{for}',
  and: '\\mathrm{and}',
  or: '\\mathrm{or}',
}

/** 한글에는 있지만 LaTeX에 대응이 없는 명령어. 이름을 아니까 경고할 수 있다. */
const NO_LATEX: Record<string, string> = {
  ladder: '최소공배수 사다리(LADDER)는 LaTeX에 대응이 없어 이름만 남겼습니다',
  sladder: '진법 변환 사다리(SLADDER)는 LaTeX에 대응이 없어 이름만 남겼습니다',
  longdiv: '세로셈 나눗셈(LONGDIV)은 LaTeX에 대응이 없어 이름만 남겼습니다',
  rel: 'REL(화살표 위아래 관계식)은 LaTeX에 대응이 없습니다 — \\xrightarrow 계열을 손으로 쓰셔야 합니다',
  buildrel: 'BUILDREL은 LaTeX에 대응이 없습니다 — \\xrightarrow 계열을 손으로 쓰셔야 합니다',
  scale: 'SCALE(글자 크기 비율)은 LaTeX에 대응이 없어 지웠습니다',
  att: 'att(※)는 수식 기호가 아니라 문자라 그대로 두었습니다',
  well: 'well(♯ 모양 기호)은 LaTeX에 대응이 없어 이름만 남겼습니다',
  benzene: '벤젠 고리 기호는 LaTeX에 대응이 없어 이름만 남겼습니다',
}

/** 낱말 하나로 끝나는 기호들의 되돌리기 표. 앞의 표에서 자동으로 만든다. */
const REV: Record<string, string> = (() => {
  const m: Record<string, string> = {}
  const put = (hwp: string, tex: string) => {
    const k = hwp.toLowerCase()
    if (!(k in m)) m[k] = tex
  }
  for (const n of GREEK_LOWER) put(n, `\\${n}`)
  for (const n of SAME) put(n, `\\${n}`)
  for (const n of FUNCS) put(n, `\\${n}`)
  for (const [tex, hwp] of Object.entries(RENAME)) {
    // `->` 처럼 낱말이 아닌 것은 글자 단위로 읽으므로 여기 두지 않는다
    if (/^[A-Za-z]+$/.test(hwp)) put(hwp, `\\${tex}`)
  }
  return { ...m, ...REV_FIX }
})()

/** 장식 명령어의 되돌리기 표 — 이쪽은 뒤에 오는 항 하나를 먹는다. */
const REV_ACCENT: Record<string, string> = (() => {
  const m: Record<string, string> = {}
  for (const [tex, hwp] of Object.entries(ACCENT)) {
    const k = hwp.toLowerCase()
    if (!(k in m)) m[k] = `\\${tex}`
  }
  return m
})()

/** 묶음 명령어 → LaTeX 환경. */
const REV_ENV: Record<string, string> = {
  matrix: 'matrix',
  pmatrix: 'pmatrix',
  bmatrix: 'bmatrix',
  dmatrix: 'vmatrix',
  cases: 'cases',
  eqalign: 'aligned',
  pile: 'gathered',
  lpile: 'aligned',
  rpile: 'gathered',
}

/** 글꼴 전환. 한글에서는 그 자리부터 묶음 끝까지 걸린다. */
const REV_FONT: Record<string, string> = {
  rm: '\\mathrm',
  it: '\\mathit',
  bold: '\\boldsymbol',
  rmbold: '\\mathbf',
}

/** 괄호 글자 → LaTeX의 구분자.
 *
 *  ⚠️ `<`는 `\langle`이 아니다. 한글에서 `LEFT <`는 늘어나는 부등호를 그리고,
 *  꺾쇠괄호를 쓸 때는 `LEFT ⟨`처럼 그 글자를 직접 쓴다. `<`를 ⟨로 되읽으면
 *  한글에서는 나오지도 않는 괄호가 미리보기에만 그려진다. */
const REV_DELIM: Record<string, string> = {
  '(': '(', ')': ')', '[': '[', ']': ']',
  '{': '\\{', '}': '\\}',
  '|': '|', '.': '.', '/': '/', '<': '<', '>': '>',
  '⟨': '\\langle', '⟩': '\\rangle',
  '⌊': '\\lfloor', '⌋': '\\rfloor',
  '⌈': '\\lceil', '⌉': '\\rceil',
  '∥': '\\|',
  vert: '|', VERT: '\\|',
  uparrow: '\\uparrow', downarrow: '\\downarrow',
}

/* ---------- 낱말 나누기 ---------- */

interface HTok {
  t: 'word' | 'num' | 'open' | 'close' | 'sup' | 'sub' | 'amp' | 'hash' | 'str' | 'op' | 'sp'
  v: string
}

/* 여러 글자짜리 연산자. 긴 것부터 봐야 `<->`가 `<-`와 `>`로 쪼개지지 않는다. */
const HWP_OPS = ['<->', '<-', '->', '<<', '>>', '<=', '>=', '!=', '==', '+-']

function hlex(src: string): HTok[] {
  const out: HTok[] = []
  let i = 0
  while (i < src.length) {
    const c = src[i]
    if (/\s/.test(c)) {
      while (i < src.length && /\s/.test(src[i])) i++
      out.push({ t: 'sp', v: ' ' })
      continue
    }
    if (c === '"') {
      const end = src.indexOf('"', i + 1)
      const stop = end === -1 ? src.length : end
      out.push({ t: 'str', v: src.slice(i + 1, stop) })
      i = stop + 1
      continue
    }
    const op = HWP_OPS.find((o) => src.startsWith(o, i))
    if (op) {
      out.push({ t: 'op', v: op })
      i += op.length
      continue
    }
    if (/[A-Za-z]/.test(c)) {
      let j = i
      while (j < src.length && /[A-Za-z]/.test(src[j])) j++
      out.push({ t: 'word', v: src.slice(i, j) })
      i = j
      continue
    }
    if (/[0-9]/.test(c)) {
      let j = i
      while (j < src.length && /[0-9.]/.test(src[j])) j++
      // 끝에 붙은 마침표는 소수점이 아니라 문장 부호다
      let v = src.slice(i, j)
      while (v.endsWith('.')) {
        v = v.slice(0, -1)
        j--
      }
      out.push({ t: 'num', v })
      i = j
      continue
    }
    const t: HTok['t'] =
      c === '{' ? 'open'
        : c === '}' ? 'close'
          : c === '^' ? 'sup'
            : c === '_' ? 'sub'
              : c === '&' ? 'amp'
                : c === '#' ? 'hash'
                  : 'op'
    out.push({ t, v: c })
    i++
  }
  return out
}

/* ---------- 본체 ---------- */

interface LTerm {
  s: string
  /** 첨자의 밑으로 그대로 쓸 수 있는가 */
  atomic: boolean
  /** 앞 항에 빈칸 없이 붙여도 되는가 */
  tightLeft?: boolean
  /** 뒤 항이 빈칸 없이 붙어도 되는가 — `\alpha b`가 `\alphab`이 되면 안 된다 */
  tightRight?: boolean
  /** 원본에서 이 항 앞에 빈칸이 있었는가 */
  gap?: boolean
  /** 이미 첨자가 달린 항 — 두 번째 첨자는 다시 묶지 않고 이어 붙인다 */
  flat?: boolean
}

const lwrap = (t: LTerm): string => (t.atomic ? t.s : `{${t.s}}`)

/** `{…}` 한 겹을 벗긴다 — **짝이 맞을 때만**.
 *
 *  ⚠️ 앞뒤 글자만 보고 떼면 안 된다. `\frac{a}{b}`는 중괄호로 끝나지만 그
 *  중괄호의 짝은 맨 앞에 없어서, 떼는 순간 `\frac{a}{b`가 되어 깨진다. */
function unbrace(s: string): string {
  if (!s.startsWith('{') || !s.endsWith('}')) return s
  let depth = 0
  for (let i = 0; i < s.length; i++) {
    if (s[i] === '{') depth++
    else if (s[i] === '}' && --depth === 0) return i === s.length - 1 ? s.slice(1, -1) : s
  }
  return s
}

/** 항을 `{…}` 안에 넣을 내용으로 — 중괄호를 이중으로 두르지 않는다. */
const larg = (t: LTerm): string => unbrace(lwrap(t))

/* LaTeX는 수식 안의 빈칸을 무시하므로 여기서 띄우고 붙이는 것은 오로지 읽기
   좋으라고 하는 일이다. 그래서 한글 원본의 띄어쓰기를 그대로 살린다 — 한글에서도
   그 빈칸은 뜻이 없었지만, 그렇게 나눠 적은 사람이 그 식을 그렇게 읽고 있다. */
function ljoin(terms: LTerm[]): string {
  let out = ''
  let openRight = false
  for (const t of terms) {
    if (!t.s) continue
    // 빈칸 명령(`\ `)은 이미 빈칸으로 끝난다 — 하나 더 붙이지 않는다
    if (out && !out.endsWith(' ')) out += openRight && t.tightLeft && !t.gap ? '' : ' '
    out += t.s
    openRight = !!t.tightRight
  }
  return out
}

/** 명령어 하나로 이루어진 항. 이름이 글자로 끝나면 뒤에 반드시 빈칸이 필요하다. */
const cmdTermOf = (s: string): LTerm => ({
  s,
  atomic: true,
  tightLeft: true,
  tightRight: !/[A-Za-z]$/.test(s),
})

/** 원본 글자 그대로인 항 — 양옆 어디든 붙일 수 있다. */
const textTermOf = (s: string): LTerm => ({
  s,
  atomic: s.length === 1,
  tightLeft: true,
  tightRight: true,
})

export function hwpToLatex(source: string): HwpResult {
  const toks = hlex(source.trim())
  const warns: string[] = []
  const seen = new Set<string>()
  let p = 0
  /** 몇 겹의 환경 안에 있는가 — 줄바꿈이 갈 곳이 있는지 판단하는 데만 쓴다 */
  let envDepth = 0

  const warn = (m: string) => {
    if (seen.has(m)) return
    seen.add(m)
    warns.push(m)
  }

  const peek = (): HTok | undefined => toks[p]
  const skipSp = (): boolean => {
    const from = p
    while (toks[p] && toks[p].t === 'sp') p++
    return p !== from
  }

  type LStop = (t: HTok) => boolean
  const atClose: LStop = (t) => t.t === 'close'

  /** `{` … `}` 안쪽만 읽어서 돌려준다 — 환경으로 감쌀 몸통이 필요할 때 쓴다. */
  function body(): string {
    skipSp()
    if (peek()?.t !== 'open') return lwrap(parseAtom(() => false))
    p++
    const inner = ljoin(parseSeq(atClose))
    if (peek()?.t === 'close') p++
    return inner
  }

  /** LEFT·RIGHT 뒤의 한 글자. 여기서는 `{`가 묶음이 아니라 괄호다. */
  function readDelim(): string {
    skipSp()
    const t = peek()
    if (!t) return '.'
    p++
    if (t.t === 'word') {
      const d = REV_DELIM[t.v] ?? REV_DELIM[t.v.toLowerCase()]
      if (d) return d
      p--
      return '.'
    }
    return REV_DELIM[t.v] ?? '.'
  }

  /** 항 하나 + 거기 달라붙은 첨자.
   *
   *  `over`의 분모가 `b^2`일 때 `b`만 집으면 제곱이 분수 바깥으로 새어 나간다.
   *  한글에서 `_`와 `^`는 빈칸이 있든 없든 바로 앞 항에 붙으므로(한컴 예제도
   *  `int _1 ^2`처럼 띄어 쓴다) 여기서도 붙은 것까지 하나로 본다. */
  function parseOperand(stop: LStop): LTerm {
    let term = parseAtom(stop)
    for (;;) {
      /* 첨자를 찾아 앞을 내다볼 때 빈칸을 먹어 치우면 안 된다 — 그 빈칸은
         다음 항이 원본에서 떨어져 있었다는 유일한 증거다. 아니면 되돌린다. */
      const save = p
      skipSp()
      const t = peek()
      if (!t || (t.t !== 'sup' && t.t !== 'sub')) {
        p = save
        return term
      }
      p++
      const op = t.t === 'sup' ? '^' : '_'
      const script = parseAtom(stop)
      term = {
        s: `${term.flat ? term.s : lwrap(term)}${op}{${larg(script)}}`,
        atomic: false,
        flat: true,
        tightLeft: term.tightLeft,
        tightRight: true,
      }
    }
  }

  function parseSeq(stop: LStop): LTerm[] {
    const out: LTerm[] = []
    for (;;) {
      const spaced = skipSp()
      const t = peek()
      if (!t || stop(t)) break

      if (t.t === 'sup' || t.t === 'sub') {
        p++
        const op = t.t === 'sup' ? '^' : '_'
        const script = parseAtom(stop)
        // 근호를 내다보느라 빈칸을 먹지 않는다 — 다음 항의 띄어쓰기가 걸려 있다
        const save = p
        skipSp()
        const after = peek()
        const prev = out[out.length - 1]
        /* 밑 없는 `` `^{3} sqrt x ``는 세제곱근을 적는 한글의 관용구다 — 첨자가
           아니라 근호의 지수다. 앞에 붙은 것이 빈칸 명령뿐이면 밑이 없는 것으로
           본다(한컴 예제가 지수와 근호를 백틱으로 붙여 놓는다). */
        const noBase = !prev || prev.s === '\\,' || prev.s === '\\ '
        if (noBase && op === '^' && after?.t === 'word' && after.v.toLowerCase() === 'sqrt') {
          if (prev) out.pop()
          p++
          out.push({
            s: `\\sqrt[${larg(script)}]{${larg(parseAtom(stop))}}`,
            atomic: true,
            tightLeft: true,
            tightRight: true,
          })
          continue
        }
        p = save
        const base = out.pop()
        const head = base ? (base.flat ? base.s : lwrap(base)) : '{}'
        out.push({
          s: `${head}${op}{${larg(script)}}`,
          atomic: false,
          flat: true,
          tightLeft: base?.tightLeft,
          gap: base?.gap,
          tightRight: true,
        })
        continue
      }

      /* 중위 연산자 — 앞뒤에서 한 항씩 가져간다 */
      if (t.t === 'word') {
        const w = t.v.toLowerCase()
        if (w === 'over' || w === 'atop' || w === 'choose') {
          p++
          const a = out.pop() ?? { s: '', atomic: true }
          const num = larg(a)
          const den = larg(parseOperand(stop))
          const s =
            w === 'over' ? `\\frac{${num}}{${den}}`
              : w === 'choose' ? `\\binom{${num}}{${den}}`
                : `{${num} \\atop ${den}}`
          out.push({ s, atomic: true, tightLeft: true, tightRight: true, gap: a.gap })
          continue
        }
        /* 큰 연산자의 범위 — `int from 0 to 3` */
        if ((w === 'from' || w === 'to') && out.length) {
          p++
          const arg = parseAtom(stop)
          const base = out.pop()!
          const op = w === 'from' ? '_' : '^'
          out.push({
            s: `${base.s}${op}{${larg(arg)}}`,
            atomic: false,
            flat: true,
            tightLeft: base.tightLeft,
            gap: base.gap,
            tightRight: true,
          })
          continue
        }
      }

      const term = parseAtom(stop)
      out.push(spaced ? { ...term, gap: true } : term)
    }
    return out
  }

  function parseAtom(stop: LStop): LTerm {
    skipSp()
    const t = peek()
    if (!t) return { s: '', atomic: true }
    p++
    switch (t.t) {
      case 'open': {
        const inner = parseSeq(atClose).filter((x) => x.s)
        if (peek()?.t === 'close') p++
        /* 이미 한 덩어리인 것을 다시 묶지 않는다 — `{rm if}`가 `{\mathrm{if}}`가
           되면 뜻은 같고 읽기만 나빠진다. */
        if (inner.length === 1 && inner[0].atomic) return { ...inner[0], gap: undefined }
        return { s: `{${ljoin(inner)}}`, atomic: true, tightLeft: true, tightRight: true }
      }
      case 'close':
        return { s: '', atomic: true }
      case 'num':
        return textTermOf(t.v)
      case 'str':
        return { s: `\\text{${t.v}}`, atomic: true, tightLeft: true, tightRight: true }
      case 'amp':
        return { s: '&', atomic: true, tightLeft: true, tightRight: true }
      case 'hash':
        /* 환경 안이면 `\\`가 제자리를 찾는다. 바깥이면 LaTeX가 받아 줄 곳이
           없으므로 그때만 알린다. */
        if (!envDepth)
          warn('줄바꿈(#)을 \\\\ 로 옮겼습니다 — LaTeX에서는 aligned 같은 환경 안에서만 쓸 수 있습니다')
        return { s: '\\\\', atomic: true, tightLeft: true, tightRight: true }
      case 'op':
        return opTerm(t.v)
      case 'word':
        return wordTerm(t.v, stop)
      case 'sup':
      case 'sub':
        p--
        return { s: '', atomic: true }
      default:
        return { s: '', atomic: true }
    }
  }

  function opTerm(v: string): LTerm {
    switch (v) {
      case '~':
        return cmdTermOf('\\ ')
      case '`':
        return cmdTermOf('\\,')
      case '->':
        return cmdTermOf('\\to')
      case '<-':
        return cmdTermOf('\\leftarrow')
      case '<->':
        return cmdTermOf('\\leftrightarrow')
      case '<<':
        return cmdTermOf('\\ll')
      case '>>':
        return cmdTermOf('\\gg')
      case '<=':
        return cmdTermOf('\\leq')
      case '>=':
        return cmdTermOf('\\geq')
      case '!=':
        return cmdTermOf('\\neq')
      case '==':
        return cmdTermOf('\\equiv')
      case '+-':
        return cmdTermOf('\\pm')
      case '%':
        return cmdTermOf('\\%')
      case '$':
        return cmdTermOf('\\$')
      default:
        return textTermOf(v)
    }
  }

  function wordTerm(raw: string, stop: LStop): LTerm {
    const w = raw.toLowerCase()

    /* 글꼴 전환은 그 자리부터 묶음 끝까지 걸린다 — LaTeX에는 그런 것이 없으니
       남은 항들을 통째로 인자로 넣는다. */
    const font = REV_FONT[w]
    if (font) {
      const inner = ljoin(parseSeq(stop))
      /* `{rm if}`의 `if`는 그 자체로 이미 로만체 예약어라 `\mathrm{if}`로
         옮겨진다. 다시 감싸면 `\mathrm{\mathrm{if}}`가 된다. */
      const s = font === '\\mathrm' && /^\\mathrm\{[^{}]*\}$/.test(inner) ? inner : `${font}{${inner}}`
      return { s, atomic: true, tightLeft: true, tightRight: true }
    }

    const env = REV_ENV[w]
    if (env) {
      if (w === 'rpile') warn('오른쪽 맞춤 쌓기(rpile)는 LaTeX에 대응이 없어 가운데 맞춤(gathered)으로 바꿨습니다')
      envDepth++
      const inner = body()
      envDepth--
      return {
        s: `\\begin{${env}} ${inner} \\end{${env}}`,
        atomic: true,
        tightLeft: true,
        tightRight: true,
      }
    }

    if (w === 'sqrt')
      return { s: `\\sqrt{${larg(parseAtom(stop))}}`, atomic: true, tightLeft: true, tightRight: true }
    if (w === 'root') {
      const index = body()
      skipSp()
      if (peek()?.t === 'word' && peek()?.v.toLowerCase() === 'of') p++
      return { s: `\\sqrt[${index}]{${body()}}`, atomic: true, tightLeft: true, tightRight: true }
    }
    if (w === 'binom') {
      const a = larg(parseAtom(stop))
      const b = larg(parseAtom(stop))
      return { s: `\\binom{${a}}{${b}}`, atomic: true, tightLeft: true, tightRight: true }
    }
    if (w === 'left' || w === 'right') return cmdTermOf(`\\${w}${readDelim()}`)
    if (w === 'lsub' || w === 'lsup') {
      const base = lwrap(parseAtom(stop))
      const script = larg(parseAtom(stop))
      return {
        s: `{}${w === 'lsub' ? '_' : '^'}{${script}}${base}`,
        atomic: true,
        tightLeft: true,
        tightRight: true,
      }
    }
    if (w === 'color') {
      const rgb = body()
      return { s: `\\textcolor[RGB]{${rgb}}{${body()}}`, atomic: true, tightLeft: true, tightRight: true }
    }
    if (w === 'not') {
      skipSp()
      const next = peek()
      if (next && next.t === 'op' && next.v === '=') {
        p++
        return cmdTermOf('\\neq')
      }
      if (next && next.t === 'word' && next.v.toLowerCase() === 'in') {
        p++
        return cmdTermOf('\\notin')
      }
      return cmdTermOf('\\not')
    }
    if (/^(bigg?|Bigg?)$/.test(raw)) return cmdTermOf('\\bigg')

    const accent = REV_ACCENT[w]
    if (accent)
      return { s: `${accent}{${larg(parseAtom(stop))}}`, atomic: true, tightLeft: true, tightRight: true }

    if (NO_LATEX[w]) {
      warn(NO_LATEX[w])
      return w === 'scale' ? { s: '', atomic: true } : textTermOf(raw)
    }

    /* 대소문자가 뜻을 가르는 것들 — 모두 소문자면 작은 쪽, 아니면 큰 쪽 */
    const pair = CASED[w] ?? (GREEK_CAP[w] ? ([`\\${w}`, GREEK_CAP[w]] as [string, string]) : null)
    if (pair) return cmdTermOf(raw === w ? pair[0] : pair[1])

    const sym = REV[w]
    if (sym) return cmdTermOf(sym)

    /* 여기까지 왔으면 명령어가 아니라 사용자의 글자다. 한글에서 `abc`는 그냥
       기울임체 글자 셋이고, LaTeX에서도 그렇다. */
    return textTermOf(raw)
  }

  return { out: ljoin(parseSeq(() => false)), warnings: warns }
}
