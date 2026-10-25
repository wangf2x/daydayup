/**
 * 内置题库：3-4 年级语文、数学、英语各 30 道。
 * 题型：choice（单选）、fill（填空，单行）、judge（判断，用 choice 选项呈现）。
 * answer 支持多个可接受答案（accept 数组），判分时统一去空格、转小写后比较。
 */

const MATH = [
  { id: 'm01', grade: 3, type: 'fill', stem: '25 × 4 = ?', answer: '100' },
  { id: 'm02', grade: 3, type: 'fill', stem: '480 ÷ 6 = ?', answer: '80' },
  { id: 'm03', grade: 3, type: 'choice', stem: '一个长方形长 8 厘米、宽 5 厘米，周长是多少厘米？', options: ['13', '26', '40', '80'], answer: '26' },
  { id: 'm04', grade: 3, type: 'fill', stem: '长 8 厘米、宽 5 厘米的长方形，面积是多少平方厘米？', answer: '40' },
  { id: 'm05', grade: 3, type: 'fill', stem: '3 米 = ? 厘米', answer: '300' },
  { id: 'm06', grade: 3, type: 'fill', stem: '2 小时 = ? 分钟', answer: '120' },
  { id: 'm07', grade: 3, type: 'choice', stem: '找规律：2，4，8，16，（ ）', options: ['18', '24', '32', '64'], answer: '32' },
  { id: 'm08', grade: 3, type: 'fill', stem: '25 + 37 = ?', answer: '62' },
  { id: 'm09', grade: 3, type: 'fill', stem: '100 − 46 = ?', answer: '54' },
  { id: 'm10', grade: 4, type: 'fill', stem: '6 × 7 + 8 = ?', answer: '50' },
  { id: 'm11', grade: 3, type: 'fill', stem: '一个数的 5 倍是 45，这个数是多少？', answer: '9' },
  { id: 'm12', grade: 4, type: 'choice', stem: '三角形的内角和是多少度？', options: ['90°', '180°', '270°', '360°'], answer: '180°', accept: ['180', '180度'] },
  { id: 'm13', grade: 3, type: 'fill', stem: '一年有几个月？', answer: '12' },
  { id: 'm14', grade: 3, type: 'choice', stem: '平年二月有多少天？', options: ['28 天', '29 天', '30 天', '31 天'], answer: '28 天', accept: ['28', '28天'] },
  { id: 'm15', grade: 3, type: 'choice', stem: '比较大小：1/2 和 1/3 哪个大？', options: ['1/2 大', '1/3 大', '一样大', '无法比较'], answer: '1/2 大', accept: ['1/2', '二分之一'] },
  { id: 'm16', grade: 4, type: 'fill', stem: '0.5 + 0.25 = ?', answer: '0.75' },
  { id: 'm17', grade: 3, type: 'fill', stem: '正方形边长 6 厘米，周长是多少厘米？', answer: '24' },
  { id: 'm18', grade: 3, type: 'fill', stem: '一箱苹果 24 个，3 箱一共多少个？', answer: '72' },
  { id: 'm19', grade: 3, type: 'fill', stem: '每个笔记本 5 元，买 7 个需要多少元？', answer: '35' },
  { id: 'm20', grade: 3, type: 'fill', stem: '12 个苹果平均分给 4 人，每人几个？', answer: '3' },
  { id: 'm21', grade: 3, type: 'judge', stem: '判断：0 乘任何数都得 0。', options: ['对', '错'], answer: '对' },
  { id: 'm22', grade: 4, type: 'judge', stem: '判断：两条平行线一定会相交。', options: ['对', '错'], answer: '错' },
  { id: 'm23', grade: 3, type: 'fill', stem: '从 8:20 到 9:05，经过多少分钟？', answer: '45' },
  { id: 'm24', grade: 4, type: 'choice', stem: '一个角正好是 90°，这个角叫做什么角？', options: ['锐角', '直角', '钝角', '平角'], answer: '直角', accept: ['90度角'] },
  { id: 'm25', grade: 3, type: 'fill', stem: '999 + 1 = ?', answer: '1000' },
  { id: 'm26', grade: 3, type: 'fill', stem: '4 个 25 相加是多少？', answer: '100' },
  { id: 'm27', grade: 4, type: 'fill', stem: '长 10 厘米、宽 4 厘米的长方形，面积是多少平方厘米？', answer: '40' },
  { id: 'm28', grade: 4, type: 'fill', stem: '一根绳子长 1 米，用去 35 厘米，还剩多少厘米？', answer: '65' },
  { id: 'm29', grade: 4, type: 'choice', stem: '下午 3 点用 24 时计时法表示是几点？', options: ['13 时', '14 时', '15 时', '23 时'], answer: '15 时', accept: ['15', '15时'] },
  { id: 'm30', grade: 3, type: 'judge', stem: '判断：1 千克 = 1000 克。', options: ['对', '错'], answer: '对' },
];

