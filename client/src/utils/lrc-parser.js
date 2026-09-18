function parseTime(timeStr) {
  var parts = timeStr.split(':');
  if (parts.length === 3) {
    return parseInt(parts[0], 10) * 3600 + parseInt(parts[1], 10) * 60 + parseFloat(parts[2]);
  }
  var minutes = parseInt(parts[0], 10);
  var seconds = parseFloat(parts[1] || '0');
  return minutes * 60 + seconds;
}

function isCJK(charCode) {
  return (charCode >= 0x4E00 && charCode <= 0x9FFF) ||
         (charCode >= 0x3400 && charCode <= 0x4DBF) ||
         (charCode >= 0x2E80 && charCode <= 0x2FDF) ||
         (charCode >= 0xF900 && charCode <= 0xFAFF) ||
         (charCode >= 0xFE30 && charCode <= 0xFE4F) ||
         (charCode >= 0x3000 && charCode <= 0x303F);
}

function isHiraganaKatakana(charCode) {
  return (charCode >= 0x3040 && charCode <= 0x309F) ||
         (charCode >= 0x30A0 && charCode <= 0x30FF) ||
         (charCode >= 0x31F0 && charCode <= 0x31FF) ||
         (charCode >= 0xFF65 && charCode <= 0xFF9F);
}

function isHangul(charCode) {
  return (charCode >= 0xAC00 && charCode <= 0xD7AF) ||
         (charCode >= 0x1100 && charCode <= 0x11FF) ||
         (charCode >= 0x3130 && charCode <= 0x318F);
}

function cjkRatio(text) {
  if (!text) return 0;
  var cjk = 0;
  var total = 0;
  for (var i = 0; i < text.length; i++) {
    var code = text.charCodeAt(i);
    if (code <= 32 || code === 0x3000) continue;
    total++;
    if (isCJK(code)) cjk++;
  }
  return total > 0 ? cjk / total : 0;
}

function isForeignText(text) {
  if (!text) return false;
  var hasForeign = false;
  for (var i = 0; i < text.length; i++) {
    var code = text.charCodeAt(i);
    if (isHiraganaKatakana(code) || isHangul(code)) return true;
    if ((code >= 0x0041 && code <= 0x005A) || (code >= 0x0061 && code <= 0x007A)) hasForeign = true;
  }
  return hasForeign && cjkRatio(text) < 0.3;
}

function isChineseText(text) {
  return cjkRatio(text) >= 0.4;
}

function hasJapaneseKorean(text) {
  if (!text) return false;
  for (var i = 0; i < text.length; i++) {
    var code = text.charCodeAt(i);
    if (isHiraganaKatakana(code) || isHangul(code)) return true;
  }
  return false;
}

var CREDIT_KEYWORDS = [
  '作词', '词', '作曲', '曲', '编曲', '制作人', '混音', '母带', '监制', '封面',
  '吉他', '和音', '和声', '人声', '音频', '出品', '企划', '联合',
  '特别鸣谢', '商务', '策划', '画师', '读音', '萧', '戏腔', '说唱',
  '念白', '推广', '项目', '宣传', '发行', '出品人', '演唱', '录音',
  '伴奏', 'Arranged by', 'Backing Vocals by', 'Produced by',
  'Lyrics by', 'Composed by', 'SP', '营销', 'OP'
];

function isMetadataLine(text) {
  if (!text) return true;
  var colonIdx = text.search(/[：:∶]/);
  if (colonIdx === -1) return false;
  var prefix = text.substring(0, colonIdx).trim();
  for (var i = 0; i < CREDIT_KEYWORDS.length; i++) {
    if (prefix.indexOf(CREDIT_KEYWORDS[i]) === 0) return true;
  }
  return false;
}

function isSingerLabel(text) {
  if (!text) return false;
  if (text.length > 30) return false;
  if (!/[：:∶]$/.test(text)) return false;
  var content = text.replace(/[：:∶]$/, '');
  if (!content) return false;
  return /^[\u4E00-\u9FFF\u3400-\u4DBF\u3040-\u309F\u30A0-\u30FF\uAC00-\uD7AF\w\s\/\-&·．.（）()\uFF08\uFF09]+$/.test(content);
}

var COPYRIGHT_KEYWORDS = [
  '版权所有', '未经许可', '不得翻唱', '不得使用', '不得翻录',
  '著作权', 'TME享有', '欢迎来访', 'www.', 'http',
  '歌词翻译', '翻译由', '声明', 'Disclaimer'
];

var TAG_PATTERNS = [
  /\bon the beat\b/i,
  /\bmix\b.*制作/,
  /^[A-Za-z0-9]+制作$/
];

