/**
 * 中文 TTS 多音字 SSML 標註（瀏覽器 + Node 共用）
 */
(function (global) {
  function applyPolyphoneHints(text) {
    if (!text || String(text).includes('<phoneme')) return text;
    let s = String(text);

    const chang2 = '<phoneme alphabet="sapi" ph="chang 2">長</phoneme>';
    const chang2s = '<phoneme alphabet="sapi" ph="chang 2">长</phoneme>';
    const tiao2 = '<phoneme alphabet="sapi" ph="tiao 2">調</phoneme>';
    const tiao2s = '<phoneme alphabet="sapi" ph="tiao 2">调</phoneme>';
    const mei2 = '<phoneme alphabet="sapi" ph="mei 2">沒</phoneme>';
    const mei2s = '<phoneme alphabet="sapi" ph="mei 2">没</phoneme>';
    const dao4 = '<phoneme alphabet="sapi" ph="dao 4">倒</phoneme>';
    const jiao4 = '<phoneme alphabet="sapi" ph="jiao 4">覺</phoneme>';
    const jiao4s = '<phoneme alphabet="sapi" ph="jiao 4">觉</phoneme>';
    const shen2 = '<phoneme alphabet="sapi" ph="shen 2">什</phoneme>';
    const me5 = '<phoneme alphabet="sapi" ph="me 5">麼</phoneme>';
    const me5s = '<phoneme alphabet="sapi" ph="me 5">么</phoneme>';
    const zen3 = '<phoneme alphabet="sapi" ph="zen 3">怎</phoneme>';
    const zhao2 = '<phoneme alphabet="sapi" ph="zhao 2">著</phoneme>';
    const zhao2s = '<phoneme alphabet="sapi" ph="zhao 2">着</phoneme>';
    const zhe5 = '<phoneme alphabet="sapi" ph="zhe 5">著</phoneme>';
    const zhe5s = '<phoneme alphabet="sapi" ph="zhe 5">着</phoneme>';

    const sm = `${shen2}${me5}`;
    const sms = `${shen2}${me5s}`;
    const zm = `${zen3}${me5}`;
    const zms = `${zen3}${me5s}`;

    const pairs = [
      [/沒什麼/g, `${mei2}${sm}`],
      [/没什么/g, `${mei2s}${sms}`],
      [/為什麼/g, `為${sm}`],
      [/为什么/g, `为${sms}`],
      [/怎麼辦/g, `${zm}辦`],
      [/怎麼樣/g, `${zm}樣`],
      [/怎麼了/g, `${zm}了`],
      [/怎麼/g, zm],
      [/怎么办/g, `${zms}办`],
      [/怎么样/g, `${zms}样`],
      [/怎么了/g, `${zms}了`],
      [/怎么/g, zms],
      [/什麼/g, sm],
      [/什么/g, sms],
      [/很長/g, `很${chang2}`],
      [/好長/g, `好${chang2}`],
      [/太長/g, `太${chang2}`],
      [/多長/g, `多${chang2}`],
      [/變長/g, `變${chang2}`],
      [/拉長/g, `拉${chang2}`],
      [/延長/g, `延${chang2}`],
      [/頗長/g, `頗${chang2}`],
      [/極長/g, `極${chang2}`],
      [/尤長/g, `尤${chang2}`],
      [/甚長/g, `甚${chang2}`],
      [/很长/g, `很${chang2s}`],
      [/好长/g, `好${chang2s}`],
      [/太长/g, `太${chang2s}`],
      [/多长/g, `多${chang2s}`],
      [/調酒/g, `${tiao2}酒`],
      [/調味/g, `${tiao2}味`],
      [/調料/g, `${tiao2}料`],
      [/调酒/g, `${tiao2s}酒`],
      [/倒了一杯酒/g, `${dao4}了一杯酒`],
      [/倒了一杯/g, `${dao4}了一杯`],
      [/倒了酒/g, `${dao4}了酒`],
      [/倒水/g, `${dao4}水`],
      [/倒酒/g, `${dao4}酒`],
      [/倒入/g, `${dao4}入`],
      [/倒出/g, `${dao4}出`],
      [/倒進/g, `${dao4}進`],
      [/倒滿/g, `${dao4}滿`],
      [/沒問題/g, `${mei2}問題`],
      [/沒關係/g, `${mei2}關係`],
      [/沒想到/g, `${mei2}想到`],
      [/沒有/g, `${mei2}有`],
      [/沒事/g, `${mei2}事`],
      [/沒錯/g, `${mei2}錯`],
      [/没问题/g, `${mei2s}问题`],
      [/没关系/g, `${mei2s}关系`],
      [/没事/g, `${mei2s}事`],
      [/還沒睡覺/g, `還沒睡${jiao4}`],
      [/睡覺時間/g, `睡${jiao4}時間`],
      [/想睡覺/g, `想睡${jiao4}`],
      [/去睡覺/g, `去睡${jiao4}`],
      [/要睡覺/g, `要睡${jiao4}`],
      [/睡一覺/g, `睡一${jiao4}`],
      [/睡覺了/g, `睡${jiao4}了`],
      [/睡覺/g, `睡${jiao4}`],
      [/睡醒/g, `睡${jiao4}醒`],
      [/一覺/g, `一${jiao4}`],
      [/还没睡觉/g, `还没睡${jiao4s}`],
      [/睡觉时间/g, `睡${jiao4s}时间`],
      [/想睡觉/g, `想睡${jiao4s}`],
      [/去睡觉/g, `去睡${jiao4s}`],
      [/要睡觉/g, `要睡${jiao4s}`],
      [/睡一觉/g, `睡一${jiao4s}`],
      [/睡觉了/g, `睡${jiao4s}了`],
      [/睡觉/g, `睡${jiao4s}`],
      [/一觉/g, `一${jiao4s}`],
      // 著 zháo（二聲）：達到、入睡
      [/睡著了/g, `睡${zhao2}了`],
      [/睡著/g, `睡${zhao2}`],
      [/著了/g, `${zhao2}了`],
      [/著地/g, `${zhao2}地`],
      [/著邊/g, `${zhao2}邊`],
      [/著迷/g, `${zhao2}迷`],
      [/著火/g, `${zhao2}火`],
      [/著涼/g, `${zhao2}涼`],
      [/睡着了/g, `睡${zhao2s}了`],
      [/睡着/g, `睡${zhao2s}`],
      [/着了/g, `${zhao2s}了`],
      [/着地/g, `${zhao2s}地`],
      [/着边/g, `${zhao2s}边`],
      [/着迷/g, `${zhao2s}迷`],
      [/着火/g, `${zhao2s}火`],
      [/着凉/g, `${zhao2s}凉`],
      // 著 zhe（輕聲）：持續態助詞
      [/聽著/g, `聽${zhe5}`],
      [/看著/g, `看${zhe5}`],
      [/走著/g, `走${zhe5}`],
      [/坐著/g, `坐${zhe5}`],
      [/站著/g, `站${zhe5}`],
      [/躺著/g, `躺${zhe5}`],
      [/等著/g, `等${zhe5}`],
      [/拿著/g, `拿${zhe5}`],
      [/笑著/g, `笑${zhe5}`],
      [/哭著/g, `哭${zhe5}`],
      [/說著/g, `說${zhe5}`],
      [/想著/g, `想${zhe5}`],
      [/活著/g, `活${zhe5}`],
      [/愛著/g, `愛${zhe5}`],
      [/扶著/g, `扶${zhe5}`],
      [/抱著/g, `抱${zhe5}`],
      [/握著/g, `握${zhe5}`],
      [/閉著/g, `閉${zhe5}`],
      [/睜著/g, `睜${zhe5}`],
      [/牽著/g, `牽${zhe5}`],
      [/舉著/g, `舉${zhe5}`],
      [/低著/g, `低${zhe5}`],
      [/抬著/g, `抬${zhe5}`],
      [/守著/g, `守${zhe5}`],
      [/望著/g, `望${zhe5}`],
      [/盯著/g, `盯${zhe5}`],
      [/听着/g, `听${zhe5s}`],
      [/看着/g, `看${zhe5s}`],
      [/走着/g, `走${zhe5s}`],
      [/坐着/g, `坐${zhe5s}`],
      [/站着/g, `站${zhe5s}`],
      [/躺着/g, `躺${zhe5s}`],
      [/等着/g, `等${zhe5s}`],
      [/拿着/g, `拿${zhe5s}`],
      [/笑着/g, `笑${zhe5s}`],
      [/哭着/g, `哭${zhe5s}`],
      [/说着/g, `说${zhe5s}`],
      [/想着/g, `想${zhe5s}`],
      [/活着/g, `活${zhe5s}`],
      [/爱着/g, `爱${zhe5s}`],
      [/扶着/g, `扶${zhe5s}`],
      [/抱着/g, `抱${zhe5s}`],
      [/握着/g, `握${zhe5s}`],
      [/闭着/g, `闭${zhe5s}`],
      [/睁着/g, `睁${zhe5s}`],
      [/牵着/g, `牵${zhe5s}`],
      [/举着/g, `举${zhe5s}`],
      [/低着/g, `低${zhe5s}`],
      [/抬着/g, `抬${zhe5s}`],
      [/守着/g, `守${zhe5s}`],
      [/望着/g, `望${zhe5s}`],
      [/盯着/g, `盯${zhe5s}`]
    ];

    for (const [re, repl] of pairs) s = s.replace(re, repl);
    s = s.replace(/睡\u89c9醒/g, `睡${jiao4s}醒`);
    return s;
  }

  const api = { applyPolyphoneHints };
  if (typeof module !== 'undefined' && module.exports) {
    module.exports = api;
  }
  global.TtsPolyphoneHints = api;
})(typeof globalThis !== 'undefined' ? globalThis : this);
