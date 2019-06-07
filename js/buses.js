class ManifestLoader {
  constructor() {
    this.loadedExtraManifests_ = {};
  }
  loadManifest() {
    if (this.manifest)
      return Promise.resolve(this.manifest);

    return fetch('manifest.json').then(response => {
      if (window.TextDecoder && response.body && response.body.getReader) {
        this.fetchSupportsReadableStream = true;
      }
      if (response.headers.get('X-Service-Worker-Fallback')) {
        this.offline = true;
      }
      return response.json();
    }).then(manifest_ => {
      // TODO: Remove these code after they are eventually removed from the manifest.
      ['archives', 'line_name_map', 'line_name_prefix_map', 'line_name_suffix_map', 'line_name_suffix_order', 'unrelated_lines'].forEach(deprecatedKey => {
        if (manifest_[deprecatedKey]) {
          manifest_[deprecatedKey + '_DEPRECATED'] = manifest_[deprecatedKey];
          delete manifest_[deprecatedKey];
        }
      });
      // TODO: Remove this also.
      ['sources'].forEach(key => {
        let newKey = key + '_NEW';
        if (manifest_[newKey]) {
          manifest_[key] = manifest_[newKey];
          delete manifest_[newKey];
        }
      });
      this.manifest = manifest_;
      return manifest_;
    });
  }
  
  loadExtraManifest_(path) {
    if (this.loadedExtraManifests_[path])
      return Promise.resolve(this.manifest);
    return fetch(path).then(r => r.json()).then(manifest_ => Object.assign(this.manifest, this.loadedExtraManifests_[path] = manifest_));
  }

  loadArchives() {
    return this.loadExtraManifest_('manifest_archives.json');
  }

  loadExtra() {
    return this.loadExtraManifest_('manifest_extra.json');
  }
}

class LineDataManager {
  constructor() {
    this.manifestLoader = new ManifestLoader();
    this.loadedLineData_ = {};
    this.lineData_ = {};
    this.linesByGroup_ = {};
    this.lineGroupMap_ = {};
    this.lineDisplayNameMap_ = {};
  }

  initAsync() {
    return this.manifestLoader.loadManifest().then(manifest => {
      this.manifest = manifest;
      if (this.manifestLoader.offline)
        this.offline = this.manifestLoader.offline;
      this.fetchSupportsReadableStream_ = this.manifestLoader.fetchSupportsReadableStream;
      this.latestDate = this.manifest.last_update_time.substring(0, 10);
      if (this.manifest.default_enabled_line_groups)
        this.enabledGroups = this.manifest.default_enabled_line_groups;
      this.initializeLineNameMap_();
    });
  }

  initializeLineNameMap_() {
    this.lineNameMap_ = {};
    let existingLines = {};
    this.manifest.sources.forEach(source => {
      this.lineNameMap_[source] = {};
      if (this.manifest.lines[source]) {
        this.manifest.lines[source].forEach(lineName => {
          if (lineName != '__+BEGIN_LINES+__' && lineName != '__+END_LINES+__' && existingLines[lineName]) {
            let i;
            for (i = 2; existingLines[lineName + '_' + i]; ++i);
            existingLines[lineName + '_' + i] = true;
            this.lineNameMap_[source][lineName] = lineName + '_' + i;
          } else {
            existingLines[lineName] = true;
          }
        });
      }
    });
  }

  appendLineDataToLoad_(dataToLoad, month, sourceOrSources) {
    if (typeof sourceOrSources == 'string')
      sourceOrSources = [sourceOrSources];
    else if (sourceOrSources == undefined) {
      sourceOrSources = this.manifest.sources;
    }
    if (this.enabledGroups && !this.enabledGroups.includes('*'))
      sourceOrSources = sourceOrSources.filter(source => this.enabledGroups.includes(this.manifest.line_group_map[source] || ''));
    Array.prototype.push.apply(dataToLoad,
        sourceOrSources.filter(source => !this.loadedLineData_[month] || !this.loadedLineData_[month][source]).map(source => {
          if (month == 'current')
            return {month: month, source: source, sizeHint: this.manifest.size_hints[source]};
          else if (this.manifest.archives[source] && this.manifest.archives[source].lengths)
            return {month: month, source: source, lengthTotal: this.manifest.archives[source].lengths[month], lengthAccurate: true};
          else
            return {month: month, source: source};
        }));
    return dataToLoad;
  }

  isRangeOverlapped_(start1, end1, start2, end2) {
    return start1 <= end2 && end1 >= start2;
  }

  getDataToLoad_(startDate, endDate) {
    let dataToLoad = [];
    if (this.isRangeOverlapped_(startDate, endDate, this.manifest.start_date, this.latestDate)) {
      this.appendLineDataToLoad_(dataToLoad, 'current');
    }

    if (startDate < this.manifest.start_date) { // [-inf, manifest.start_date) and [startDate, endDate] have intersection
      if (startDate < this.earliestDate)
        startDate = this.earliestDate;
      if (endDate >= this.manifest.start_date)
        endDate = DateUtils.yesterday(this.manifest.start_date);

      if (startDate <= endDate) {
        let archivedSources = Object.keys(this.manifest.archives || {}).map(source => {
          let result = Object.assign({}, this.manifest.archives[source], {name: source});
          result.start_month = DateUtils.toYearMonth(result.start_date);
          result.end_month = DateUtils.toYearMonth(result.end_date);
          return result;
        }).filter(source => this.isRangeOverlapped_(startDate, endDate, source.start_date, source.end_date));
        for (let currentMonth = DateUtils.toYearMonth(startDate);
            currentMonth <= DateUtils.toYearMonth(endDate);
            currentMonth = DateUtils.nextMonth(currentMonth)) {
          this.appendLineDataToLoad_(dataToLoad, currentMonth,
              archivedSources.filter(source => currentMonth >= source.start_month && currentMonth <= source.end_month).
              map(source => source.name));
        }
      }
    }

    return dataToLoad;
  }

