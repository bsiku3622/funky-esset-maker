import { describe, expect, it } from 'vitest'
import { latexToHwp } from './hwp'

const out = (tex: string) => latexToHwp(tex).out
const warns = (tex: string) => latexToHwp(tex).warnings

describe('구조', () => {
  it('분수는 중위 연산자 over가 된다', () => {
    expect(out('\\frac12')).toBe('1 over 2')
    expect(out('\\frac{a}{b}')).toBe('{a} over {b}')
  })

  it('여러 항짜리 분자·분모는 중괄호로 묶인다', () => {
    expect(out('\\frac{a+1}{2b}')).toBe('{a+1} over {2b}')
  })

  it('첨자는 밑을 앞에 두고 이어 붙는다', () => {
    expect(out('x^{2}')).toBe('x ^{2}')
    expect(out('x_i')).toBe('x _i')
  })

  it('첨자 둘은 중첩하지 않고 나란히 붙는다', () => {
    // x_1^2 은 (x_1)^2 이 아니라 x 하나에 첨자 둘이 붙은 것이다
    expect(out('x_1^2')).toBe('x _1 ^2')
    expect(out('\\sum_{i=1}^{n}')).toBe('sum _{i=1} ^{n}')
  })

  it('제곱근과 거듭제곱근', () => {
    expect(out('\\sqrt{x}')).toBe('sqrt {x}')
    expect(out('\\sqrt[3]{x+1}')).toBe('`^{3} sqrt {x+1}')
  })

  it('조합은 CHOOSE', () => {
    expect(out('\\binom{n}{k}')).toBe('{n} CHOOSE {k}')
  })
})

describe('괄호', () => {
  it('\\left … \\right 는 LEFT … RIGHT', () => {
    expect(out('\\left( \\frac{a}{b} \\right)')).toBe('LEFT ( {a} over {b} RIGHT )')
  })

  it('중괄호는 글자가 아니라 LEFT/RIGHT로만 보인다', () => {
    expect(out('\\{ x \\}')).toBe('LEFT { x RIGHT }')
  })

  it('닫는 괄호에 붙은 첨자는 중괄호로 싸지 않는다', () => {
    // {RIGHT }} 로 싸면 닫는 중괄호가 묶음 기호로 읽혀 수식이 통째로 깨진다
    expect(out('\\left\\{ G \\right\\}^{2}')).toBe('LEFT { G RIGHT } ^{2}')
  })

  it('짝이 맞지 않으면 알려준다', () => {
    expect(warns('\\left( x')).toContain(
      '여는 괄호와 닫는 괄호의 수가 다릅니다 — 한글 수식은 LEFT와 RIGHT가 짝이 맞아야 합니다',
    )
  })

  it('한글에 없는 꺾쇠괄호는 부등호로 바꾸고 알려준다', () => {
    const r = latexToHwp('\\left\\langle x \\right\\rangle')
    expect(r.out).toBe('LEFT < x RIGHT >')
    expect(r.warnings).toHaveLength(1)
  })
})

describe('환경', () => {
  it('행렬은 &와 #으로 옮겨진다', () => {
    expect(out('\\begin{pmatrix} a & b \\\\ c & d \\end{pmatrix}')).toBe(
      'pmatrix{a & b # c & d}',
    )
  })

  it('vmatrix는 dmatrix', () => {
    expect(out('\\begin{vmatrix} a \\end{vmatrix}')).toBe('dmatrix{a}')
  })

  it('cases는 그대로 cases', () => {
    expect(out('\\begin{cases} 2x+y=4 \\\\ 3x-4y=-1 \\end{cases}')).toBe(
      'cases{2x+y=4 # 3x-4y=-1}',
    )
  })

  it('align 계열은 eqalign', () => {
    expect(out('\\begin{aligned} a &= b \\\\ &= c \\end{aligned}')).toBe(
      'eqalign{a &= b # &= c}',
    )
  })

  it('equation은 껍데기만 벗는다', () => {
    expect(out('\\begin{equation} E = mc^2 \\end{equation}')).toBe('E = mc ^2')
  })
})

describe('기호', () => {
  it('그리스 문자는 소문자 그대로, 대문자는 첫 글자만 대문자', () => {
    expect(out('\\alpha \\beta \\theta')).toBe('alpha beta theta')
    expect(out('\\Gamma \\Delta \\Omega')).toBe('Gamma Delta Omega')
  })

  it('홑화살표는 기호로, 겹화살표는 이름으로', () => {
    expect(out('a \\to b')).toBe('a -> b')
    expect(out('a \\Rightarrow b')).toBe('a RARROW b')
  })

  it('집합 기호는 줄 안에 놓이는 작은 쪽을 쓴다', () => {
    expect(out('A \\cup B \\cap C')).toBe('A SMALLUNION B SMALLINTER C')
    expect(out('\\bigcup_{i} A_i')).toBe('UNION _{i} A _i')
  })

  it('무한대는 inf', () => {
    expect(out('\\lim_{x \\to 0} \\frac{1}{x}')).toBe('lim _{x -> 0} {1} over {x}')
    expect(out('\\infty')).toBe('inf')
  })

  it('장식은 명령어를 앞에 둔다', () => {
    expect(out('\\vec{v} \\hat{x} \\overline{AB}')).toBe('vec {v} hat {x} bar {AB}')
  })

  it('LaTeX의 \\sup 은 한글의 윗첨자 명령과 이름이 겹쳐 로만체로 옮긴다', () => {
    expect(out('\\sup_{n} a_n')).toBe('{rm sup} _{n} a _n')
  })
})

