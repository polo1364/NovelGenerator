/**
 * 中文 TTS 發音安全改寫（瀏覽器 + Node 共用）
 *
 * Edge 免費 TTS（WebSocket 直連與代理 Worker）都不支援 SSML <phoneme>：
 * 直連會回 1007 拒絕，代理會把標籤當文字唸出來。因此改用兩招：
 * 1. 發音安全改寫：zh-CN 語音模型以簡體語料最佳化，繁體多音字常唸錯
 *    （如「睡著」唸成 zhuó）。把這類字換成唯一對應的簡體字
 *    （「睡著」→「睡着」），模型即可依語境正確發音。
 * 2. word joiner（U+2060）：詞內插入不可見連接符，降低詞被拆開誤讀的機率。
 */
(function (global) {
  // 著 唸 zhù 的詞（簡體同樣寫「著」，不可改寫成「着」）
  const ZHU_WORDS = [
    '著名', '著作', '著述', '著稱', '著称', '顯著', '显著', '昭著', '卓著',
    '執著', '执著', '土著', '原著', '名著', '專著', '专著', '編著', '编著',
    '論著', '论著', '鉅著', '巨著', '譯著', '译著', '合著', '拙著', '遺著', '遗著'
  ];

  /** 著→着，但保護唸 zhù 的詞（著名、執著…簡體也寫「著」） */
  function rewriteZhe(s) {
    if (!s.includes('著')) return s;
    const kept = [];
    for (const w of ZHU_WORDS) {
      if (!s.includes(w)) continue;
      const token = `\u0000${kept.length}\u0000`;
      kept.push(w);
      s = s.split(w).join(token);
    }
    s = s.replace(/著/g, '着');
    for (let i = 0; i < kept.length; i++) {
      s = s.split(`\u0000${i}\u0000`).join(kept[i]);
    }
    return s;
  }

  // 這些繁體字的簡體對應唯一、且簡體保留相同的多音特性，
  // 整字替換後交給 zh-CN 模型依語境判斷讀音（簡體語境判斷準確得多）
  const SAFE_CHAR_MAP = [
    [/[麼麽]/g, '么'],   // 什麼→什么（shén me，避免唸成 shí mó）
    [/沒/g, '没'],       // 沒有→没有（méi，避免唸成 mò）
    [/長/g, '长'],       // 很長→很长（cháng / zhǎng 由模型判斷）
    [/覺/g, '觉'],       // 睡覺→睡觉（jiào）、覺得→觉得（jué）
    [/調/g, '调'],       // 調酒→调酒（tiáo / diào 由模型判斷）
    [/聽/g, '听'],       // 聽著→听着（tīng）
    [/發/g, '发'],       // 發現→发现（fā / fà 由模型判斷）
    [/幾/g, '几']        // 幾乎→几乎（jǐ / jī 由模型判斷）
  ];

  /**
   * 發音安全改寫：把 zh-CN 模型容易唸錯的繁體多音字換成簡體對應字。
   * 僅用於送給 TTS 的文字，不影響畫面顯示。可重複呼叫（冪等）。
   */
  function applyPolyphoneHints(text) {
    if (!text) return '';
    let s = String(text);
    s = rewriteZhe(s);
    for (const [re, repl] of SAFE_CHAR_MAP) s = s.replace(re, repl);
    return s;
  }

  /** 移除 phoneme 標籤、還原純文字（Edge 服務不支援 SSML phoneme） */
  function stripPhonemeTags(text) {
    if (!text) return '';
    return String(text).replace(/<phoneme[^>]*>([\s\S]*?)<\/phoneme>/g, '$1');
  }

  /** 容易被 TTS 拆開唸錯的詞（word joiner 保護） */
  const PROTECTED_WORDS_RAW = [
    '還沒睡覺', '睡覺時間', '想睡覺', '去睡覺', '要睡覺', '睡一覺', '睡覺了', '睡覺', '睡醒', '一覺',
    '睡著了', '睡著', '聽著', '看著', '走著', '坐著', '站著', '躺著', '等著', '拿著', '笑著', '哭著',
    '說著', '想著', '活著', '愛著', '扶著', '抱著', '握著', '閉著', '睜著', '牽著', '舉著', '望著', '盯著',
    '倒了一杯酒', '倒了一杯', '倒了酒', '倒入', '倒出', '倒進', '倒滿', '倒水', '倒酒',
    '沒問題', '沒關係', '沒想到', '沒什麼', '沒有', '沒事', '沒錯',
    '什麼時候', '什麼東西', '什麼事', '幹什麼', '做什麼', '有什麼', '是什麼', '為什麼',
    '什麼', '什麽', '怎麼辦', '怎麼樣', '怎麼了', '怎麼', '怎麽', '為什麽',
    '有没有', '有沒有', '很長', '好長', '太長', '多長', '變長', '拉長', '延長',
    '頗長', '極長', '尤長', '甚長', '調酒', '調味', '調料'
  ];

  // 同時涵蓋改寫前後的字形，無論在改寫前或後套用 joiner 都能命中
  const PROTECTED_WORDS = Array.from(
    new Set(PROTECTED_WORDS_RAW.flatMap((w) => [w, applyPolyphoneHints(w)]))
  ).sort((a, b) => b.length - a.length);

  /** 詞內插入字元連接符 U+2060，降低詞被拆開唸錯的機率 */
  function applyWordJoiners(text) {
    if (!text) return '';
    const WJ = '\u2060';
    let s = String(text);
    for (const w of PROTECTED_WORDS) {
      if (!s.includes(w)) continue;
      s = s.split(w).join([...w].join(WJ));
    }
    return s;
  }

  const api = { applyPolyphoneHints, applyWordJoiners, stripPhonemeTags, PROTECTED_WORDS };
  if (typeof module !== 'undefined' && module.exports) {
    module.exports = api;
  }
  global.TtsPolyphoneHints = api;
})(typeof globalThis !== 'undefined' ? globalThis : this);
