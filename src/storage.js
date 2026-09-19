const STORAGE_KEY = 'tree-map:records'

function readAll() {
  try {
    const raw = localStorage.getItem(STORAGE_KEY)
    if (!raw) return []
    const parsed = JSON.parse(raw)
    return Array.isArray(parsed) ? parsed : []
  } catch {
    return []
  }
}

function writeAll(records) {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(records))
}

export function getRecords() {
  return readAll().sort((a, b) => b.createdAt.localeCompare(a.createdAt))
}

export function addRecord({ species, memo, lat, lng }) {
  const record = {
    id: crypto.randomUUID(),
    species,
    memo,
    lat,
    lng,
    createdAt: new Date().toISOString(),
  }
  const records = readAll()
  records.push(record)
  writeAll(records)
  return record
}

export function deleteRecord(id) {
  const records = readAll().filter((r) => r.id !== id)
  writeAll(records)
}
