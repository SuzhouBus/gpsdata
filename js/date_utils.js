class DateUtils {
  static formatNumber_(number) {
    let result = number.toString();
    return result.length == 1 ? '0' + result : result;
  }

  static formatDate(y, m, d) {
    let result = y.toString();
    if (m) {
      result += '-' + DateUtils.formatNumber_(m);
    }
    if (d) {
      result +=  '-' + DateUtils.formatNumber_(d);
    }
    return result;
  }

  static toYearMonth(date) {
    let monthIndexMinusOne = date.indexOf('-');
    if (monthIndexMinusOne == -1)
      return date;
    let dayIndexMinusOne = date.indexOf('-', monthIndexMinusOne + 1);
    if (dayIndexMinusOne == -1)
      return date;
    return date.substr(0, dayIndexMinusOne);
  }

  static nextMonth(date) {
    let components = date.split('-').map(x => parseInt(x));
    components[1]++;
    if (components[1] > 12) {
      components[0] += Math.floor(components[1] / 12);
      components[1] %= 12;
    }
    if (components[2] && components[2] > DateUtils.daysInMonths(components[1]))
      components[2] = DateUtils.daysInMonths(components[1]);
    return DateUtils.formatDate.apply(null, components);
  }

  static previousMonth(date) {
    let components = date;
    if (typeof date == 'string')
      components = date.split('-').map(x => parseInt(x));
    components[1]--;
    if (components[1] == 0) {
      components[0]--;
      components[1] = 12;
    }
    if (components[2] && components[2] > DateUtils.daysInMonths(components[1]))
      components[2] = DateUtils.daysInMonth(components[1]);
    return DateUtils.formatDate.apply(null, components);
  }

  static yesterday(date) {
    let components = date.split('-').map(x => parseInt(x));
    components[2]--;
    if (components[2] == 0) {
      let ym = DateUtils.previousMonth(components.slice(0, 2));
      let ymc = ym.split('-').map(x => parseInt(x));
      return ym + '-' + DateUtils.formatNumber_(DateUtils.daysInMonth(ymc[0], ymc[1]));
    }
    return DateUtils.formatDate.apply(null, components);
  }

  static isLeapYear(year) {
    year = parseInt(year);
    return year % 400 == 0 || (year % 100 != 0 && year % 4 == 0);
  }

  static daysInMonth(year, month) {
    month = parseInt(month);
    return month == 2 && DateUtils.isLeapYear(year) ? 29 : DateUtils.daysInMonthsMap_[month];
  }
}

DateUtils.daysInMonthsMap_ = [
  undefined, // 0
  31, // Jan
  28, // Feb (NON LEAP YEAR)
  31, // Mar
  30, // Apr
  31, // May
  30, // Jun
  31, // Jul
  31, // Aug
  30, // Sep
  31, // Oct
  30, // Nov
  31, // Dec
];