  async load(startDate, endDate) {
    if (startDate < this.manifest.start_date) {
      await this.manifestLoader.loadArchives().then(manifest => {
        this.earliestDate = Object.keys(manifest.archives || {}).
            map(source => manifest.archives[source].start_date).
            concat([this.manifest.start_date]).
            reduce((result, date) => date < result ? date : result, '9999-99-99');
      });
    }

    let dataToLoad = this.getDataToLoad_(startDate, endDate);
    
    for (let item of dataToLoad) {
      let path;
      let length = item.lengthTotal || 0;
      let lengthAccurate = true;
      let fileName = item.month.replace('-', '') + '.json';
      if (item.month == 'current') {
        path = this.manifest.data[item.source];
      } else {
        path = this.manifest.archives[item.source].path + fileName;
      }
      await fetch(path).then(async response => {
        if (window.TextDecoder && response.body && response.body.getReader) {
          if (!length) {
            let contentEncoding = response.headers.get('Content-Encoding');
            let contentLength = response.headers.get('Content-Length');
            if ((!contentEncoding || contentEncoding == 'identity') && contentLength) {
              length = contentLength;
            } else if (contentEncoding == 'gzip' && contentLength) {
              length = contentLength / (this.manifest.gzip_ratio_hint || 0.5);
              lengthAccurate = false;
            }
          }

          if (length) {
            item.lengthTotal = length;
            item.lengthAccurate = lengthAccurate;
            item.lengthLoaded = 0;
            let reader = response.body.getReader();
            let done = false;
            let decoder = new TextDecoder();
            let json = '';
            while (!done) {
              await reader.read().then(result => {
                if (result.done) {
                  done = true;
                }
                if (result.value) {
                  json += decoder.decode(result.value, {stream: result.done});
                  item.lengthLoaded += result.value.length;
                  this.onUpdateProgress && this.onUpdateProgress(dataToLoad, item);
                }
              });
            }
            return JSON.parse(json);
          }
        }

        return response.json();
      }).then(data => {
        if (!this.loadedLineData_[item.month])
          this.loadedLineData_[item.month] = {};
        this.loadedLineData_[item.month][item.source] = data;
        this.importData_(item.month, item.source);
        item.loaded = true;
        this.onUpdateProgress && this.onUpdateProgress(dataToLoad, item);
      }).catch(_ => item.loaded = false, Promise.resolve());
    }

    return dataToLoad;
  }

  importData_(month, source) {
    let groupId = (this.manifest.line_group_map || {})[source] || '';
    let groupDetails = (this.manifest.line_groups || {})[groupId] || {};
    let data = this.loadedLineData_[month][source];

    Object.keys(data).forEach(line => {
      let lineName = this.lineNameMap_[source][line] || line;
      lineName = this.formatInternalLineName_(lineName, groupDetails);
      if (!this.lineData_[lineName])
        this.lineData_[lineName] = {};
      this.lineData_[lineName][month] = data[line];

      this.lineGroupMap_[lineName] = groupId;
      if (!this.linesByGroup_[groupId]) {
        this.linesByGroup_[groupId] = new Set([lineName]);
      } else if (this.linesByGroup_[groupId].has(lineName)) {
        return; // Do not invalidate cache if the line exists (not adding a new line).
      } else {
        this.linesByGroup_[groupId].add(lineName);
      }
      this.cachedLines_ = null;
    });
  }

  isDataLoaded(startDate, endDate) {
    if (startDate < this.manifest.start_date && !this.earliestDate)
      return false;
    return this.getDataToLoad_(startDate, endDate).length == 0;
  }

  getMonthsByRange_(startDate, endDate) {
    return Object.keys(this.loadedLineData_).filter(month => {
      if (month == 'current') {
        return this.isRangeOverlapped_(startDate, endDate, this.manifest.start_date, this.latestDate);
      } else {
        return DateUtils.toYearMonth(startDate) <= month && DateUtils.toYearMonth(endDate) >= month;
      }
    });
  }

  queryLines(lineOrLines, startDate, endDate) {
    if (typeof lineOrLines == 'string') {
      lineOrLines = [lineOrLines];
    }

    let allBusesMap = {};
    let lineDetailsMap = {};

    lineOrLines.forEach((line, lineIndex) => {
      this.getMonthsByRange_(startDate, endDate).sort().forEach(month => { // Note: 'current' is always sorted after yyyy-mm.
        let currentLineData = this.lineData_[line][month];
        if (!currentLineData)
          return;
        currentLineData.buses.forEach(bus => {
          if (!allBusesMap[bus.licenseId]) {
            allBusesMap[bus.licenseId] = Object.assign({}, bus);
          } else if(allBusesMap[bus.licenseId].busId != bus.busId) {
            allBusesMap[bus.licenseId].busId = bus.busId;
          }
        });

        currentLineData.details.filter(day => day[0] >= startDate && day[0] <= endDate).forEach(day => {
          if (!lineDetailsMap[day[0]]) {
            lineDetailsMap[day[0]] = {};
          }
          for (let i = 0; i < currentLineData.buses.length; ++i) {
            let licenseId = currentLineData.buses[i].licenseId;
            if (!lineDetailsMap[day[0]][licenseId])
              lineDetailsMap[day[0]][licenseId] = new Array(lineOrLines.length).fill(0);
            let currentWeight = day[1][i];
            lineDetailsMap[day[0]][licenseId][lineIndex] = currentWeight;
            if (currentWeight > 0) {
              allBusesMap[licenseId]['hasWeight'] = true;
            }
          }
        });
      });
    });

    let buses = this.sortBuses_(Object.keys(allBusesMap).filter(licenseId => allBusesMap[licenseId]['hasWeight']).map(licenseId => allBusesMap[licenseId]));

    let allZeroes = new Array(lineOrLines.length).fill(0);
    let details = Object.keys(lineDetailsMap).sort().map(date => [date, buses.map(bus => lineDetailsMap[date][bus.licenseId] || allZeroes)]);

    return {buses: buses, details: details};
  }

  containsLines(lineOrLines) {
    if (typeof lineOrLines == 'string')
      lineOrLines = [lineOrLines];
    return !lineOrLines.some(line => !this.lineData_[line]);
  }

  // query = {busId: [...], licenseId: [...], lines: [...]}
  // where |busId| and |licenseId| can contain:
  // * '1-1001' / '3G317'
  // * {start: '1-1001', end: '1-1008'}
  // * {prefix: '1-29'}
  // * {suffix: '*D'}
  //
  // Returns
  // {lines: [...], buses: [...], details: [...]}
  // where |buses| and |details| will be returned if returnDetails is true.
  // TODO: Consider line groups here:
  // * Skip groups that do not have bus id for bus id queries.
  // * Return with group information?
  queryBuses(query, startDate, endDate, returnDetails) {
    let linesSet = new Set();
    let allBusesMap = {};
    let busDetailsMap = {}; // busDetailsMap[date][licenseId][line] = weight

    (query.lines || Object.keys(this.lineData_)).forEach(line => {
      this.getMonthsByRange_(startDate, endDate).sort().forEach(month => {
        let currentLineData = this.lineData_[line][month];
        let currentLineDetails = null;
        if (!currentLineData)
          return;

        currentLineData.buses.forEach((bus, busIndex) => {
          if (this.compareBus_(bus, query)) {
            if (!allBusesMap[bus.licenseId]) {
              allBusesMap[bus.licenseId] = Object.assign({}, bus);
            } else if(allBusesMap[bus.licenseId].busId != bus.busId) {
              allBusesMap[bus.licenseId].busId = bus.busId;
            }

            if (!currentLineDetails)
              currentLineDetails = currentLineData.details.filter(day => day[0] >= startDate && day[0] <= endDate);
            for (let day of currentLineDetails) {
              if (!busDetailsMap[day[0]]) {
                busDetailsMap[day[0]] = {};
              }

              let weight = day[1][busIndex];
              if (weight > 0) {
                if (!busDetailsMap[day[0]][bus.licenseId]) {
                  busDetailsMap[day[0]][bus.licenseId] = {};
                }
                busDetailsMap[day[0]][bus.licenseId][line] = weight;

                linesSet.add(line);
                if (!returnDetails)
                  break;
              }
            }
          }
        });
      });
    });

    let lines = this.sortLines_(Array.from(linesSet));
    if (!returnDetails)
      return {lines: lines};

    let buses = this.sortBuses_(Object.keys(allBusesMap).map(licenseId => allBusesMap[licenseId]));
    let details = Object.keys(busDetailsMap).sort().map(date =>
        [date, buses.map(bus => lines.map(line => (busDetailsMap[date][bus.licenseId] || {})[line] || 0))]);
    return {lines: lines, buses: buses, details: details};
  }

