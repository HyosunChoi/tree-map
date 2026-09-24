import { supabase, ensureSession } from './supabaseClient.js'

const STORAGE_KEY = 'tree-map:records'
const MIGRATION_FLAG_KEY = 'tree-map:migrated'
const PHOTO_BUCKET = 'tree-photos'

let lastOwnerId = null

// ---- localStorage cache: read/write are the only two functions touching the key directly ----

function readCache() {
  try {
    const raw = localStorage.getItem(STORAGE_KEY)
    if (!raw) return []
    const parsed = JSON.parse(raw)
    return Array.isArray(parsed) ? parsed : []
  } catch {
    return []
  }
}

function writeCache(records) {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(records))
  } catch {
    // storage full/unavailable (e.g. private browsing) — cache is best-effort only
  }
}

function sortByObservedAtDesc(records) {
  return [...records].sort((a, b) => b.createdAt.localeCompare(a.createdAt))
}

// ---- mapping between the app's record shape and the `trees` table row shape ----

function rowToRecord(row) {
  return {
    id: row.id,
    ownerId: row.owner_id,
    species: row.species,
    memo: row.notes ?? '',
    lat: row.latitude,
    lng: row.longitude,
    accuracy: row.accuracy_m ?? null,
    photoUrl: row.photo_url ?? null,
    photoPath: row.photo_path ?? null,
    createdAt: row.observed_at,
  }
}

function recordToRow(record, ownerId) {
  return {
    id: record.id,
    owner_id: ownerId,
    species: record.species,
    notes: record.memo || null,
    latitude: record.lat,
    longitude: record.lng,
    accuracy_m: Number.isFinite(record.accuracy) ? record.accuracy : null,
    photo_url: record.photoUrl || null,
    photo_path: record.photoPath || null,
    observed_at: record.createdAt,
  }
}

// Uploads an already-resized photo blob and returns its public URL + storage path
// (the path is kept on the record so deleteRecord can clean the file up later).
async function uploadPhoto(blob, ownerId) {
  const path = `${ownerId}/${crypto.randomUUID()}.jpg`
  const { error } = await supabase.storage
    .from(PHOTO_BUCKET)
    .upload(path, blob, { contentType: 'image/jpeg', upsert: false })
  if (error) throw error

  const { data } = supabase.storage.from(PHOTO_BUCKET).getPublicUrl(path)
  return { url: data.publicUrl, path }
}

export function getCurrentOwnerId() {
  return lastOwnerId
}

// One-time upload of pre-Supabase local records, guarded by a flag so it never repeats
// and keyed by the records' own (already-UUID) ids so a retry can't duplicate rows.
async function migrateLocalRecords(ownerId) {
  if (localStorage.getItem(MIGRATION_FLAG_KEY) === 'true') return

  const localRecords = readCache().filter((record) => !record.ownerId || record.ownerId === ownerId)
  if (localRecords.length > 0) {
    const rows = localRecords.map((record) => recordToRow(record, ownerId))
    const { error } = await supabase.from('trees').upsert(rows, { onConflict: 'id' })
    if (error) throw error
  }

  localStorage.setItem(MIGRATION_FLAG_KEY, 'true')
}

// Loads trees for map/list rendering. Tries Supabase first (migrating any pre-existing
// local records on the way), and falls back to the last-known cache on any failure —
// offline, RLS/auth error, or Supabase not configured — so the app never breaks.
export async function getRecords() {
  if (!supabase) {
    return { records: sortByObservedAtDesc(readCache()), source: 'cache', ownerId: null }
  }

  try {
    const session = await ensureSession()
    const ownerId = session?.user?.id ?? null
    lastOwnerId = ownerId

    if (ownerId) {
      await migrateLocalRecords(ownerId)
    }

    const { data, error } = await supabase
      .from('trees')
      .select('*')
      .order('observed_at', { ascending: false })
    if (error) throw error

    const records = data.map(rowToRecord)
    writeCache(records)
    return { records, source: 'remote', ownerId }
  } catch (error) {
    return { records: sortByObservedAtDesc(readCache()), source: 'cache', ownerId: lastOwnerId, error }
  }
}

// `photo` is an already-resized JPEG Blob (see src/image.js) — this function only uploads it.
// Photos require Supabase (no local-only fallback: localStorage isn't a sane place for image
// blobs), so a photo picked while offline/unconfigured is silently dropped rather than blocking
// the rest of the save.
export async function addRecord({ species, memo, lat, lng, accuracy, photo }) {
  const record = {
    id: crypto.randomUUID(),
    species,
    memo,
    lat,
    lng,
    accuracy: Number.isFinite(accuracy) ? accuracy : null,
    photoUrl: null,
    photoPath: null,
    createdAt: new Date().toISOString(),
  }

  if (!supabase) {
    writeCache([...readCache(), record])
    return { record, source: 'cache' }
  }

  try {
    const session = await ensureSession()
    const ownerId = session?.user?.id
    if (!ownerId) throw new Error('No Supabase session available')

    record.ownerId = ownerId

    if (photo) {
      const { url, path } = await uploadPhoto(photo, ownerId)
      record.photoUrl = url
      record.photoPath = path
    }

    const { error } = await supabase.from('trees').insert(recordToRow(record, ownerId))
    if (error) throw error

    writeCache([...readCache(), record])
    return { record, source: 'remote' }
  } catch (error) {
    return { record: null, source: 'error', error }
  }
}

export async function deleteRecord(id) {
  if (!supabase) {
    writeCache(readCache().filter((record) => record.id !== id))
    return { success: true, source: 'cache' }
  }

  try {
    // .select() surfaces RLS-blocked deletes (0 rows) as a detectable no-op instead of a silent success.
    const { data, error } = await supabase.from('trees').delete().eq('id', id).select('id, photo_path')
    if (error) throw error
    if (!data || data.length === 0) {
      throw new Error('Delete was blocked (not the owner, or the record no longer exists)')
    }

    const photoPath = data[0]?.photo_path
    if (photoPath) {
      // Best-effort: an orphaned storage object is harmless clutter, not worth failing the delete over.
      supabase.storage.from(PHOTO_BUCKET).remove([photoPath]).catch(() => {})
    }

    writeCache(readCache().filter((record) => record.id !== id))
    return { success: true, source: 'remote' }
  } catch (error) {
    return { success: false, error }
  }
}
