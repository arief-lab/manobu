/**
 * `gen:reading-jouhou` — build the composed N2/N1 情報検索 store from vendored
 * government 情報素材 (TASK-173.9.13). Deterministic: no LLM, no network, same
 * input bytes produce the same output bytes. The network half happened once, at
 * `fetch-reading-jouhou.ts`, and its output is committed data.
 *
 * Unlike the 白書 pipelines, this generator SEARCHES nothing. A 情報素材 is a real
 * document and its lookup question is a thing a person decided, so every cell,
 * line and question below is authored here and the build FAILS when an authored
 * unit is not verbatim in the snapshot it cites. That is the difference between
 * "reconstructed cell-exact" and "typed from memory", and it is the property
 * AC#1 asks for: the table the learner reads is the table the ministry printed,
 * reflowed into markdown and nothing else.
 *
 * The screens are shared with the gate through `reading-jouhou-corpus.ts` (the
 * band, the verbatim check, the key-line answer contract, the three PDL1.0
 * obligations, the cross-document distractor rule), so a row this script writes
 * is a row `check:reading-jouhou` can re-prove offline. Judge rejections work the
 * same way as 長文's: CI only reads `{level}-jouhou-rejected.json`, it never runs
 * a model to write it.
 *
 * Run from this package: `bun run gen:reading-jouhou --level N2`.
 */

import { join } from "node:path";
import { writeFormattedStore } from "./gen-reading-cli";
import {
  JOUHOU_BLOCK,
  JOUHOU_CONSTRUCTION,
  JOUHOU_LICENSE,
  JOUHOU_SIGNER,
  type JouhouAssembly,
  type JouhouQuestion,
  type JouhouStoreRow,
  type JouhouUpstream,
  jouhouBandIssues,
  jouhouCreditFor,
  jouhouCrossRowIssues,
  jouhouEditedCreditFor,
  jouhouIdFor,
  jouhouObligationIssues,
  jouhouQuestionIssues,
  jouhouRowIssues,
  jouhouSourceIssues,
  readJouhouRejections,
  readJouhouUpstream,
  renderJouhouPassage,
} from "./reading-jouhou-corpus";

/** One vendored document as this store prints it. Every line, header cell and
 * table cell is typed out of `jouhou-upstream.jsonl`, and the build refuses any
 * unit the snapshot does not print, so a material IS the document, reflowed. */
export interface JouhouMaterial {
  readonly header: readonly string[];
  readonly lines: readonly string[];
  readonly notes: readonly string[];
  readonly rows: readonly (readonly string[])[];
  readonly slug: string;
  readonly title: string;
  readonly upstreamId: string;
}

/** One authored 小問: the lookup a person decided, over one material. `key`
 * names the printed line(s) the stem points at, which is what lets the gate ask
 * whether the 素材 answers the question in exactly one place. */
export interface JouhouSpec {
  readonly answerIndex: number;
  readonly key: readonly string[];
  readonly level: "N1" | "N2";
  readonly material: string;
  readonly options: readonly string[];
  readonly sequence: number;
  readonly stem: string;
}

