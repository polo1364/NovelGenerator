const titles = {
  ancient: ['長安夜雨', '江湖風雪錄', '山河故人', '青衣劍客', '宮闕深處的最後一盞燈', '劍影 Chang An'],
  fantasy: ['龍之契約', '魔法師的黎明', '星辰精靈', '永夜王冠', '在世界盡頭等待龍醒來', '王冠 Dragon Song'],
  mystery: ['午夜密室', '失蹤的證人', '血色謎案', '暗巷追兇', '第十三封沒有署名的遺書', '密室 Silent Witness'],
  science: ['星際航行', '量子回聲', '機械之心', '銀河邊境', '宇宙盡頭最後一位觀測者', '星艦 Orbit 2099'],
  romance: ['戀人的來信', '花開時想念你', '雨中的告白', '初戀未完', '與你重逢在那個遲來的春天', '戀曲 Love in June'],
  adventure: ['遠征之路', '荒島日記', '航海家的寶藏', '沙漠旅人', '穿越冰原去尋找失落的城市', '探險 Beyond the Map'],
  literature: ['故鄉的午後', '歲月無聲', '日常詩篇', '記憶的河流', '那些被時光悄悄收藏的名字', '散文 The Quiet Room'],
  modern: ['城市邊緣', '都市夜行', '人生切面', '明日公寓', '我們在城市交換彼此的孤獨', '城市 Neon Dreams']
};
const books = Object.entries(titles).flatMap(([genre, list], group) => list.map((title, i) => ({
  id: 1720000000000 + group * 100 + i, title, tags: [genre], notes: '',
  content: '# ' + title + '\n\n第一章：序曲\n這是隔離驗證用的小說內容。'.repeat(20),
  ...(group === 0 && i === 0 ? { kind: 'series', totalVolumes: 3,
    volumes: [{ label: '第一集', content: '測試卷內容', complete: true }] } : {})
})));
module.exports = { books, titles };