  getLineFullName(line) {
    if (this.lineData_[line])
      return line;
    // When the string does not contain '_', indexOf returns -1, and substring treats it as 0, returning an empty string and would not match.
    return Object.keys(this.lineData_).find(cur => cur.substring(0, cur.indexOf('_')) == line);
  }

  // TODO: Consider consolidate this function with queryBuses.
  queryCurrentBus(line, licenseId) {
    let lineData = this.lineData_[this.getLineFullName(line)];
    if (lineData)
      return lineData['current'].buses.find(bus => bus.licenseId == licenseId);
  }

  hasBusId(lineOrLines) {
    if (typeof lineOrLines == 'string') {
      lineOrLines = [lineOrLines];
    }
    for (let line of lineOrLines) {
      let options = (this.manifest.line_groups && this.manifest.line_groups[this.lineGroupMap_[line]]) || this.manifest;
      if (options.has_bus_id !== false)
        return true;
    }
    return false;
  }

  compareBus_(bus, query) {
    let result = false;
    ['busId', 'licenseId'].forEach(queryKey => {
      if (query[queryKey]) {
        result |= query[queryKey].some(queryDetails => {
          if (typeof queryDetails == 'string') {
            return bus[queryKey] == queryDetails;
          } else if (queryDetails.start && queryDetails.end) {
            return bus[queryKey] >= queryDetails.start && bus[queryKey] <= queryDetails.end;
          } else if (queryDetails.prefix) {
            return bus[queryKey].substr(0, queryDetails.prefix.length) == queryDetails.prefix;
          } else if (queryDetails.suffix) {
            return bus[queryKey].substr(-queryDetails.suffix.length) == queryDetails.suffix;
          }
        });
      }
    });
    return result;
  }

  getLines() {
    const REGEX = /^([^0-9]*[0-9]+)([^_]*)(.*)$/;
    if (this.cachedLines_)
      return this.cachedLines_;

    return this.cachedLines_ = this.getGroups().map(group => {
      let options = ((this.manifest.line_groups || {})[group.id] || this.manifest)
      let result = Object.assign({}, group, {
        rawLines: this.sortLines_(Array.from(this.linesByGroup_[group.id]), options),
        lines: [],
      });
      let unrelatedLines = options.unrelated_lines || [];
      let relatedLines = (options.related_lines || []);
      if (options.namespace)
        relatedLines = relatedLines.map(relatedGroup => relatedGroup.map(line => options.namespace + ':' + line));
      let relatedLinesMap = {};
      relatedLines.forEach(relatedGroup => relatedGroup.forEach(line => relatedLinesMap[line] = relatedGroup));
      let processedRelatedLines = new Set();
      let lastMatch = null;
      result.rawLines.forEach(line => {
        if (processedRelatedLines.has(line))
          return;

        if (relatedLinesMap[line]) {
          let relatedGroup = relatedLinesMap[line];
          relatedGroup.forEach(line => processedRelatedLines.add(line));
          result.lines.push({idlist: relatedGroup, displayName: this.getLineDisplayName(relatedGroup[0])});
          return;
        }

        let match = REGEX.exec(line);
        if (lastMatch && match && lastMatch[1] == match[1] && lastMatch[3] == match[3] && !unrelatedLines.includes(match[1] + match[2])) {
          let lastLine = result.lines[result.lines.length - 1];
          if (!lastLine.idlist) {
            lastLine.idlist = [lastLine.id];
            delete lastLine.id;
            let commonPrefixLength = 0;
            let currentDisplayName = this.getLineDisplayName(line);
            while (lastLine.displayName[commonPrefixLength] && lastLine.displayName[commonPrefixLength] == currentDisplayName[commonPrefixLength])
              ++commonPrefixLength;
            lastLine.displayName = currentDisplayName.substring(0, commonPrefixLength);
            // HACK: Special character handling:
            // * （ is included in the common prefix but should not be in the display name.
            // * 路 should be preserved if the original display name ends with it.
            if (lastLine.displayName.slice(-1) == '（')
              lastLine.displayName = lastLine.displayName.slice(0, -1);
            else if (currentDisplayName.slice(-1) == '路' && lastLine.displayName.slice(-1) != '路')
              lastLine.displayName = lastLine.displayName + '路';
          }
          lastLine.idlist.push(line);
        } else {
          result.lines.push({id: line, displayName: this.getLineDisplayName(line)});
        }
        lastMatch = match;
      });
        //.map(line => ({id: line, displayName: this.getLineDisplayName(line)}))
      return result;
    });
  }

  getLineCount() {
    return this.getLines().reduce((result, group) => result + group.lines.length, 0);
  }

  sortLines_(lines, options) {
    if (!options)
      options = {};

    return lines.sort((a, b) => {
      const pureNumberRegEx = /^[0-9]+$/;
      const lineNameParserRegEx = /^([^:]*:)?([A-Z]*)([0-9]*)([A-Z]*)(?:_([0-9]+))?$/;

      if (options.line_name_map) {
        if (options.line_name_map[a])
          a = options.line_name_map[a];
        if (options.line_name_map[b])
          b = options.line_name_map[b];
      }

      if (pureNumberRegEx.test(a) && pureNumberRegEx.test(b))
        return this.compareNumbers_(a, b);

      a = {full: a};
      b = {full: b};
      [a, b].forEach(x => {
        let match = lineNameParserRegEx.exec(x.full);
        if (match && match[0]) {
          if (match[1])
            x.namespacePrefix = match[1];
          if (match[2])
            x.prefixAlpha = match[2];
          if (match[3])
            x.numberPart = match[3];
          if (match[4])
            x.suffixAlpha = match[4];
          if (match[5])
            x.copyNumber = match[5];
        } else
          x.other = true;
      });

      let result = this.compareWithoutCopyNumber_(a, b, options);
      return result == 0 ?  this.compareNumbers_(a.copyNumber || -1, b.copyNumber || -1, 'natural') : result;
    });
  }