export const jouhouMaterials: readonly JouhouMaterial[] = [
  {
    header: ["契約金額", "印紙税額"],
    lines: [
      "[令和8年4月1日現在法令等]",
      "対象税目",
      "印紙税",
      "概要",
      "第1号文書から第4号文書までの印紙税額の一覧表",
      "不動産売買契約書、不動産交換契約書、不動産売渡証書など",
      "記載された契約金額が",
    ],
    notes: [
      "※ 第1号文書と第3号文書から第17号文書とに該当する文書で第1号文書に所属が決定されるものは、記載された契約金額が1万円未満であっても非課税文書となりません。",
      "(注) 平成26年4月1日から令和9年3月31日までの間に作成される不動産の譲渡に関する契約書のうち、契約書に記載された契約金額が一定額を超えるものについては、税率が軽減されています",
    ],
    rows: [
      ["1万円未満（※）", "非課税"],
      ["1万円以上10万円以下", "200円"],
      ["10万円を超え50万円以下", "400円"],
      ["50万円を超え100万円以下", "1千円"],
      ["100万円を超え500万円以下", "2千円"],
      ["500万円を超え1千万円以下", "1万円"],
      ["1千万円を超え5千万円以下", "2万円"],
      ["5千万円を超え1億円以下", "6万円"],
      ["1億円を超え5億円以下", "10万円"],
      ["5億円を超え10億円以下", "20万円"],
      ["10億円を超え50億円以下", "40万円"],
      ["50億円を超えるもの", "60万円"],
      ["契約金額の記載のないもの", "200円"],
    ],
    slug: "inshi",
    title: "No.7140 印紙税額の一覧表（その1）第1号文書から第4号文書まで",
    upstreamId: "jh-1-7140",
  },
  {
    header: ["契約金額", "印紙税額"],
    lines: [
      "[令和8年4月1日現在法令等]",
      "対象税目",
      "印紙税",
      "概要",
      "第1号文書から第4号文書までの印紙税額の一覧表",
      "請負に関する契約書",
      "工事請負契約書、工事注文請書、物品加工注文請書、広告契約書、映画俳優専属契約書、請負金額変更契約書など",
      "記載された契約金額が",
    ],
    notes: [
      "※ 第2号文書と第3号文書から第17号文書とに該当する文書で第2号文書に所属が決定されるものは、記載された契約金額が1万円未満であっても非課税文書となりません。",
      "(注) 平成26年4月1日から令和9年3月31日までの間に作成される建設工事の請負に関する契約書のうち、契約書に記載された契約金額が一定額を超えるものについては、税率が軽減されています",
    ],
    // The 第2号文書 table on the same page: the bands are the 請負 schedule, whose
    // 2千円 row starts at 300万円 rather than the 100万円 the 第1号文書 table above
    // prints. Every row is copied as the snapshot prints it, the full-width １
    // included.
    rows: [
      ["1万円未満（※）", "非課税"],
      ["１万円以上100万円以下", "200円"],
      ["100万円を超え200万円以下", "400円"],
      ["200万円を超え300万円以下", "1千円"],
      ["300万円を超え500万円以下", "2千円"],
      ["500万円を超え1千万円以下", "1万円"],
      ["1千万円を超え5千万円以下", "2万円"],
      ["5千万円を超え1億円以下", "6万円"],
      ["1億円を超え5億円以下", "10万円"],
      ["5億円を超え10億円以下", "20万円"],
      ["10億円を超え50億円以下", "40万円"],
      ["50億円を超えるもの", "60万円"],
      ["契約金額の記載のないもの", "200円"],
    ],
    slug: "ukeoi",
    title: "No.7140 印紙税額の一覧表（その1）第1号文書から第4号文書まで",
    upstreamId: "jh-1-7140",
  },
  {
    header: ["課税される所得金額", "税率", "控除額"],
    lines: [
      "[令和8年4月1日現在法令等]",
      "対象税目",
      "所得税",
      "概要",
      "所得税の税率は、分離課税に対するものなどを除くと、5パーセントから45パーセントの7段階に区分されています。",
      "計算方法・計算式",
      "課税される所得金額（1,000円未満の端数金額を切り捨てた後の金額です。）に対する所得税の金額は、次の「所得税の速算表」を使用すると簡単に求められます。",
      "平成27年分以後",
    ],
    notes: [
      "具体例",
      "（課税される所得金額が7,000,000円の場合）",
      "求める税額は次のようになります。",
      "7,000,000円×0.23 - 636,000円= 974,000円",
      "※2 平成25年から令和19年までの各年分の確定申告においては、所得税と復興特別所得税（原則としてその年分の基準所得税額の2.1パーセント）を併せて申告・納付することとなります。",
    ],
    rows: [
      ["1,000円 から 1,949,000円まで", "5％", "0円"],
      ["1,950,000円 から 3,299,000円まで", "10％", "97,500円"],
      ["3,300,000円 から 6,949,000円まで", "20％", "427,500円"],
      ["6,950,000円 から 8,999,000円まで", "23％", "636,000円"],
      ["9,000,000円 から 17,999,000円まで", "33％", "1,536,000円"],
      ["18,000,000円 から 39,999,000円まで", "40％", "2,796,000円"],
      ["40,000,000円 以上", "45％", "4,796,000円"],
    ],
    slug: "shotoku",
    title: "No.2260 所得税の税率",
    upstreamId: "jh-2-2260",
  },
  {
    header: [],
    lines: [
      "支給額について",
      "Q 就学支援金はいくらまで支給を受けることができますか。支給上限額を教えてください。",
      "A 公立高校の場合、全日制は月額9,900円、定時制は月額2,700円、通信制は月額520円の授業料相当額が支給され、国立高校の場合、月額9,600円の授業料相当額が支給されます。",
      "私立高校の場合、全日制・定時制は最大で月額3万8,100円、通信制は最大で月額2万8,100円が支給されます。",
      "また、高等専門学校（高専）の1年生から3年生の場合、国公立は月額1万9,550円、私立は最大で月額3万8,100円が支給されます。",
      "支給期間について",
      "Q 就学支援金は、在学していればいつまでも支給されるのですか？",
      "A 高等学校の標準的な修業年限とされている36月まで原則支給されます。定時制・通信制の課程については原則48月まで支給されます。",
      "手続について",
      "Q 就学支援金を受け取るにはどのような手続きが必要ですか？",
      "A 就学支援金の受給資格を得るための申請が必要です。",
      "Q 令和8年4月から高校の授業料が無償化されると聞いたのですが、本当ですか？",
      "A 「いわゆる高校無償化」（※）により、令和8（2026）年4月から、高等学校等就学支援金制度が改正され、所得制限が撤廃され、多くの生徒が授業料の支援を受けることができるようになりました。",
    ],
    notes: [
      "なお、単位制ごとに授業料が設定される課程に在学する場合は支給額が異なります。",
      "※的確な表現としては、授業料を支援する「高等学校等就学支援金」です。",
    ],
    rows: [],
    slug: "kyuugaku",
    title: "高等学校等就学支援金制度に関するQ＆A",
    upstreamId: "jh-5-1342600",
  },
  {
    header: [
      "都道府県名",
      "答申された改定額【円】",
      "引上げ額",
      "引上げ率",
      "発効日",
    ],
    lines: [],
    notes: [],
    rows: [
      ["北海道", "1,131", "56", "5.2%", "令和8年10月1日"],
      ["青森", "1,090", "61", "5.9%", "令和8年10月29日"],
      ["茨城", "1,136", "62", "5.8%", "令和8年10月18日"],
      ["埼玉", "1,196", "55", "4.8%", "令和8年10月1日"],
      ["千葉", "1,195", "55", "4.8%", "令和8年10月1日"],
      ["東京", "1,280", "54", "4.4%", "令和8年10月1日"],
      ["神奈川", "1,279", "54", "4.4%", "令和8年10月1日"],
      ["新潟", "1,108", "58", "5.5%", "令和8年10月1日"],
      ["静岡", "1,154", "57", "5.2%", "令和8年10月15日"],
      ["愛知", "1,195", "55", "4.8%", "令和8年10月1日"],
      ["京都", "1,180", "58", "5.2%", "令和8年11月16日"],
      ["大阪", "1,231", "54", "4.6%", "令和8年10月1日"],
      ["兵庫", "1,172", "56", "5.0%", "令和8年10月1日"],
      ["広島", "1,141", "56", "5.2%", "令和8年10月11日"],
      ["福岡", "1,114", "57", "5.4%", "令和8年10月4日"],
      ["全国加重平均", "1,177", "56", "5.0%", "-"],
    ],
    slug: "minchou",
    title: "令和8年度 地域別最低賃金 全国一覧",
    upstreamId: "jh-3-001753404",
  },
  {
    header: [],
    lines: [
      "国民年金においては、一定期間の保険料をまとめて納めることにより保険料額から割引額が控除される「前納制度」を設けております。",
      "本日、令和９年度の国民年金保険料額が公表されたことに伴い、令和８年度における国民年金保険料の前納額をお知らせいたします。",
      "（１） ６ヶ月前納の場合の保険料額（令和８年４月～令和８年９月分の保険料または令和８年 10 月～令和９年３月分の保険料が対象）",
      "・口座振替の場合：１０６，３００円（毎月納める場合より１，２２０円の割引額が控除）",
      "・現金納付の場合：１０６，６５０円（毎月納める場合より ８７０円の割引額が控除）",
      "（２）１年前納の場合の保険料額（令和８年４月～令和９年３月分の保険料が対象）",
      "・口座振替の場合：２１０，５３０円（毎月納める場合より４，５１０円の割引額が控除）",
      "・現金納付の場合：２１１，２２０円（毎月納める場合より３，８２０円の割引額が控除）",
      "（３）２年前納の場合の保険料額 （令和８年４月～令和 10 年３月分の保険料が対象）",
      "・口座振替の場合：４１７,１５０円（毎月納める場合より１７, ３７０円の割引額が控除）",
      "・現金納付の場合：４１８,５１０円（毎月納める場合より１６, ０１０円の割引額が控除）",
    ],
    notes: [
      "※クレジットカードによる前納の保険料額は現金納付と同じ金額になります。",
      "＜前納のお申込みについて＞",
      "○ 前納制度を利用するには、年金事務所に申出を行う必要があります。",
      "＜口座振替の早割について＞",
      "○ 口座振替には上記の他、「早割」による割引があります。令和８年度は１７，８６０円（通常の保険料から６０円の割引）です。",
    ],
    rows: [],
    slug: "zenno",
    title: "令和８年度における国民年金保険料の前納額について",
    upstreamId: "jh-4-001630661",
  },
  {
    header: [
      "在留資格",
      "本邦において行うことができる活動",
      "該当例",
      "在留期間",
    ],
    lines: ["入管法別表第一の上欄の在留資格（活動資格）", "一の表（就労資格）"],
    notes: [
      "二の表（就労資格，上陸許可基準の適用あり）",
      "在留資格 | 本邦において行うことができる活動 | 該当例 | 在留期間",
    ],
    rows: [
      [
        "教授",
        "本邦の大学若しくはこれに準ずる機関又は高等専門学校において研究，研究の指導又は教育をする活動",
        "大学教授等",
        "５年，３年，１年又は３月",
      ],
      [
        "芸術",
        "収入を伴う音楽，美術，文学その他の芸術上の活動（二の表の興行の項に掲げる活動を除く。）",
        "作曲家，画家，著述家等",
        "５年，３年，１年又は３月",
      ],
      [
        "報道",
        "外国の報道機関との契約に基づいて行う取材その他の報道上の活動",
        "外国の報道機関の記者，カメラマン",
        "５年，３年，１年又は３月",
      ],
      [
        "介護",
        "本邦の公私の機関との契約に基づいて介護福祉士の資格を有する者が介護又は介護の指導を行う業務に従事する活動",
        "介護福祉士",
        "５年，３年，１年又は３月",
      ],
      [
        "文化活動",
        "収入を伴わない学術上若しくは芸術上の活動又は我が国特有の文化若しくは技芸について専門的な研究を行い若しくは専門家の指導を受けてこれを修得する活動（四の表の留学，研修の項に掲げる活動を除く。）",
        "日本文化の研究者等",
        "３年，１年，６月又は３月",
      ],
      [
        "短期滞在",
        "本邦に短期間滞在して行う観光，保養，スポーツ，親族の訪問，見学，講習又は会合への参加，業務連絡その他これらに類似する活動",
        "観光客，会議参加者等",
        "９０日、３０日又は１５日",
      ],
    ],
    slug: "zairyu",
    title: "在留資格一覧表",
    upstreamId: "jh-6-qaq5",
  },
];

