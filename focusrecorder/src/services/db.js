/**
 * db.js — IndexedDB service for FocusRecorder
 * All recordings are stored in the "focusrecorder" database,
 * "recordings" object store, keyed by auto-incremented id.
 */

const DB_NAME = "focusrecorder";
const STORE   = "recordings";
const VERSION = 1;

function openDB() {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, VERSION);

    req.onupgradeneeded = (e) => {
      const db = e.target.result;
      if (!db.objectStoreNames.contains(STORE)) {
        db.createObjectStore(STORE, { keyPath: "id", autoIncrement: true });
      }
    };

    req.onsuccess = (e) => resolve(e.target.result);
    req.onerror   = (e) => reject(e.target.error);
  });
}

/** Save a recording blob and metadata. Returns the new record id. */
export async function saveRecording({ title, blob, duration, date, size, tag }) {
  const db    = await openDB();
  const store = db.transaction(STORE, "readwrite").objectStore(STORE);
  return new Promise((resolve, reject) => {
    const req = store.add({ title, blob, duration, date, size, tag });
    req.onsuccess = (e) => resolve(e.target.result);
    req.onerror   = (e) => reject(e.target.error);
  });
}

/** Fetch all recordings (newest first). */
export async function getAllRecordings() {
  const db    = await openDB();
  const store = db.transaction(STORE, "readonly").objectStore(STORE);
  return new Promise((resolve, reject) => {
    const req = store.getAll();
    req.onsuccess = (e) => resolve([...e.target.result].reverse());
    req.onerror   = (e) => reject(e.target.error);
  });
}

/** Delete a recording by id. */
export async function deleteRecording(id) {
  const db    = await openDB();
  const store = db.transaction(STORE, "readwrite").objectStore(STORE);
  return new Promise((resolve, reject) => {
    const req = store.delete(id);
    req.onsuccess = () => resolve();
    req.onerror   = (e) => reject(e.target.error);
  });
}

/**
 * Update fields on a recording (used for rename).
 * Reads the existing record, merges the changes, then writes it back
 * so the blob and all other fields are preserved.
 */
export async function updateRecording(id, changes) {
  const db    = await openDB();
  const tx    = db.transaction(STORE, "readwrite");
  const store = tx.objectStore(STORE);
  return new Promise((resolve, reject) => {
    const getReq = store.get(id);
    getReq.onsuccess = (e) => {
      const existing = e.target.result;
      if (!existing) { reject(new Error("Record not found")); return; }
      const putReq = store.put({ ...existing, ...changes, id });
      putReq.onsuccess = () => resolve();
      putReq.onerror   = (ev) => reject(ev.target.error);
    };
    getReq.onerror = (e) => reject(e.target.error);
  });
}
