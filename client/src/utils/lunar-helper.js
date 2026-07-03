/**
 * 农历/节日/节气辅助模块
 * 封装 lunar-javascript，提供统一的日期信息查询接口
 */
import Lunar from 'lunar-javascript';

// 公历固定节日（月-日 → 名称）
var SOLAR_FESTIVALS = {
  '01-01': '元旦',
  '02-14': '情人节',
  '03-08': '妇女节',
  '03-12': '植树节',
  '04-01': '愚人节',
  '05-01': '劳动节',
  '05-04': '青年节',
  '06-01': '儿童节',
  '07-01': '建党节',
  '08-01': '建军节',
  '09-10': '教师节',
  '10-01': '国庆节',
  '11-11': '光棍节',
  '12-25': '圣诞节'
};

/**
 * 获取农历信息
 * @param {Date} date
 * @returns {Object} { lunarMonthName, lunarDayName, yearGanZhi, zodiac, lunarMonth, lunarDay }
 */
function getLunarDate(date) {
  try {
    var solar = Lunar.Solar.fromDate(date);
    var lunar = solar.getLunar();
    return {
      lunarMonth: lunar.getMonth(),
      lunarDay: lunar.getDay(),
      lunarMonthName: lunar.getMonthInChinese(),
      lunarDayName: lunar.getDayInChinese(),
      yearGanZhi: lunar.getYearInGanZhi(),
      zodiac: lunar.getYearShengXiao()
    };
  } catch (e) {
    return null;
  }
}

/**
 * 获取农历节日
 * @param {Date} date
 * @returns {Array<string>} 节日名称数组
 */
function getLunarFestivals(date) {
  try {
    var solar = Lunar.Solar.fromDate(date);
    var lunar = solar.getLunar();
    var festivals = lunar.getFestivals();
    return festivals || [];
  } catch (e) {
    return [];
  }
}

/**
 * 获取公历节日
 * @param {Date} date
 * @returns {Array<string>} 节日名称数组
 */
function getSolarFestivals(date) {
  var result = [];
  var key = (date.getMonth() + 1 < 10 ? '0' : '') + (date.getMonth() + 1) + '-' + (date.getDate() < 10 ? '0' : '') + date.getDate();
  if (SOLAR_FESTIVALS[key]) {
    result.push(SOLAR_FESTIVALS[key]);
  }
  // 也从 lunar-javascript 获取
  try {
    var solar = Lunar.Solar.fromDate(date);
    var festivals = solar.getFestivals();
    if (festivals && festivals.length > 0) {
      for (var i = 0; i < festivals.length; i++) {
        if (result.indexOf(festivals[i]) === -1) result.push(festivals[i]);
      }
    }
  } catch (e) {}
  return result;
}

/**
 * 获取节气（如有）
 * @param {Date} date
 * @returns {string} 节气名，无则返回空字符串
 */
function getSolarTerm(date) {
  try {
    var solar = Lunar.Solar.fromDate(date);
    var lunar = solar.getLunar();
    var jieQi = lunar.getJieQi();
    // getJieQi 当天不是节气时返回空字符串
    return jieQi || '';
  } catch (e) {
    return '';
  }
}

/**
 * 获取日期的完整信息（农历 + 节日 + 节气）
 * @param {Date} date
 * @returns {Object} { lunar, lunarFestivals, solarFestivals, solarTerm }
 */
function getDateInfo(date) {
  return {
    lunar: getLunarDate(date),
    lunarFestivals: getLunarFestivals(date),
    solarFestivals: getSolarFestivals(date),
    solarTerm: getSolarTerm(date)
  };
}

export { getLunarDate, getLunarFestivals, getSolarFestivals, getSolarTerm, getDateInfo };
export default { getLunarDate, getLunarFestivals, getSolarFestivals, getSolarTerm, getDateInfo };