/** The authored batch. Two questions per 素材: a 大問 prints 2 小問 and
 * `usedJouhouPassages` spends by passage, so the two questions of one 大問 must
 * come from two DISTINCT documents, and a level needs more rows than one paper
 * needs so the seeded walk can differ between papers. N2 carries four 素材 (the
 * fourth, the 請負 table, joined with TASK-173.9.20 to take the store to four
 * papers' worth); N1 still ships the three of TASK-173.9.13 and grows with
 * TASK-173.9.21.
 *
 * The option ORDER here is ours, unlike a licensed paper's, so it is authored to
 * spread the key across all four positions per level rather than defaulting every
 * row to the same one. `check:reading-answers` audits that. */
export const jouhouSpecs: readonly JouhouSpec[] = [
  {
    answerIndex: 0,
    key: ["100万円を超え500万円以下 | 2千円"],
    level: "N2",
    material: "inshi",
    options: ["2千円", "400円", "1万円", "1千円"],
    sequence: 1,
    stem: "契約金額が300万円の不動産売買契約書を作成する場合の印紙税額はいくらか。",
  },
  {
    answerIndex: 3,
    key: ["500万円を超え1千万円以下 | 1万円"],
    level: "N2",
    material: "inshi",
    options: ["2千円", "1千円", "200円", "1万円"],
    sequence: 2,
    stem: "契約金額が800万円の不動産売買契約書を作成する場合の印紙税額はいくらか。",
  },
  {
    answerIndex: 1,
    key: ["3,300,000円 から 6,949,000円まで | 20％ | 427,500円"],
    level: "N2",
    material: "shotoku",
    options: ["10％", "20％", "23％", "15％"],
    sequence: 1,
    stem: "課税される所得金額が4,000,000円の場合に適用される税率はいくらか。",
  },
  {
    answerIndex: 2,
    key: ["1,950,000円 から 3,299,000円まで | 10％ | 97,500円"],
    level: "N2",
    material: "shotoku",
    options: ["636,000円", "4,796,000円", "97,500円", "427,500円"],
    sequence: 2,
    stem: "課税される所得金額が2,500,000円の場合の控除額はいくらか。",
  },
  {
    answerIndex: 3,
    key: [
      "私立高校の場合、全日制・定時制は最大で月額3万8,100円、通信制は最大で月額2万8,100円が支給されます。",
    ],
    level: "N2",
    material: "kyuugaku",
    options: ["9,900円", "2,700円", "1万9,550円", "2万8,100円"],
    sequence: 1,
    stem: "私立高校の通信制課程について、支給される就学支援金の上限額は月額いくらか。",
  },
  {
    answerIndex: 0,
    key: ["国立高校の場合、月額9,600円の授業料相当額が支給されます。"],
    level: "N2",
    material: "kyuugaku",
    options: ["9,600円", "9,900円", "520円", "2,700円"],
    sequence: 2,
    stem: "国立高校の場合に支給される授業料相当額は月額いくらか。",
  },
  {
    answerIndex: 2,
    key: ["300万円を超え500万円以下 | 2千円"],
    level: "N2",
    material: "ukeoi",
    options: ["400円", "1千円", "2千円", "1万円"],
    sequence: 1,
    stem: "契約金額が400万円の工事請負契約書を作成する場合の印紙税額はいくらか。",
  },
  {
    answerIndex: 1,
    key: ["500万円を超え1千万円以下 | 1万円"],
    level: "N2",
    material: "ukeoi",
    options: ["400円", "1万円", "2千円", "2万円"],
    sequence: 2,
    stem: "契約金額が800万円の工事請負契約書を作成する場合の印紙税額はいくらか。",
  },
  {
    answerIndex: 1,
    key: ["東京 | 1,280 | 54 | 4.4% | 令和8年10月1日"],
    level: "N1",
    material: "minchou",
    options: ["大阪", "東京", "神奈川", "埼玉"],
    sequence: 1,
    stem: "答申された改定額が最も高いのはどの都道府県か。",
  },
  {
    answerIndex: 0,
    key: ["神奈川 | 1,279 | 54 | 4.4% | 令和8年10月1日"],
    level: "N1",
    material: "minchou",
    options: ["1,279", "1,280", "1,231", "1,196"],
    sequence: 2,
    stem: "神奈川県の答申された改定額はいくらか。",
  },
  {
    answerIndex: 3,
    key: [
      "・口座振替の場合：１０６，３００円（毎月納める場合より１，２２０円の割引額が控除）",
    ],
    level: "N1",
    material: "zenno",
    options: [
      "１０６，６５０円",
      "２１０，５３０円",
      "４１７，１５０円",
      "１０６，３００円",
    ],
    sequence: 1,
    stem: "６ヶ月前納の保険料を口座振替で納める場合の金額はいくらか。",
  },
  {
    answerIndex: 1,
    key: [
      "・口座振替の場合：２１０，５３０円（毎月納める場合より４，５１０円の割引額が控除）",
    ],
    level: "N1",
    material: "zenno",
    options: ["１，２２０円", "４，５１０円", "３，８２０円", "１７，８６０円"],
    sequence: 2,
    stem: "１年前納の保険料を口座振替で納める場合、毎月納める場合よりいくら割引されるか。",
  },
  {
    answerIndex: 2,
    key: [
      "文化活動 | 収入を伴わない学術上若しくは芸術上の活動又は我が国特有の文化若しくは技芸について専門的な研究を行い若しくは専門家の指導を受けてこれを修得する活動（四の表の留学，研修の項に掲げる活動を除く。） | 日本文化の研究者等 | ３年，１年，６月又は３月",
    ],
    level: "N1",
    material: "zairyu",
    options: [
      "５年，３年，１年又は３月",
      "３年，１年，６月，３月又は３０日",
      "３年，１年，６月又は３月",
      "９０日、３０日又は１５日",
    ],
    sequence: 1,
    stem: "文化活動について認められる在留期間はどれか。",
  },
  {
    answerIndex: 0,
    key: [
      "介護 | 本邦の公私の機関との契約に基づいて介護福祉士の資格を有する者が介護又は介護の指導を行う業務に従事する活動 | 介護福祉士 | ５年，３年，１年又は３月",
    ],
    level: "N1",
    material: "zairyu",
    options: [
      "介護福祉士",
      "大学教授等",
      "作曲家，画家，著述家等",
      "日本文化の研究者等",
    ],
    sequence: 2,
    stem: "介護の在留資格で行う業務に該当する者はどれか。",
  },
  // TASK-173.9.21 AC#5: N1 大問13 prints 2 小問, so the store is 8 rows deep.
  // These are the third 小問 of two materials the N1 store already spends: a
  // cross-row maximum over the 発効日 column, and a value from the ２年前納
  // block the two 前納 rows leave untouched.
  {
    answerIndex: 2,
    key: ["京都 | 1,180 | 58 | 5.2% | 令和8年11月16日"],
    level: "N1",
    material: "minchou",
    options: ["青森", "広島", "京都", "静岡"],
    sequence: 3,
    stem: "発効日が最も遅い都道府県はどれか。",
  },
  {
    answerIndex: 3,
    key: [
      "・現金納付の場合：４１８,５１０円（毎月納める場合より１６, ０１０円の割引額が控除）",
    ],
    level: "N1",
    material: "zenno",
    options: [
      "４１７,１５０円",
      "２１１,２２０円",
      "１０６,６５０円",
      "４１８,５１０円",
    ],
    sequence: 3,
    stem: "２年前納の保険料額を現金納付で納める場合の金額はいくらか。",
  },
];

