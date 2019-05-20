function wrapIDBRequest(request, extraHandlers) {
  return new Promise((resolve, reject) => {
    request.onsuccess = _ => resolve(request.result);
    request.onerror = reject;
    if (extraHandlers)
      for (const [eventName, handler] of Object.entries(extraHandlers)) {
        request.addEventListener(eventName, handler);
      }
  });
}

class Settings {
  constructor(component, backend) {
    this.component_ = component;
    if (window.indexedDB && window.IDBKeyRange && window.IDBKeyRange.lowerBound(0).includes && backend != 'localStorage') {
      this.initPromise = wrapIDBRequest(indexedDB.open(Settings.DB_NAME, 2), {
        'upgradeneeded': e => {
          this.db_ = e.target.result;
          if (e.oldVersion < 1) {
            this.db_.createObjectStore(Settings.OBJECT_STORE_NAME, {keyPath: ['component', 'key']});
          }

          if (e.oldVersion < 2) {
            e.target.transaction.objectStore(Settings.OBJECT_STORE_NAME).createIndex('component', 'component', {unique: false});
          }
        }
      }).then(db => (this.db_ = db, 'indexedDB'));
    } else if (window.localStorage) {
      this.initPromise = Promise.resolve('localStorage');
    } else {
      this.initPromise = Promise.reject('No storage APIs are supported by this browser.');
    }
  }

  get(key, defaultValue) {
    let keys = [];
    let result = {};
    let singleKey = false;
    if (typeof key == 'string' || typeof key == 'number' || typeof key == 'boolean') {
      // TODO: Do we need to distinguish between string and non-string keys?
      keys = [key.toString()];
      singleKey = true;
    } else if (typeof key == 'object' && key instanceof Array) {
      keys = key;
    } else if (typeof key == 'object') {
      keys = Object.keys(key);
      result = key;
    } else if (key != undefined) {
      return Promise.reject('Invalid argument.');
    }

    if (this.db_) {
      let objectStore = this.db_.transaction(Settings.OBJECT_STORE_NAME).objectStore(Settings.OBJECT_STORE_NAME);

      if (keys.length == 0) {
        return new Promise((resolve, reject) => {
          let cursor = objectStore.index('component').openCursor(this.component_);
          cursor.onsuccess = e => {
            let cursor = e.target.result;
            if (cursor) {
              result[cursor.value.key] = cursor.value.value;
              cursor.continue();
            } else {
              resolve(result);
            }
          };
          cursor.onerror = reject;
        });
      }

      return Promise.all(keys.map(key => wrapIDBRequest(objectStore.get([this.component_, key])))).then(values => {
        for (let i = 0; i < keys.length; ++i) {
          if (values[i] === undefined && defaultValue && defaultValue[keys[i]]) {
            result[keys[i]] = defaultValue[keys[i]];
          } else if (values[i] != undefined) {
            result[keys[i]] = values[i].value;
          }
        }
        if (singleKey)
          return result[key];
        else
          return result;
      });
    } else if (window.localStorage) {
      let prefix = this.getLocalStorageKeyPrefix_();
      if (keys.length == 0) {
        for (let i = 0; i < localStorage.length; ++i) {
          let key = localStorage.key(i);
          if (key.substr(0, prefix.length) == prefix)
            keys.push(key.substr(prefix.length));
        }
      }

      keys.forEach(key => {
        let value = localStorage.getItem(prefix + key);
        if (value === null && defaultValue && defaultValue[key]) {
          result[key] = defaultValue[key];
        } else if (value !== null) {
          result[key] = this.deserializeValue_(value);
        }
      });
      if (singleKey)
        return Promise.resolve(result[key]);
      else
        return Promise.resolve(result);
    }
  }

  set(key, value) {
    let updates = {};
    if (typeof key == 'string' || typeof key == 'number' || typeof key == 'boolean') {
      // TODO: Do we need to distinguish between string and non-string keys?
      updates[key.toString()] = value;
    } else if (typeof key == 'object' && key instanceof Array) {
      if (!value || key.length != value.length)
        return Promise.reject('Invalid argument. If |key| is an Array, |value| must be an Array with the same length.');
      for (let i = 0; i < key.length; ++i)
        updates[key[i]] = value[i];
    } else if (key && typeof key == 'object') {
      updates = key;
    } else {
      return Promise.reject('Invalid argument.');
    }

    if (this.db_) {
      let transaction = this.db_.transaction(Settings.OBJECT_STORE_NAME, 'readwrite');
      return Promise.all(Object.keys(updates).map(key => wrapIDBRequest(
          transaction.objectStore(Settings.OBJECT_STORE_NAME).
          put({component: this.component_, key: key, value: updates[key]}))));
    } else if (window.localStorage) {
      for (const [key, value] of Object.entries(updates)) {
        localStorage.setItem(this.getLocalStorageKeyPrefix_() + key, this.serializeValue_(value));
      }
      return Promise.resolve();
    }
  }

  remove(key) {
    let keys = [];
    if (typeof key == 'string' || typeof key == 'number' || typeof key == 'boolean') {
      // TODO: Do we need to distinguish between string and non-string keys?
      keys = [key.toString()];
    } else if (typeof key == 'object' && key instanceof Array) {
      keys = key;
    } else {
      return Promise.reject('Invalid argument.');
    }

    if (this.db_) {
      if (keys.length == 0)
        return Promise.resolve();
      let transaction = this.db_.transaction(Settings.OBJECT_STORE_NAME, 'readwrite');
      let removedKeys = [];
      return Promise.all(keys.map(key => wrapIDBRequest(
          transaction.objectStore(Settings.OBJECT_STORE_NAME).
          delete([this.component_, key])).then(_ => removedKeys.push(key)))).then(_ => removedKeys);
    } else if (window.localStorage) {
      keys.forEach(key => localStorage.removeItem(key));
      return Promise.resolve();
    }
  }

  getLocalStorageKeyPrefix_() {
    return Settings.LOCAL_STORAGE_PREFIX + this.component_ + '.';
  }

  // TODO: Implement better serialization.
  serializeValue_(value) {
    return JSON.stringify(value);
  }
  deserializeValue_(string) {
    return JSON.parse(string);
  }
}

Settings.DB_NAME = '_settings';
Settings.OBJECT_STORE_NAME = '_settings';
Settings.LOCAL_STORAGE_PREFIX = '_settings.';
