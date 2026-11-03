/* database.js – IndexedDB layer. Single source of truth for all records.
   Schema version = DB_VERSION. To add stores/indexes later, bump the version and
   add a step in onupgradeneeded (existing records are preserved). */
const DB = (() => {
  const DB_NAME = 'wti-logbook', DB_VERSION = 1;
  const STORES = ['customers', 'repairs', 'products', 'sales', 'payments', 'expenses', 'moves', 'audit', 'meta'];
  let db;

  const open = () => new Promise((res, rej) => {
    const r = indexedDB.open(DB_NAME, DB_VERSION);
    r.onupgradeneeded = e => {
      const d = e.target.result;
      STORES.forEach(s => { if (!d.objectStoreNames.contains(s)) d.createObjectStore(s, { keyPath: 'id' }); });
      // future migrations: if (e.oldVersion < 2) { ... }
    };
    r.onsuccess = () => { db = r.result; res(); };
    r.onerror = () => rej(r.error);
  });
  const req = r => new Promise((res, rej) => { r.onsuccess = () => res(r.result); r.onerror = () => rej(r.error); });
  const store = (s, m = 'readonly') => db.transaction(s, m).objectStore(s);

  const all = s => req(store(s).getAll());
  const put = (s, o) => req(store(s, 'readwrite').put(o));
  const uid = p => p + Date.now().toString(36) + Math.random().toString(36).slice(2, 7);

  // Sequential human-readable references (RJ-0001, C-0001 ...)
  async function next(name, prefix) {
    const st = store('meta', 'readwrite');
    const r = await req(st.get(name));
    const n = (r ? r.n : 0) + 1;
    await req(st.put({ id: name, n }));
    return prefix + String(n).padStart(4, '0');
  }

  async function dump() {
    const out = { app: 'wti-logbook', version: DB_VERSION, exported: new Date().toISOString() };
    for (const s of STORES) out[s] = await all(s);
    return out;
  }
  async function load(data) {
    if (data.app !== 'wti-logbook') throw new Error('This is not a Wealth Tech backup file.');
    for (const s of STORES) {
      await req(store(s, 'readwrite').clear());
      for (const o of data[s] || []) await put(s, o);
    }
  }
  return { open, all, put, uid, next, dump, load, STORES };
})();