const upstreamById = (
  upstreams: readonly JouhouUpstream[]
): Map<string, JouhouUpstream> => {
  const map = new Map<string, JouhouUpstream>();
  for (const upstream of upstreams) {
    map.set(upstream.id, upstream);
  }
  return map;
};

const materialOf = (slug: string): JouhouMaterial => {
  const material = jouhouMaterials.find((each) => each.slug === slug);
  if (material === undefined) {
    throw new Error(`unknown 情報素材: ${slug}`);
  }
  return material;
};

const assemblyOf = (spec: JouhouSpec): JouhouAssembly => {
  const material = materialOf(spec.material);
  return {
    header: material.header,
    lines: material.lines,
    notes: material.notes,
    rows: material.rows,
    title: material.title,
  };
};

const questionOf = (spec: JouhouSpec): JouhouQuestion => ({
  answerIndex: spec.answerIndex,
  key: spec.key,
  options: spec.options,
  stem: spec.stem,
});

/** The build's own guard: an authored unit that is not in the snapshot is a
 * transcription error, so it stops the build instead of shipping a row the gate
 * would only report later. */
/** Exported for the generator test: an authored unit the snapshot does not print
 * is a transcription error, and the build must stop on it. */
export const assertJouhouVerbatim = (
  spec: JouhouSpec,
  upstream: JouhouUpstream
): void => {
  const assembly = assemblyOf(spec);
  const issues = jouhouSourceIssues({
    assembly,
    passage: renderJouhouPassage(assembly),
    upstream,
  });
  if (issues.length > 0) {
    throw new Error(
      `${materialOf(spec.material).upstreamId}: authored unit is not verbatim in the snapshot: ${issues.join(", ")}`
    );
  }
};