const CHINESE = [
  { id: 'c01', grade: 3, type: 'choice', stem: '“蜻蜓”的“蜓”读音是？', options: ['tín', 'tíng', 'tǐng', 'tìng'], answer: 'tíng' },
  { id: 'c02', grade: 3, type: 'choice', stem: '下面哪个字组词正确：眼（ ）', options: ['睛', '晴', '请', '清'], answer: '睛' },
  { id: 'c03', grade: 3, type: 'fill', stem: '补全成语：一心一（ ）', answer: '意' },
  { id: 'c04', grade: 3, type: 'fill', stem: '补全成语：（ ）羊补牢', answer: '亡' },
  { id: 'c05', grade: 4, type: 'choice', stem: '“勇敢”的反义词是？', options: ['胆小', '勇猛', '坚强', '大胆'], answer: '胆小', accept: ['怯懦', '害怕'] },
  { id: 'c06', grade: 4, type: 'choice', stem: '“著名”的近义词是？', options: ['有名', '平凡', '安静', '普通'], answer: '有名', accept: ['闻名'] },
  { id: 'c07', grade: 3, type: 'fill', stem: '补全诗句：床前明月光，（ ）', answer: '疑是地上霜' },
  { id: 'c08', grade: 4, type: 'fill', stem: '补全诗句：白日依山尽，（ ）', answer: '黄河入海流' },
  { id: 'c09', grade: 3, type: 'fill', stem: '补全诗句：春眠不觉晓，（ ）', answer: '处处闻啼鸟' },
  { id: 'c10', grade: 4, type: 'choice', stem: '“鹅，鹅，鹅，曲项向天歌”出自哪位诗人？', options: ['李白', '杜甫', '骆宾王', '白居易'], answer: '骆宾王' },
  { id: 'c11', grade: 3, type: 'fill', stem: '填量词：一（ ）树叶', answer: '片' },
  { id: 'c12', grade: 3, type: 'fill', stem: '填量词：一（ ）马', answer: '匹' },
  { id: 'c13', grade: 3, type: 'judge', stem: '判断：“已”和“己”是同一个字。', options: ['对', '错'], answer: '错' },
  { id: 'c14', grade: 3, type: 'fill', stem: '写出拼音“xǐ huān”对应的词语。', answer: '喜欢' },
  { id: 'c15', grade: 4, type: 'fill', stem: '“河”字的部首是什么？', answer: '氵', accept: ['三点水', '水'] },
  { id: 'c16', grade: 4, type: 'choice', stem: '把“小鸟在树上叫”改成拟人句，最合适的是？', options: ['小鸟在树上唱歌', '小鸟在树上', '树上有小鸟叫', '小鸟飞来'], answer: '小鸟在树上唱歌' },
  { id: 'c17', grade: 3, type: 'choice', stem: '句子末尾表示疑问，应该用什么标点？', options: ['。', '？', '！', '、'], answer: '？', accept: ['?'] },
  { id: 'c18', grade: 3, type: 'fill', stem: '词语搭配：（ ）的眼睛（填一个合适的形容词）', answer: '明亮', accept: ['大大的', '乌黑', '水汪汪', '亮晶晶', '雪亮'] },
  { id: 'c19', grade: 4, type: 'fill', stem: '补全成语：画蛇添（ ）', answer: '足' },
  { id: 'c20', grade: 4, type: 'fill', stem: '补全成语：守株待（ ）', answer: '兔' },
  { id: 'c21', grade: 4, type: 'choice', stem: '“太阳像个大火球”用了什么修辞手法？', options: ['比喻', '拟人', '夸张', '排比'], answer: '比喻' },
  { id: 'c22', grade: 3, type: 'choice', stem: '“长大”的“长”读音是？', options: ['cháng', 'zhǎng', 'zhàng', 'chǎng'], answer: 'zhǎng' },
  { id: 'c23', grade: 3, type: 'choice', stem: '下面哪个词表示颜色？', options: ['碧绿', '奔跑', '高兴', '轻声'], answer: '碧绿' },
  { id: 'c24', grade: 4, type: 'choice', stem: '“高兴（ ）说”括号里应填哪个字？', options: ['的', '地', '得', '底'], answer: '地' },
  { id: 'c25', grade: 3, type: 'fill', stem: '补全诗句：谁知盘中餐，（ ）', answer: '粒粒皆辛苦' },
  { id: 'c26', grade: 4, type: 'fill', stem: '歇后语：竹篮打水——（ ）', answer: '一场空' },
  { id: 'c27', grade: 4, type: 'choice', stem: '“（ ）今天下雨，（ ）运动会推迟了。”括号里最合适的关联词是？', options: ['因为……所以……', '虽然……但是……', '不但……而且……', '如果……就……'], answer: '因为……所以……', accept: ['因为所以'] },
  { id: 'c28', grade: 3, type: 'choice', stem: '“忽然”的近义词是？', options: ['突然', '慢慢', '渐渐', '平静'], answer: '突然', accept: ['忽然间'] },
  { id: 'c29', grade: 4, type: 'choice', stem: '“园”字是什么结构？', options: ['左右结构', '上下结构', '全包围结构', '半包围结构'], answer: '全包围结构' },
  { id: 'c30', grade: 3, type: 'judge', stem: '判断：“美丽”是形容词。', options: ['对', '错'], answer: '对' },
];