describe('본문', () => {
  it('\\text 는 로만체 묶음이 된다', () => {
    expect(out('\\text{if} x > 0')).toBe('{rm if} x > 0')
  })

  it('빈칸은 ~, 9자를 넘는 낱말은 따옴표로 묶는다', () => {
    // 한글 수식은 한 낱말이 9자를 넘으면 두 항으로 쪼개 버린다
    expect(out('\\text{otherwise value}')).toBe('{rm "otherwise"~value}')
  })

  it('\\mathcal{L} 만은 한글에 진짜 글자가 있다', () => {
    expect(out('\\mathcal{L}')).toBe('LAPLACE')
    expect(warns('\\mathcal{L}')).toHaveLength(0)
  })

  it('칠판체는 대응이 없어 굵은 로만체로 내려간다', () => {
    const r = latexToHwp('\\mathbb{R}')
    expect(r.out).toBe('{rmbold R}')
    expect(r.warnings).toHaveLength(1)
  })
})

describe('빈칸과 겉껍질', () => {
  it('$…$ 는 벗기고 안쪽만 옮긴다', () => {
    expect(out('$$x^2$$')).toBe('x ^2')
    expect(out('\\[ x^2 \\]')).toBe('x ^2')
  })

  it('달러가 여러 쌍이면 벗기지 않는다', () => {
    // 벗기면 가운데 텍스트가 수식 안으로 딸려 들어온다
    expect(out('$a$ = $b$').startsWith('$')).toBe(true)
  })

  it('LaTeX의 빈칸 명령은 ~ 와 백틱이 된다', () => {
    expect(out('a \\, b \\quad c')).toBe('a ` b ~ c')
  })

  it('원본에서 붙어 있던 글자는 붙여 둔다', () => {
    expect(out('(x,y)')).toBe('(x,y)')
    expect(out('f(x) = 2x + 1')).toBe('f(x) = 2x + 1')
  })
})

describe('모르는 것', () => {
  it('대응을 못 찾은 명령어는 이름만 남기고 알려준다', () => {
    const r = latexToHwp('\\zzzz x')
    expect(r.out).toBe('zzzz x')
    expect(r.warnings).toHaveLength(1)
  })

  it('빈 입력은 빈 결과', () => {
    expect(latexToHwp('')).toEqual({ out: '', warnings: [] })
  })

  it('짝 없는 닫는 중괄호에도 멈추지 않는다', () => {
    expect(out('a } b')).toBe('a b')
  })
})

describe('실제 수식', () => {
  it('논문에서 뽑은 긴 식 한 줄', () => {
    const tex =
      '\\nabla_{\\theta}\\mathcal{L}(X,\\,Y) = \\nabla_{\\theta}(M(X)-Y)^{2} ' +
      '= 2(G(X)M_{0}(X)-Y)\\left(\\frac{\\partial G(X)M_{0}(X)}{\\partial \\theta} ' +
      '+ \\frac{\\partial Y}{\\partial \\theta}\\right) ' +
      '= 2\\left\\{G(X)\\right\\}^{2}\\frac{\\partial M_{0}(X)}{\\partial \\theta}' +
      '\\left(X-\\frac{Y}{G(X)}\\right)'
    const r = latexToHwp(tex)
    expect(r.warnings).toHaveLength(0)
    expect(r.out).toBe(
      'nabla _{theta} LAPLACE (X, ` Y) = nabla _{theta} (M(X)-Y) ^{2} ' +
        '= 2(G(X)M _{0} (X)-Y) LEFT ( {partial G(X)M _{0} (X)} over {partial theta} ' +
        '+ {partial Y} over {partial theta} RIGHT ) ' +
        '= 2 LEFT { G(X) RIGHT } ^{2} {partial M _{0} (X)} over {partial theta} ' +
        'LEFT (X- {Y} over {G(X)} RIGHT )',
    )
  })

  it('짝을 이룬 괄호 안쪽 글자는 괄호에 붙는다', () => {
    expect(out('\\left(x+1\\right)')).toBe('LEFT (x+1 RIGHT )')
  })

  it('근의 공식', () => {
    expect(out('x = \\frac{-b \\pm \\sqrt{b^2 - 4ac}}{2a}')).toBe(
      'x = {-b PLUSMINUS sqrt {b ^2 - 4ac}} over {2a}',
    )
  })
})