/** Exported for the gate test: the fixture's valid row is built by the REAL
 * generator, so the generator and the gate cannot drift apart. */
export const buildJouhouRow = (
  spec: JouhouSpec,
  upstream: JouhouUpstream
): JouhouStoreRow => {
  const assembly = assemblyOf(spec);
  const passage = renderJouhouPassage(assembly);
  const question = questionOf(spec);
  const row: JouhouStoreRow = {
    acquiredAt: upstream.fetchedAt,
    answerIndex: spec.answerIndex,
    block: JOUHOU_BLOCK,
    construction: JOUHOU_CONSTRUCTION,
    editedCredit: jouhouEditedCreditFor(upstream),
    id: jouhouIdFor(spec.level, spec.material, spec.sequence),
    key: spec.key,
    level: spec.level,
    license: JOUHOU_LICENSE,
    options: spec.options,
    passage,
    provenance: "composed",
    sourceCredit: jouhouCreditFor(upstream),
    sourceIds: [upstream.id],
    sourceUrl: upstream.pageUrl,
    stem: spec.stem,
    validated: true,
    validatedBy: JOUHOU_SIGNER,
  };
  const issues = [
    ...jouhouRowIssues(row),
    ...jouhouBandIssues(passage),
    ...jouhouQuestionIssues({ passage, question }),
    ...jouhouObligationIssues({ row, upstream }),
  ];
  if (issues.length > 0) {
    throw new Error(`${row.id}: ${issues.join(", ")}`);
  }
  return row;
};