  compareWithoutCopyNumber_(a, b, options) {
    // TODO: |namespacePrefix| is parsed now. Is it necessary to compare them? (Currently namespace is unique for any group and lines from different groups are separately sorted).
    if (a.other && b.other)
      return this.defaultCompare_(a, b);
    if (a.other && !b.other) // |a|(other) > |b|(normal)
      return 1;
    if (!a.other && b.other) // |a|(normal) < |b|(other)
      return -1;

    // Here both a and b can be parsed into three optional parts.
    if (a.prefixAlpha && !b.prefixAlpha) // a(X1) > b(2)
      return 1;
    if (!a.prefixAlpha && b.prefixAlpha) // a(1) < b(X2)
      return -1;

    if (a.numberPart && !b.numberPart) // a(x1n) < b(yy)
      return -1;
    if (!a.numberPart && b.numberPart) // a(xx) > b(y2s)
      return 1;

    if(a.prefixAlpha && b.prefixAlpha && ((!a.numberPart && !b.numberPart) || a.prefixAlpha != b.prefixAlpha))
      return this.defaultCompare_(a.prefixAlpha, b.prefixAlpha);

    // Here neither a nor b could have |prefixAlpha| or they have the same |prefixAlpha|, which can be ignored for further comparison.
    // If neither a nor b have |numberPart|, they must only have |prefixAlpha|, without |suffixAlpha|.
    // As a result, further comparisons compare |numberPart| first, then |suffixAlpha| if |numberPart| are the same.

    let result = this.compareNumbers_(a.numberPart, b.numberPart);

    if (result == 0) {
      let definedOrder = [undefined].concat(options.line_name_suffix_order || []);
      [a.suffixAlpha, b.suffixAlpha].sort().forEach(x => !definedOrder.includes(x) && definedOrder.push(x));
      return this.defaultCompare_(definedOrder.indexOf(a.suffixAlpha), definedOrder.indexOf(b.suffixAlpha));
    }

    return result;
  }

  compareNumbers_(a, b, sortOrder) {
    let plainSort = (sortOrder || this.linesSortOrder) == 'plain';
    if (plainSort && (!typeof a == 'number' || !typeof b == 'number')) {
      // 'plain' sorts by strings.
      a = a.toString();
      b = b.toString();
    } else if (!plainSort && (typeof a == 'string' || typeof b == 'string')) {
      // 'natural' sorts by numbers.
      a = parseInt(a);
      b = parseInt(b);
    }
    return this.defaultCompare_(a, b);
  }

  defaultCompare_(a, b) {
    if (a < b)
      return -1;
    else if (a > b)
      return 1;
    else
      return 0;
  }

  sortBuses_(buses) {
    return buses.sort((a, b) => {
      if (a.busId && b.busId) { // Buses with busId are sorted by busId.
        if (a.busId < b.busId)
          return -1;
        else if (a.busId > b.busId)
          return 1;
        else
          return 0;
      } else if (a.busId && !b.busId) // a < b, buses without busId is placed after all other buses with busId.
        return -1;
      else if (!a.busId && b.busId) // a > b, the same as above.
        return 1;
      else
        return this.defaultCompare_(a.licenseId, b.licenseId); // Buses without busId are sorted by licenseId.
    });
  }

  // Groups are ordered in the following rules:
  // 1. Default group ('', or having no group) comes first.
  // 2. Groups listed in manifest.line_group_order are ordered accordingly after the default group.
  // 3. Remaining groups are placed in the end, without well-defined order (compared with |defaultCompare_|).
  getGroups() {
    let order = [''].concat(this.manifest.line_group_order || []);
    return Object.keys(this.linesByGroup_).sort((a, b) => {
      let indexA = order.indexOf(a);
      let indexB = order.indexOf(b);
      if (indexA != -1 && indexB != -1)
        return indexA - indexB;
      else if (indexA == -1 && indexB != -1)
        return 1; // (remaining groups > defined groups)
      else if (indexA != -1 && indexB == -1)
        return -1; // (defined groups < remaining groups)
      else
        return this.defaultCompare_(a, b);
    }).map(group => ({id: group, displayName: (this.manifest.line_groups[group] || {}).name || group}));
  }

  getLineDisplayName(line, options) {
    // TODO: '_2' suffixes are not properly handled now.
    let group = this.lineGroupMap_[line];
    line = this.lineDisplayNameMap_[line] || line;
    if (!options)
      options= (this.manifest.line_groups && this.manifest.line_groups[group]) || this.manifest;

    if (options.line_name_map && options.line_name_map[line])
      return this.getLineDisplayName(options.line_name_map[line], options);

    let match = /^([^0-9]*)([0-9]+)([^0-9_]*)(.*)$/.exec(line);
    if (match) {
      if (match[1] && options.line_name_prefix_map && options.line_name_prefix_map[match[1]]) {
        let prefix = options.line_name_prefix_map[match[1]];
        if (typeof prefix == 'string') {
          match[1] = prefix;
        } else {
          match[1] = prefix[0];
          match[2] += prefix[1];
        }
      }
      if (match[3] && options.line_name_suffix_map && options.line_name_suffix_map[match[3]]) {
        match[3] = '（' + options.line_name_suffix_map[match[3]] + '）';
      }

      return match[1] + match[2] + match[3] + match[4];
    }
    return line;
  }

  formatInternalLineName_(originalName, group) {
    let options = group || this.manifest;
    let internalName = originalName;

    if (options.line_name_reverse_map && options.line_name_reverse_map[internalName])
      internalName = options.line_name_reverse_map[internalName];
    else { // line_name_reverse_map is final and no further parsing is done.
      for (let [prefix, value] of Object.entries(options.line_name_prefix_reverse_map || {})) {
        if (internalName.substring(0, prefix.length) == prefix) {
          internalName = value + internalName.substring(prefix.length);
          break;
        }
      }
      for (let [suffix, value] of Object.entries(options.line_name_suffix_reverse_map || {})) {
        if (internalName.slice(-suffix.length) == suffix) {
          internalName = internalName.slice(0, -suffix.length) + value;
          break;
        }
      }
    }

    let qualifiedInternalName = internalName;
    if (group.namespace)
      qualifiedInternalName = group.namespace + ':' + qualifiedInternalName;
    // Save internal name -> original name (display name) map. The original name would be discarded and lost otherwise.
    if (qualifiedInternalName != originalName) {
      // Apply line name map if any.
      if (group.line_name_map && group.line_name_map[internalName])
        originalName = group.line_name_map[internalName];
      this.lineDisplayNameMap_[qualifiedInternalName] = originalName;
    }
    return qualifiedInternalName;
  }