const ENGLISH = [
  { id: 'e01', grade: 3, type: 'choice', stem: "What's this? — It's ___ apple.", options: ['a', 'an', 'the', '/'], answer: 'an' },
  { id: 'e02', grade: 3, type: 'choice', stem: 'I ___ a student.', options: ['am', 'is', 'are', 'be'], answer: 'am' },
  { id: 'e03', grade: 3, type: 'choice', stem: 'She ___ my sister.', options: ['am', 'is', 'are', 'be'], answer: 'is' },
  { id: 'e04', grade: 4, type: 'fill', stem: '写出 box 的复数形式。', answer: 'boxes' },
  { id: 'e05', grade: 3, type: 'fill', stem: '写出 big 的反义词。', answer: 'small', accept: ['little'] },
  { id: 'e06', grade: 3, type: 'fill', stem: '“book”的中文意思是？', answer: '书', accept: ['书本', '书籍'] },
  { id: 'e07', grade: 3, type: 'fill', stem: 'How many ___ ?（apple 的复数）', answer: 'apples' },
  { id: 'e08', grade: 3, type: 'choice', stem: '___ is your name?', options: ['What', 'Who', 'Where', 'How'], answer: 'What' },
  { id: 'e09', grade: 3, type: 'choice', stem: 'The sun is ___.', options: ['yellow', 'blue', 'black', 'green'], answer: 'yellow' },
  { id: 'e10', grade: 3, type: 'fill', stem: '写出 cat 的复数形式。', answer: 'cats' },
  { id: 'e11', grade: 4, type: 'fill', stem: 'I like ___ (play) football.（用正确形式填空）', answer: 'playing' },
  { id: 'e12', grade: 3, type: 'fill', stem: '“Good morning”的中文意思是？', answer: '早上好', accept: ['早安', '上午好'] },
  { id: 'e13', grade: 3, type: 'choice', stem: '“Monday”是星期几？', options: ['星期一', '星期二', '星期日', '星期五'], answer: '星期一', accept: ['周一'] },
  { id: 'e14', grade: 4, type: 'fill', stem: 'He ___ (have) a pen.（用正确形式填空）', answer: 'has' },
  { id: 'e15', grade: 3, type: 'fill', stem: '“teacher”的中文意思是？', answer: '老师', accept: ['教师'] },
  { id: 'e16', grade: 4, type: 'choice', stem: '___ you like apples?', options: ['Do', 'Is', 'Are', 'Am'], answer: 'Do' },
  { id: 'e17', grade: 3, type: 'fill', stem: "What time is it? — It's ___ o'clock.（7 的英文）", answer: 'seven' },
  { id: 'e18', grade: 3, type: 'fill', stem: '写出 hot 的反义词。', answer: 'cold' },
  { id: 'e19', grade: 4, type: 'choice', stem: 'There ___ two books on the desk.', options: ['is', 'are', 'am', 'be'], answer: 'are' },
  { id: 'e20', grade: 3, type: 'fill', stem: '“I can swim.”的中文意思是？', answer: '我会游泳', accept: ['我能游泳'] },
  { id: 'e21', grade: 3, type: 'fill', stem: '字母表中第 5 个字母是什么？', answer: 'E', accept: ['e'] },
  { id: 'e22', grade: 3, type: 'fill', stem: '“family”的中文意思是？', answer: '家庭', accept: ['家人', '家'] },
  { id: 'e23', grade: 4, type: 'fill', stem: 'She is ___ (tall) than me.（用正确形式填空）', answer: 'taller' },
  { id: 'e24', grade: 3, type: 'choice', stem: '别人说“Thank you”，最合适的回答是？', options: ["You're welcome", 'Sorry', 'Goodbye', 'Yes'], answer: "You're welcome", accept: ['you are welcome', 'that is ok', "that's ok", 'no problem'] },
  { id: 'e25', grade: 4, type: 'fill', stem: "What's the weather like? — It's ___ (sun).（用正确形式填空）", answer: 'sunny' },
  { id: 'e26', grade: 4, type: 'fill', stem: '写出 go 的过去式。', answer: 'went' },
  { id: 'e27', grade: 3, type: 'fill', stem: '“Where are you from?” — I am from ___.（中国）', answer: 'China', accept: ['china', '中国'] },
  { id: 'e28', grade: 3, type: 'fill', stem: '写出 bird 的复数形式。', answer: 'birds' },
  { id: 'e29', grade: 4, type: 'choice', stem: 'The book is ___ the desk.（书在桌子上面）', options: ['in', 'on', 'under', 'behind'], answer: 'on' },
  { id: 'e30', grade: 4, type: 'fill', stem: 'I have two ___.（foot 的复数）', answer: 'feet' },
];

function tagSubject(list, subject) {
  return list.map((question) => ({ ...question, subject }));
}

const QUESTION_BANK = [
  ...tagSubject(MATH, 'math'),
  ...tagSubject(CHINESE, 'chinese'),
  ...tagSubject(ENGLISH, 'english'),
];

function listBySubject(subject) {
  return QUESTION_BANK.filter((question) => question.subject === subject);
}

function shuffle(list) {
  const copy = list.slice();
  for (let i = copy.length - 1; i > 0; i -= 1) {
    const j = Math.floor(Math.random() * (i + 1));
    const temp = copy[i];
    copy[i] = copy[j];
    copy[j] = temp;
  }
  return copy;
}

module.exports = {
  QUESTION_BANK,
  listBySubject,
  shuffle,
};
