const memoryStore = new Map();
const STORAGE_PREFIX = "lumexa:connector-storage:";

function scopedKey(key) {
  return `${STORAGE_PREFIX}${key}`;
}

function browserStorage() {
  try {
    return typeof window !== "undefined" ? window.localStorage : null;
  } catch {
    return null;
  }
}

async function getItem(key) {
  const storage = browserStorage();
  return storage ? storage.getItem(scopedKey(key)) : (memoryStore.get(key) ?? null);
}

async function setItem(key, value) {
  const storage = browserStorage();
  if (storage) storage.setItem(scopedKey(key), value);
  else memoryStore.set(key, value);
}

async function removeItem(key) {
  const storage = browserStorage();
  if (storage) storage.removeItem(scopedKey(key));
  else memoryStore.delete(key);
}

async function clear() {
  const storage = browserStorage();
  if (storage) {
    for (const key of Object.keys(storage)) {
      if (key.startsWith(STORAGE_PREFIX)) storage.removeItem(key);
    }
  } else memoryStore.clear();
}

async function getAllKeys() {
  const storage = browserStorage();
  return storage
    ? Object.keys(storage)
        .filter((key) => key.startsWith(STORAGE_PREFIX))
        .map((key) => key.slice(STORAGE_PREFIX.length))
    : [...memoryStore.keys()];
}

async function multiGet(keys) {
  return Promise.all(keys.map(async (key) => [key, await getItem(key)]));
}

async function multiSet(entries) {
  await Promise.all(entries.map(([key, value]) => setItem(key, value)));
}

async function multiRemove(keys) {
  await Promise.all(keys.map((key) => removeItem(key)));
}

const AsyncStorage = {
  getItem,
  setItem,
  removeItem,
  clear,
  getAllKeys,
  multiGet,
  multiSet,
  multiRemove
};

export { clear, getAllKeys, getItem, multiGet, multiRemove, multiSet, removeItem, setItem };
export default AsyncStorage;