  getLastUpdateTime() {
    return this.manifest.last_update_time;
  }
}

class HolidayParser {
  constructor(manifest) {
    this.holidays = manifest.special_holidays;
  }

  isHoliday(date) {
    if (!this.holidays)
      return false;

    let index = date.indexOf('-');
    if (index == -1)
      return false;
    let year = date.substring(0, index);
    let md = date.substring(index + 1);

    if (this.holidays.fixed_holidays_years && year >= this.holidays.fixed_holidays_years[0] &&
        (!this.holidays.fixed_holidays_years[1] || year <=this.holidays.fixed_holidays_years[1]) &&
        this.inDateList_(md, this.holidays.fixed_holidays)) {
      return true;
    }
    if (this.inDateList_(date, this.holidays.holidays || []))
      return true;

    let day = new Date(date).getUTCDay();
    if (day != 0 && day != 6)
      return false;
    if (this.inDateList_(date, this.holidays.workdays || {}))
      return false;
    return true;
  }

  inDateList_(date, list) {
    for (let dateOrRange of list) {
      if (typeof dateOrRange == 'string') {
        if (date == dateOrRange)
          return true;
      } else {
        if (date >= dateOrRange[0] && (!dateOrRange[1] || date <= dateOrRange[1]))
          return true;
      }
    }
    return false;
  }
}


const COLOR = [0x5f, 0x8c, 0xb5];
const COLOR_GREY = [160, 160, 160];
const PALETTE = [
  [230, 25, 75],
  [60, 180, 75],
  [255, 225, 25],
  [0, 130, 200],
  [245, 130, 48],
  [145, 30, 180],
  [70, 240, 240],
  [240, 50, 230],
  [210, 245, 60],
  [250, 190, 190],
  [0, 128, 128],
  [170, 110, 40],
  [128, 0, 0],
  [170, 255, 195],
  [128, 128, 0],
  [0, 0, 128],
];
const NBSP = '\u00a0';
const DEFAULT_DATE_RANGE = 30;
const DATE_HOLIDAY_CLASS = 'date_holiday';
let lineDataManager = new LineDataManager();
let settings = new Settings('buses');
let holidayParser = null;
let extraManifestLoading = false;
let essentialSettings = {};
let currentStartDate;
let currentEndDate;
let progressText = '';
let activeLines = [];

function positionPopup(element, baseX, baseY, marginX, marginY, addScrollOffset) {
  if (!marginX) {
    marginX = 0;
  }
  if (!marginY && marginY !== 0) {
    marginY = marginX;
  }

  let width = element.offsetWidth || element.clientWidth;
  let height = element.offsetHeight || element.clientHeight;
  let x = Math.min(baseX, window.innerWidth && width ? window.innerWidth - width - marginX : baseX);
  let y = Math.min(baseY, window.innerHeight && height ? window.innerHeight - height - marginY : baseY);
  if (addScrollOffset) {
    x += document.body.scrollLeft + document.documentElement.scrollLeft;
    y += document.body.scrollTop + document.documentElement.scrollTop;
  }

  element.style.left = x.toString() + 'px';
  element.style.top =  y.toString() + 'px';
}