const parseLevel = (argv: readonly string[]): "N1" | "N2" => {
  const levelIndex = argv.indexOf("--level");
  const level = levelIndex >= 0 ? (argv[levelIndex + 1] ?? "N2") : "N2";
  if (level !== "N1" && level !== "N2") {
    throw new Error(
      "--level must be N1 or N2: this script assembles a store from vendored documents, and N3 大問7 and N4 大問6 compose authored 書き下ろし 素材 with no document to assemble (their rows are written and judge-frozen, not generated)"
    );
  }
  return level;
};

if (import.meta.main) {
  const storeDir = join(import.meta.dir, "..", "data", "reading");
  const level = parseLevel(process.argv.slice(2));
  const byId = upstreamById(readJouhouUpstream(storeDir));
  const rejections = readJouhouRejections(storeDir, level);
  const rows: JouhouStoreRow[] = [];
  for (const spec of jouhouSpecs) {
    if (spec.level !== level) {
      continue;
    }
    const material = materialOf(spec.material);
    const upstream = byId.get(material.upstreamId);
    if (upstream === undefined) {
      throw new Error(
        `${material.upstreamId} is not in jouhou-upstream.jsonl; run \`bun run fetch:reading-jouhou\``
      );
    }
    assertJouhouVerbatim(spec, upstream);
    const row = buildJouhouRow(spec, upstream);
    if (rejections.has(row.id)) {
      continue;
    }
    rows.push(row);
  }
  const crossIssues = jouhouCrossRowIssues(rows);
  if (crossIssues.length > 0) {
    throw new Error(`${level}: ${crossIssues.join(", ")}`);
  }
  const outPath = join(storeDir, `${level.toLowerCase()}-jouhou.json`);
  writeFormattedStore(outPath, rows, "gen:reading-jouhou");
  console.log(
    `${level}-jouhou.json: ${rows.length} sourced-table rows from ${new Set(rows.map((row) => row.sourceIds?.[0] ?? "")).size} document(s)`
  );
}