function isTagLine(text) {
  if (!text) return false;
  if (text.length > 30) return false;
  for (var i = 0; i < TAG_PATTERNS.length; i++) {
    if (TAG_PATTERNS[i].test(text)) return true;
  }
  if (/^[A-Z]{2,}\s*(on|mix|beat|prod)/i.test(text)) return true;
  return false;
}

function isCopyrightLine(text) {
  if (!text) return true;
  for (var i = 0; i < COPYRIGHT_KEYWORDS.length; i++) {
    if (text.indexOf(COPYRIGHT_KEYWORDS[i]) !== -1) return true;
  }
  return false;
}

function isTitleLine(text) {
  if (!text) return false;
  if (/^.+\s+-\s+.+$/.test(text)) return true;
  return false;
}

function cleanJunkText(text) {
  if (!text) return text;
  var nameIdx = text.indexOf('/name/');
  if (nameIdx !== -1) {
    text = text.substring(0, nameIdx).trim();
  }
  return text;
}

function shouldSkipLine(text, time) {
  if (!text) return true;
  if (isMetadataLine(text)) return true;
  if (isSingerLabel(text)) return true;
  if (isCopyrightLine(text)) return true;
  if (isTagLine(text)) return true;
  if (time <= 1 && isTitleLine(text)) return true;
  return false;
}

function parseWords(lineTime, text) {
  var wordRegex = /<(\d{1,3}:\d{2}(?:\.\d{1,3})?)>/;
  if (!wordRegex.test(text)) return null;

  var words = [];
  var parts = text.split(/<(\d{1,3}:\d{2}(?:\.\d{1,3})?)>/);
  if (parts.length < 2) return null;

  var currentTime = lineTime;
  var pendingText = '';

  for (var i = 0; i < parts.length; i++) {
    if (i % 2 === 0) {
      pendingText += parts[i];
    } else {
      var newTime = parseTime(parts[i]);
      if (pendingText) {
        words.push({ text: pendingText, startTime: currentTime, endTime: newTime });
        pendingText = '';
      }
      currentTime = newTime;
    }
  }

  if (pendingText) {
    words.push({ text: pendingText, startTime: currentTime, endTime: currentTime + 1 });
  }

  return words.length > 0 ? words : null;
}

// 解析网易云原生逐字歌词（yrc）：字级时间戳毫秒格式
// 行结构：[行起始毫秒,行时长毫秒](字起始,字时长,0)字(字起始,字时长,0)字 ...
// 产出与 parseLRC 同构的 { lines }，words 带真实 startTime/endTime（秒），
// 逐字引擎与渲染层无需任何改动即可点亮
function parseYRC(yrcContent) {
  if (!yrcContent) return { metadata: {}, lines: [] };

  var rows = yrcContent.split('\n');
  var result = [];

  for (var i = 0; i < rows.length; i++) {
    var row = rows[i].trim();
    if (!row) continue;

    var head = row.match(/^\[(\d+),(\d+)\]/);
    if (!head) continue;

    var lineStart = parseInt(head[1], 10) / 1000;
    var body = row.substring(head[0].length);

    // split 带捕获组：['前导', s, d, text, s, d, text, ...]
    var parts = body.split(/\((\d+),(\d+),\d+\)/);
    var words = [];
    for (var p = 1; p + 2 <= parts.length - 1; p += 3) {
      var ws = parseInt(parts[p], 10) / 1000;
      var wd = parseInt(parts[p + 1], 10) / 1000;
      var wtext = parts[p + 2] || '';
      if (!wtext) continue;
      words.push({ text: wtext, startTime: ws, endTime: ws + wd });
    }

    var plainText = words.map(function (w) { return w.text; }).join('');
    if (!plainText) continue; // 纯音乐行 / 空行
    if (shouldSkipLine(plainText, lineStart)) continue; // 作词/作曲等元数据行

    var chars = [];
    for (var ci = 0; ci < plainText.length; ci++) chars.push(plainText.charAt(ci));

    result.push({
      time: lineStart,
      text: plainText,
      words: words,
      _chars: chars,
      isChinese: isChineseText(plainText),
      isForeign: isForeignText(plainText),
      hasJP: hasJapaneseKorean(plainText),
      translation: null
    });
  }

  return { metadata: {}, lines: result };
}