function loadBusUpdates() {
  let updates_div = document.getElementById('updates');
  if (updates_div.children.length > 0)
    return Promise.resolve();
  return fetch('newbuses.csv').then(r => r.text()).then(csv => {
    let updates = csv.split(/\r\n|\r|\n/).filter(line => !line.match(/^\s*$/)).map(line => {
      let values = line.split(',');
      return {update_time: values[0], line: values[1], licenseId: values[2]};
    }).reverse();
    updates.splice(20);
    replaceChildren(updates_div, createElement('table', [
      createElement('thead', createElement('tr', ['时间', '线路', '自编号', '车牌号'].map(x => createElement('th', x)))),
      createElement('tbody', 
        updates.map(item => {
          let lineName = convertLineName(item.line, lineDataManager.manifest);
          let match = lineName.match(/（|\(/);
          if (match) {
            lineName = [
              createElement('span', lineName.substring(0, match.index)),
              createElement('span', lineName.substring(match.index), {className: 'a_small_note'}),
            ];
          }
          // TODO: Consolidate line name collapsing code with those for |lineChooser|.
          let hrefLineName = ([].find.call(document.getElementById('lineChooser').querySelectorAll('option'),
              option => option.value.split('+').includes(item.line)) || {}).value ||
              lineDataManager.getLineFullName(item.line);
          return createElement('tr', [
            createElement('td', item.update_time.substring(5)), 
            createElement('td', createElement('a', lineName, {href: '#' + hrefLineName})),
            createElement('td', (lineDataManager.queryCurrentBus(item.line, item.licenseId) || {}).busId || ''),
            createElement('td', item.licenseId),
          ]);
        })
      ),
    ]));
  });
}

function isBusIdContinuous(a, b) {
  if (a.substr(0, 2) != b.substr(0, 2))
    return false;
  var ia = parseInt(a.substr(2));
  var ib = parseInt(b.substr(2));
  if (ia == ib + 1 || ib == ia + 1)
    return true;
  else if (a.substr(0, 2) == '5-' &&
      ((ia % 10 == 3 && ia + 2 == ib) || 
       (ib % 10 == 3 && ib + 2 == ia)))
    return true;
  return false;
}

function convertLineName(line, options) {
  if (options.line_name_map && options.line_name_map[line])
    return convertLineName(options.line_name_map[line], options);
  let match = /^([^0-9]*)([0-9]+)([^0-9_]*)(.*)$/.exec(line);
  if (match) {
    if (match[1] && options.line_name_prefix_map && options.line_name_prefix_map[match[1]]) {
      let prefix = options.line_name_prefix_map[match[1]];
      if (typeof prefix == 'string') {
        match[1] = prefix;
      } else {
        match[1] = prefix[0];
        match[2] += prefix[1];
      }
    }
    if (match[3] && options.line_name_suffix_map && options.line_name_suffix_map[match[3]]) {
      match[3] = '（' + options.line_name_suffix_map[match[3]] + '）';
    }

    return match[1] + match[2] + match[3] + match[4];
  }
  return line;
}

function updateLineChooser(lines) {
  let lineChooser = document.getElementById('lineChooser');
  let oldValue = lineChooser.value;
  lines = lines.map(group => Object.assign({}, group, {options: group.lines.map(line => createElement('option', line.displayName, {value: line.id || line.idlist.join('+')}))}));
  let defaultGroupOptions = lines.filter(group => !group.id).flatMap(group => group.options);
  let nonDefaultGroups = lines.filter(group => group.id);
  replaceChildren(lineChooser, [
    ...defaultGroupOptions,
    ...nonDefaultGroups.map(group => createElement('optgroup', group.options, {label: group.displayName}))
  ]);
  if (oldValue)
    lineChooser.value = oldValue;
}

function createTableHeader(allBuses, hasBusId) {
  if (hasBusId !== false)
    hasBusId = true;
  let allBusesTh = [];
  if (hasBusId) {
    allBusesTh = allBuses.map(current => createElement('th', current.busId));

    // Label continous busIds in color.
    let i = 0;
    let inRange = false;
    let elementClass = '';
    for (let odd = false; i < allBuses.length; ++i) {
      elementClass = odd ? 'busid_odd_range_element' : 'busid_even_range_element';
      if (i > 0 && isBusIdContinuous(allBuses[i - 1].busId, allBuses[i].busId)) {
        if (inRange) { // The same range continues.
          allBusesTh[i - 1].className = elementClass;
        } else { // A new range begins.
          allBusesTh[i - 1].className = 'busid_range_begin ' + elementClass;
          inRange = true;
        }
      } else {
        if (inRange) { // The previous td is the end of the range.
          inRange = false;
          allBusesTh[i - 1].className = 'busid_range_end ' + elementClass;
          odd = !odd;
        }
      }
    }
    if (inRange) { // Mark the end of the last range.
      allBusesTh[i - 1].className = 'busid_range_end ' + elementClass;
    }
  }

  return createElement('thead', [
    ...(hasBusId ? [createElement('tr', [
      createElement('th', '自编号'),
      ...allBusesTh,
    ])] : []),
    createElement('tr', ['车牌号'].concat(allBuses.map(bus => bus.licenseId)).map(item => createElement('th', item))),
  ]);
}

function convertBusQuery(queryInput) {
  const rangeSeparatorRegExStr = '(?:~|～)';
  const busIdRegExStr = '([0-9])(?:0|-)([0-9]{4})';
  const licenseIdRegExStr = '(?:苏\\s*E[^0-9A-Z]{0,4})?([0-9A-Z]{5}|[0-9]{5}(?:D|F))';
  const busIdRegEx = new RegExp('^' + busIdRegExStr + '$');
  const busIdRangeRegEx = new RegExp('^' + busIdRegExStr + rangeSeparatorRegExStr + busIdRegExStr + '$');
  const licenseIdRegEx = new RegExp('^' + licenseIdRegExStr + '$', 'i');
  const licenseIdRangeRegEx = new RegExp('^' + licenseIdRegExStr + rangeSeparatorRegExStr + licenseIdRegExStr + '$', 'i');
  const prefixRegEx = /^([^~～*?#]+)(?:\*|\?|#){1,3}$/;

  let query = {busId: [], licenseId: []};
  let conditions = queryInput.split(/,|;|，|；|、|\s+/);
  conditions.forEach(condition => {
    let match = null;
    if (match = busIdRangeRegEx.exec(condition))
        query.busId.push({start: match[1] + '-' + match[2], end: match[3] + '-' + match[4]});
    else if (match = licenseIdRangeRegEx.exec(condition))
        query.licenseId.push({start: match[1].toUpperCase(), end: match[2].toUpperCase()});
    else if (match = prefixRegEx.exec(condition)) {
      if (match[1].includes('-'))
        query.busId.push({prefix: match[1]});
      else
        query.licenseId.push({prefix: match[1].toUpperCase()});
    } else if (match = busIdRegEx.exec(condition))
      query.busId.push(match[1] + '-' + match[2]);
    else if (match = licenseIdRegEx.exec(condition))
      query.licenseId.push(match[1].toUpperCase());
    else if (condition[0] == '*')
      query.licenseId.push({suffix: condition.substr(1)});
    // TODO: Is error handling necessary?
  });

  return query;
}

function findBusByQuery(query) {
  let busCountContainer = document.getElementById('bus_count_container');
  let busCount = document.getElementById('bus_count');
  let result = lineDataManager.queryBuses(convertBusQuery(query), currentStartDate, currentEndDate, true);
  fillSelect(document.getElementById('resultList'), result.lines);
  if (result.lines.length > 0) {
    busCount.innerText = result.buses.length;
    busCountContainer.style.display = '';
  } else {
    busCountContainer.style.display = 'none';
  }
}

function showLinesNew(lineOrLines, lineData, showLineNames) {
  if (typeof lineOrLines == 'string')
    lineOrLines = [lineOrLines];

  if (lineOrLines.length > PALETTE.length && !showLineNames) {
    replaceChildren('content', '您选择的线路太多了！');
    return;
  }
  if (!lineData && !lineDataManager.containsLines(lineOrLines)) {
    replaceChildren('content', '某些线路不存在！');
    return;
  }

  removeChildren('legend');
  if (lineOrLines.length > 1) {
    appendChildren('legend', lineOrLines.map((line, index) => createElement('span', [
      createElement('span', null, {style: {
        backgroundColor: 'rgb(' + PALETTE[index % PALETTE.length].join(',') + ')',
        height: '1em',
        width: '2em',
        display: 'inline-block',
        marginLeft: '3em',
      }}),
      ' ' + lineDataManager.getLineDisplayName(line),
    ])));
  }

  let data = lineData || lineDataManager.queryLines(lineOrLines, currentStartDate, currentEndDate);

  replaceChildren('content', createElement('table', [
    createTableHeader(data.buses, lineDataManager.hasBusId(lineOrLines)),
    createElement('tbody', data.details.map(day => createElement('tr', [
      createElement('th', day[0], {className: 'date' +
          (essentialSettings.annotateHolidays && holidayParser && holidayParser.isHoliday(day[0]) ? ' ' + DATE_HOLIDAY_CLASS : '')}),
      ...data.buses.map((bus, busIndex) => {
        let activeCount = day[1][busIndex].filter(weight => weight > 0).length;
        if (activeCount == 0) {
          return createElement('td', showLineNames ? [
            createElement('span', NBSP, {
              className: 'line_view_bus_item',
              style: {
                width: '100%',
                backgroundColor: 'rgb(' + COLOR_GREY.join(',') + ')',
              }
            })
          ] : null);
        }

        let td = createElement('td');
        let first = true;
        day[1][busIndex].forEach((weight, lineIndex) => {
          if (weight > 0) {
            let text = lineOrLines[lineIndex];
            if (first) {
              first = false;
            } else {
              text = '/' + text;
            }
            td.appendChild(createElement('span', showLineNames ? text : NBSP, {
              className: 'line_view_bus_item',
              style: Object.assign({
                width: 100 / activeCount + '%',
                backgroundColor: showLineNames ? 'rgb(' + COLOR_GREY.map(value => parseInt((255 - value) * weight + value)).join(',') + ')' :
                    'rgb(' + (lineOrLines.length == 1 ? COLOR : PALETTE[lineIndex]).map(value =>
                        parseInt((255 - value) * (1 - weight) + value)).join(',') + ')'
              }, showLineNames ? {
                color: 'rgb(' + (PALETTE[lineIndex % PALETTE.length]),
                fontWeight: 'bold',
              } : null),
              'data-line': lineOrLines[lineIndex],
            }));
          }
        });
        return td;
      })
    ]))),
  ]));

  if (essentialSettings.annotateHolidays && !holidayParser && !extraManifestLoading) {
    extraManifestLoading = true;
    lineDataManager.manifestLoader.loadExtra().then(manifest => {
      holidayParser = new HolidayParser(manifest);
      for (let th of document.querySelectorAll('#content th.date')) {
        if (!th.className.split(' ').includes(DATE_HOLIDAY_CLASS) && holidayParser.isHoliday(th.innerText || th.textContent))
          th.className += ' ' + DATE_HOLIDAY_CLASS;
      }
    });
  }
}

function onChooseLine() {
  let newLines = this.value.split('+');
  let needUpdate = false;
  if (document.getElementById('compare').checked) {
    newLines.forEach(line => !activeLines.includes(line) && (activeLines.push(line), needUpdate = true));
  } else {
    activeLines = newLines;
    needUpdate = true;
  }
  if (needUpdate) {
    showLinesNew(activeLines);
    history.pushState(activeLines.length == 1 ? activeLines[0] : activeLines, '', '#' + activeLines.join('+'));
  }
}

function parseUrlHash() {
  if (location.hash.replace('#', '')) {
    var hashValue = location.hash.replace('#', '');
    activeLines = hashValue.split('+');
    lineChooser.value = hashValue;
    if (lineDataManager && currentStartDate)
      showLinesNew(activeLines);
    return true;
  }
}

function onModifyDate() {
  if (!lineDataManager)
    return;
  let startDate = document.getElementById('startDate');
  let endDate = document.getElementById('endDate');

  if (lineDataManager.earliestDate && startDate.value < lineDataManager.earliestDate)
    startDate.value = lineDataManager.earliestDate;
  if (endDate.value > lineDataManager.latestDate)
    endDate.value = lineDataManager.latestDate;
  if ( currentStartDate != startDate.value || currentEndDate != endDate.value) {
    currentStartDate = startDate.value;
    currentEndDate = endDate.value;
    if (lineDataManager.isDataLoaded(currentStartDate, currentEndDate)) {
      showLinesNew(activeLines);
    } else {
      let progress = document.getElementById('progress');
      document.getElementById('progressbar').style.width = 0;
      document.getElementById('progress_text').innerText = progressText;
      progress.style.display = '';
      lineDataManager.load(currentStartDate, currentEndDate).then(_ => {
        progress.style.display = 'none';
        updateLineChooser(lineDataManager.getLines());
        showLinesNew(activeLines);
        if (lineDataManager.earliestDate && startDate.value < lineDataManager.earliestDate)
          startDate.value = lineDataManager.earliestDate;
      });
    }
  } else {
    startDate.value = currentStartDate;
    endDate.value = currentEndDate;
  }
}

function navigateLine(increment, repeat) {
  let lineChooser = document.getElementById('lineChooser');
  let newIndex = Math.max(0, lineChooser.selectedIndex + increment);
  let lineCount = lineDataManager.getLineCount();
  if (lineCount > 0 && newIndex > lineCount - 1)
    newIndex = lineCount - 1;
  lineChooser.selectedIndex = newIndex;
  if (!repeat)
    onChooseLine.call(lineChooser);
}

function init() {
  let lineDataPromise = initLineData();
  let settingsPromise = settings.initPromise.then(_ => {
    return settings.get({
      'enabledGroups': [],
      'annotateHolidays': true,
    }).then(items => essentialSettings = items);
  }).catch(_ => {});

  initEvents();

  Promise.all([lineDataPromise, settingsPromise]).then(_ => {
    initEvents2();
    if (essentialSettings.enabledGroups && essentialSettings.enabledGroups.length)
      lineDataManager.enabledGroups = essentialSettings.enabledGroups;
    lineDataManager.load(currentStartDate, currentEndDate).then(_ => {
      document.getElementById('progress').style.display = 'none';
      updateLineChooser(lineDataManager.getLines());
      if (!parseUrlHash()) {
        // TODO: Use LineDataManager to get 'the first line'.
        activeLines = [lineChooser.querySelector('option').value];
        showLinesNew(activeLines);
      }
    });
  });
}

function initLineData() {
  let lineChooser = document.getElementById('lineChooser');
  let offline_prompt = document.getElementById('offline_prompt')
  return lineDataManager.initAsync().then(_ => {
    if (lineDataManager.offline) {
      offline_prompt.style.display = '';
    }
    document.getElementById('last_update_container').style.display = '';
    replaceChildren('last_update_time', lineDataManager.getLastUpdateTime());

    currentEndDate = lineDataManager.latestDate;
    let date = new Date(currentEndDate);
    date.setDate(date.getDate() - DEFAULT_DATE_RANGE + 1);
    currentStartDate = date.toISOString().substring(0, 10);
    document.getElementById('startDate').value = currentStartDate;
    document.getElementById('endDate').value = currentEndDate;

    progressText = document.getElementById('progress_text').innerText;

    lineDataManager.onUpdateProgress = function(items, progressedItem) {
      let progressbar = document.getElementById('progressbar');
      let sizeHintItems = items.filter(item => item.sizeHint);
      let sizeHintTotal = sizeHintItems.reduce((result, item) => result += item.sizeHint, 0);
      let progressValue1 = sizeHintItems.reduce((result, item) => {
        let weight = item.sizeHint / sizeHintTotal;
        if (item.loaded) {
          result += weight;
        } else if (item.lengthLoaded && item.lengthTotal) {
          if (item.lengthAccurate) {
            result += weight * item.lengthLoaded / item.lengthTotal;
          } else {
            result += weight * Math.min(item.lengthLoaded, item.lengthTotal * 0.95) / item.lengthTotal;
          }
        }
        return result;
      }, 0);
      let knownLengthItems = items.filter(item => item.lengthAccurate && !item.sizeHint);
      let knownLengthTotal = knownLengthItems.reduce((result, item) => result + item.lengthTotal, 0);
      let progressValue2 = knownLengthItems.reduce((result, item) => {
        let weight = item.lengthTotal / knownLengthTotal;
        if (item.loaded) {
          result += weight;
        } else if (item.lengthLoaded) {
          result += weight * item.lengthLoaded / item.lengthTotal;
        }
        return result;
      }, 0);
      let progressValue = 100 * (progressValue1 * sizeHintItems.length / items.length +
          progressValue2 * knownLengthItems.length / items.length);
      progressbar.style.width = progressValue + '%';
      document.getElementById('progress_text').innerText = progressText + Math.round(progressValue) + '%';
    }
  }).catch(_ => {
    replaceChildren(offline_prompt, '数据加载失败，请检查您的网络状态。');
    offline_prompt.style.display = '';
    return Promise.reject();
  });
}

function initEvents() {
  let lineChooser = document.getElementById('lineChooser');
  lineChooser.addEventListener('change', onChooseLine);
  document.getElementById('resultList').addEventListener('change', onChooseLine);
  window.addEventListener('popstate', function(e) {
    if (e.state instanceof Array) {
      activeLines = e.state;
      showLinesNew(activeLines);
    } else if(e.state) {
      activeLines = [e.state];
      showLinesNew(e.state);
    } else {
      parseUrlHash();
    }
  });
  document.getElementById('bus_query').addEventListener('input', function() {
    if (!lineDataManager || !currentStartDate)
      return;
    findBusByQuery(this.value);
  });
  document.getElementById('findDetails').addEventListener('click', function() {
    if (!lineDataManager || !currentStartDate)
      return;
    let result = lineDataManager.queryBuses(Object.assign({lines: [].map.call(document.getElementById('resultList').children, option => option.value)},
        convertBusQuery(document.getElementById('bus_query').value)), currentStartDate, currentEndDate, true);
    showLinesNew(result.lines, result, true);
  });

  function updateCellDetails(element, x, y) {
    var div = document.getElementById('cellDetails');
    if (div.style.display == 'none')
      return;

    var lineContainer = document.getElementById('cellLineContainer');
    var td = element;
    if (td.tagName.toLowerCase() == 'span') {
      td = td.parentElement;
      lineContainer.style.display = '';
      document.getElementById('cellLine').innerText = element.getAttribute('data-line');
    } else {
      lineContainer.style.display = 'none';
    }
    document.getElementById('cellDate').innerText = td.parentElement.children[0].innerText;
    var thead = document.getElementById('content').querySelector('table thead');
    document.getElementById('cellBusId').innerText = thead.children[0].children[td.cellIndex].innerText;
    document.getElementById('cellLicenseId').innerText = thead.children[1].children[td.cellIndex].innerText;
    positionPopup(div, x + 8, y + 8, 30, 30, true);
  }

  function toggleCellDetails() {
    var div = document.getElementById('cellDetails');
    div.style.display =
        (div.style.display == 'none' && !document.getElementById('disableInfotip').checked) ?
        '' : 'none';
  }

  document.getElementById('content').addEventListener('click', function(e) {
    var tagName = e.target ? e.target.tagName.toLowerCase() : '';
    if (tagName == 'span' || tagName == 'td') {
      toggleCellDetails();
      updateCellDetails(e.target, e.clientX, e.clientY);
    }
  });
  var touchStarted = false;
  var timer = null;
  document.getElementById('content').addEventListener('touchstart', function(e) {
    var tagName = e.target ? e.target.tagName.toLowerCase() : '';
    if ((tagName == 'span' || tagName == 'td') && e.touches.length == 1) {
      if (!touchStarted) {
        touchStarted = true;
        timer = window.setTimeout(function() {
          if (touchStarted) {
            toggleCellDetails();
            updateCellDetails(e.target, e.touches[0].clientX, e.touches[0].clientY);
            touchStarted = false;
            timer = null;
          }
        }, 1500);
      }
    }
  });
  document.getElementById('content').addEventListener('touchmove', function() {
    if (touchStarted) {
      touchStarted = false;
      window.clearTimeout(timer);
      timer = null;
    }
  });
  document.getElementById('content').addEventListener('touchend', function(e) {
    var tagName = e.target ? e.target.tagName.toLowerCase() : '';
    if (tagName == 'span' || tagName == 'td' && e.touches.length == 1 && touchStarted) {
      e.preventDefault();
      updateCellDetails(e.target, e.touches[0].clientX, e.touches[0].clientY);
      touchStarted = false;
      window.clearTimeout(timer);
      timer = null;
    }
  });
  document.getElementById('content').addEventListener('mouseover', function(e) {
    var tagName = e.target ? e.target.tagName.toLowerCase() : '';
    if (tagName == 'span' || tagName == 'td') {
      updateCellDetails(e.target, e.clientX, e.clientY);
    }
  });

  document.getElementById('last_update_time').addEventListener('click', function() {
    loadBusUpdates().then(_ => {
      let updates_div = document.getElementById('updates');
      let last_update_container = document.getElementById('last_update_container');
      if (updates_div.style.display == 'none') {
        updates_div.style.display = '';
        positionPopup(updates_div, last_update_container.offsetLeft, last_update_container.offsetTop + last_update_container.offsetHeight + 8, 30);
      } else {
        updates_div.style.display = 'none';
      }
    });
  });

  let keyRepeatPending = false;
  document.addEventListener('keydown', function(e) {
    if (!e.altKey && !e.ctrlKey && !e.shiftKey && !e.metaKey)
      return;
    if ((e.key == 'ArrowUp' || e.keyCode == 38) && lineChooser.selectedIndex > 0) {
      navigateLine(-1, e.repeat);
      keyRepeatPending = e.repeat;
      e.preventDefault();
    } else if ((e.key == 'ArrowDown' || e.keyCode == 40)) {
      navigateLine(+1, e.repeat);
      keyRepeatPending = e.repeat;
      e.preventDefault();
    }
  });
  document.addEventListener('keyup', function(e) {
    if (keyRepeatPending) {
      keyRepeatPending = false;
      navigateLine(0, false);
    }
  });

}

function initEvents2() {
  document.getElementById('startDate').addEventListener('change', onModifyDate);
  document.getElementById('endDate').addEventListener('change', onModifyDate);

  let disableInfotip = document.getElementById('disableInfotip');
  disableInfotip.addEventListener('change', () => {
    settings.set({disableInfotip: disableInfotip.checked});
  });
  return settings.get({disableInfotip: false}).then(items => {
    disableInfotip.checked = !!items.disableInfotip;
  });
}

(function() {
  let initialized = false;
  function initOnce() {
    if (!initialized) {
      init();
      initialized = true;
    }
  }
  document.onload = initOnce;
  document.onreadystatechange = function() {
    if (document.readyState == 'complete')
      initOnce();
  };
  document.addEventListener('DOMContentLoaded', initOnce);
})();

if ('serviceWorker' in navigator) {
  navigator.serviceWorker.register(location.href.substring(0, location.href.lastIndexOf('/')) + '/service_worker.js');
}