function parseLRC(lrcContent) {
  if (!lrcContent) return { metadata: {}, lines: [] };

  var lines = lrcContent.split('\n');
  var raw = [];
  var metadata = {};

  for (var i = 0; i < lines.length; i++) {
    var line = lines[i].trim();
    if (!line) continue;

    var metaMatch = line.match(/^\[([a-zA-Z]+):(.*)\]$/);
    if (metaMatch) {
      var tag = metaMatch[1].toLowerCase();
      if (tag === 'ti' || tag === 'ar' || tag === 'al' || tag === 'by' || tag === 'offset' || tag === 'length') {
        metadata[tag] = metaMatch[2].trim();
      }
      continue;
    }

    var timestampRegex = /\[(\d{1,3}:\d{2}(?:\.\d{1,3})?)\]/g;
    var timestamps = [];
    var match;

    while ((match = timestampRegex.exec(line)) !== null) {
      timestamps.push({
        time: parseTime(match[1]),
        index: match.index,
        end: match.index + match[0].length
      });
    }

    if (timestamps.length === 0) continue;

    for (var j = 0; j < timestamps.length; j++) {
      var ts = timestamps[j];
      var textEnd = (j + 1 < timestamps.length) ? timestamps[j + 1].index : line.length;
      var text = line.substring(ts.end, textEnd).trim();

      text = cleanJunkText(text);

      if (shouldSkipLine(text, ts.time)) continue;

      var words = parseWords(ts.time, text);
      var plainText = words ? words.map(function(w) { return w.text; }).join('') : text;
      var chars = [];
      for (var ci = 0; ci < plainText.length; ci++) {
        chars.push(plainText.charAt(ci));
      }

      raw.push({
        time: ts.time,
        text: plainText,
        words: words,
        _chars: chars,
        isChinese: isChineseText(plainText),
        isForeign: isForeignText(plainText),
        hasJP: hasJapaneseKorean(plainText),
        translation: null
      });
    }
  }

  raw.sort(function(a, b) { return a.time - b.time; });

  var dedup = [];
  for (var d = 0; d < raw.length; d++) {
    if (dedup.length > 0) {
      var last = dedup[dedup.length - 1];
      if (last.text === raw[d].text && Math.abs(last.time - raw[d].time) < 0.01) {
        continue;
      }
    }
    dedup.push(raw[d]);
  }

  var result = [];
  for (var k = 0; k < dedup.length; k++) {
    var prev = result.length > 0 ? result[result.length - 1] : null;

    if (!prev || prev.translation) {
      result.push(dedup[k]);
      continue;
    }

    var prevCjk = cjkRatio(prev.text);
    var currCjk = cjkRatio(dedup[k].text);
    var timeDiff = Math.abs(dedup[k].time - prev.time);

    if (timeDiff > 10) {
      result.push(dedup[k]);
      continue;
    }

    var matched = false;

    if (prev.hasJP && !dedup[k].hasJP && currCjk > prevCjk) {
      prev.translation = dedup[k].text;
      matched = true;
    } else if (!prev.hasJP && !dedup[k].hasJP && currCjk > prevCjk && currCjk > 0) {
      prev.translation = dedup[k].text;
      matched = true;
    } else if (prevCjk >= 0.4 && currCjk >= 0.4 && !prev.hasJP && !dedup[k].hasJP && timeDiff < 0.5) {
      prev.translation = dedup[k].text;
      matched = true;
    } else if (prevCjk < 0.1 && currCjk >= 0.15 && timeDiff <= 5) {
      prev.translation = dedup[k].text;
      matched = true;
    }

    if (!matched) {
      result.push(dedup[k]);
    }
  }

  for (var m = 0; m < result.length; m++) {
    if (result[m].words && result[m].words.length > 0) {
      var lastWord = result[m].words[result[m].words.length - 1];
      if (lastWord.endTime <= lastWord.startTime) {
        var nextTime = m < result.length - 1 ? result[m + 1].time : lastWord.startTime + 2;
        lastWord.endTime = nextTime;
      }
    }
  }

  return { metadata: metadata, lines: result };
}

function findCurrentLine(lines, currentTime) {
  if (!lines || lines.length === 0) return -1;
  for (var i = lines.length - 1; i >= 0; i--) {
    if (currentTime >= lines[i].time) {
      return i;
    }
  }
  return -1;
}

function getWordProgress(line, word, currentTime) {
  if (!word || currentTime < word.startTime) return 0;
  if (currentTime >= word.endTime) return 1;
  var duration = word.endTime - word.startTime;
  if (duration <= 0) return 1;
  return (currentTime - word.startTime) / duration;
}

export default {
  parseLRC: parseLRC,
  parseYRC: parseYRC,
  findCurrentLine: findCurrentLine,
  getWordProgress: getWordProgress
};
