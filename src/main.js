import L from 'leaflet'
import 'leaflet/dist/leaflet.css'
import markerIcon2x from 'leaflet/dist/images/marker-icon-2x.png'
import markerIcon from 'leaflet/dist/images/marker-icon.png'
import markerShadow from 'leaflet/dist/images/marker-shadow.png'
import { Capacitor } from '@capacitor/core'
import { Geolocation } from '@capacitor/geolocation'
import './style.css'
import { getRecords, addRecord, deleteRecord } from './storage.js'
import { resizeImageFile } from './image.js'
import { identifySpecies } from './plantnet.js'

// Vite bundles Leaflet's default marker images under a hashed path;
// without this the default markers render as broken images.
L.Icon.Default.mergeOptions({
  iconRetinaUrl: markerIcon2x,
  iconUrl: markerIcon,
  shadowUrl: markerShadow,
})

const DEFAULT_CENTER = [37.5665, 126.978] // Seoul, used until a real fix is obtained
const DEFAULT_ZOOM = 15
const LOCATION_ZOOM = 17 // close enough to see nearby trees once a real fix arrives

const currentLocationIcon = L.divIcon({
  className: 'current-location-icon',
  html: '<span class="current-location-dot"></span>',
  iconSize: [18, 18],
  iconAnchor: [9, 9],
})

const state = {
  currentPosition: null,
  markers: new Map(),
  currentLocationMarker: null,
  accuracyCircle: null,
  records: [],
  ownerId: null,
  saving: false,
  photoPreviewUrl: null,
  resizedPhoto: null,
  processingPhoto: false,
}

const el = {
  locationValue: document.getElementById('location-value'),
  retryLocationBtn: document.getElementById('retry-location'),
  form: document.getElementById('tree-form'),
  species: document.getElementById('species'),
  memo: document.getElementById('memo'),
  photo: document.getElementById('photo'),
  photoPreview: document.getElementById('photo-preview'),
  photoPickBtn: document.getElementById('photo-pick-btn'),
  photoClearBtn: document.getElementById('photo-clear-btn'),
  speciesSuggestions: document.getElementById('species-suggestions'),
  saveBtn: document.getElementById('save-btn'),
  saveStatus: document.getElementById('save-status'),
  list: document.getElementById('tree-list'),
  recordCount: document.getElementById('record-count'),
  syncStatus: document.getElementById('sync-status'),
}

const map = L.map('map').setView(DEFAULT_CENTER, DEFAULT_ZOOM)

L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
  maxZoom: 19,
  attribution: '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors',
}).addTo(map)

// On-map "내 위치" control: a large touch target for re-centering on the current fix.
const LocateControl = L.Control.extend({
  options: { position: 'topright' },
  onAdd() {
    const container = L.DomUtil.create('div', 'locate-control')
    const button = L.DomUtil.create('button', 'locate-btn', container)
    button.type = 'button'
    button.setAttribute('aria-label', '내 위치로 이동')
    button.innerHTML = '◎'
    L.DomEvent.disableClickPropagation(container)
    L.DomEvent.on(button, 'click', (event) => {
      L.DomEvent.stop(event)
      requestLocation()
    })
    return container
  },
})

map.addControl(new LocateControl())

function formatCoord(value) {
  return value.toFixed(6)
}

function formatTimestamp(iso) {
  const date = new Date(iso)
  return date.toLocaleString('ko-KR', {
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
  })
}

function setLocationStatus(text, { failed = false } = {}) {
  el.locationValue.textContent = text
  el.retryLocationBtn.hidden = !failed
}

function setSaveStatus(text, { failed = false } = {}) {
  if (!text) {
    el.saveStatus.hidden = true
    el.saveStatus.textContent = ''
    el.saveStatus.classList.remove('status-error')
    return
  }
  el.saveStatus.hidden = false
  el.saveStatus.textContent = text
  el.saveStatus.classList.toggle('status-error', failed)
}

function updateSaveButtonState() {
  el.saveBtn.disabled = state.saving || state.processingPhoto || !state.currentPosition
}

function setPhotoPreview(file) {
  if (state.photoPreviewUrl) {
    URL.revokeObjectURL(state.photoPreviewUrl)
    state.photoPreviewUrl = null
  }

  if (!file) {
    el.photoPreview.src = ''
    el.photoPreview.hidden = true
    el.photoClearBtn.hidden = true
    return
  }

  state.photoPreviewUrl = URL.createObjectURL(file)
  el.photoPreview.src = state.photoPreviewUrl
  el.photoPreview.hidden = false
  el.photoClearBtn.hidden = false
}

// `statusText` shows a transient message (e.g. "추천 중…") in place of chips.
function renderSpeciesSuggestions(suggestions, statusText = '') {
  el.speciesSuggestions.innerHTML = ''

  if (statusText) {
    el.speciesSuggestions.hidden = false
    const status = document.createElement('p')
    status.className = 'species-suggestions-status'
    status.textContent = statusText
    el.speciesSuggestions.append(status)
    return
  }

  if (!suggestions || suggestions.length === 0) {
    el.speciesSuggestions.hidden = true
    return
  }

  el.speciesSuggestions.hidden = false
  for (const suggestion of suggestions) {
    const chip = document.createElement('button')
    chip.type = 'button'
    chip.className = 'species-chip'
    const scorePct = Number.isFinite(suggestion.score) ? ` ${Math.round(suggestion.score * 100)}%` : ''
    chip.textContent = `${suggestion.label}${scorePct}`
    chip.title = suggestion.scientificName || ''
    chip.addEventListener('click', () => {
      el.species.value = suggestion.label
      el.species.focus()
    })
    el.speciesSuggestions.append(chip)
  }
}

// Shared by the "사진 제거" button and a successful save — both need the file input,
// preview, resized-photo cache, and AI suggestions all back to their empty state together.
function resetPhotoState() {
  el.photo.value = ''
  setPhotoPreview(null)
  state.resizedPhoto = null
  state.processingPhoto = false
  renderSpeciesSuggestions([])
}

function clearPhotoInput() {
  resetPhotoState()
  updateSaveButtonState()
}

async function handlePhotoChange() {
  const file = el.photo.files[0] || null
  setPhotoPreview(file)
  state.resizedPhoto = null
  renderSpeciesSuggestions([])

  if (!file) {
    state.processingPhoto = false
    updateSaveButtonState()
    return
  }

  state.processingPhoto = true
  updateSaveButtonState()
  renderSpeciesSuggestions([], 'AI가 수종을 추천하는 중…')

  try {
    state.resizedPhoto = await resizeImageFile(file)
  } catch (error) {
    console.error('Failed to process photo', error)
    renderSpeciesSuggestions([])
    state.processingPhoto = false
    updateSaveButtonState()
    return
  }

  const { suggestions } = await identifySpecies(state.resizedPhoto)
  renderSpeciesSuggestions(suggestions)
  state.processingPhoto = false
  updateSaveButtonState()
}

function setSyncStatus(text) {
  if (!text) {
    el.syncStatus.hidden = true
    el.syncStatus.textContent = ''
    return
  }
  el.syncStatus.hidden = false
  el.syncStatus.textContent = text
}

function updateCurrentLocationMarker(lat, lng, accuracy) {
  const latlng = [lat, lng]

  if (!state.currentLocationMarker) {
    state.currentLocationMarker = L.marker(latlng, {
      icon: currentLocationIcon,
      zIndexOffset: 1000,
      interactive: false,
      keyboard: false,
    }).addTo(map)
  } else {
    state.currentLocationMarker.setLatLng(latlng)
  }

  if (!Number.isFinite(accuracy)) return

  if (!state.accuracyCircle) {
    state.accuracyCircle = L.circle(latlng, {
      radius: accuracy,
      color: '#4285f4',
      weight: 1,
      opacity: 0.3,
      fillColor: '#4285f4',
      fillOpacity: 0.08,
      interactive: false,
    }).addTo(map)
  } else {
    state.accuracyCircle.setLatLng(latlng)
    state.accuracyCircle.setRadius(accuracy)
  }
}

// Native builds (Capacitor/iOS/Android) go through the @capacitor/geolocation plugin, which
// drives the OS-level permission prompt; plain browser/Vercel deploys keep using the Web API.
// Both resolve to the same `{ coords: { latitude, longitude, accuracy } }` shape.
async function ensureNativeLocationPermission() {
  const status = await Geolocation.checkPermissions()
  if (status.location === 'granted' || status.coarseLocation === 'granted') return true

  const requested = await Geolocation.requestPermissions()
  return requested.location === 'granted' || requested.coarseLocation === 'granted'
}

async function getCurrentPositionCompat() {
  if (Capacitor.isNativePlatform()) {
    const granted = await ensureNativeLocationPermission()
    if (!granted) {
      const error = new Error('Location permission was denied')
      error.code = 1 // align with GeolocationPositionError.PERMISSION_DENIED below
      throw error
    }
    return Geolocation.getCurrentPosition({ enableHighAccuracy: true, timeout: 10000 })
  }

  if (!('geolocation' in navigator)) {
    const error = new Error('Geolocation is not supported')
    error.code = 'UNSUPPORTED'
    throw error
  }

  return new Promise((resolve, reject) => {
    navigator.geolocation.getCurrentPosition(resolve, reject, {
      enableHighAccuracy: true,
      timeout: 10000,
      maximumAge: 0,
    })
  })
}

async function requestLocation() {
  setLocationStatus('현재 위치 확인 중…')
  state.currentPosition = null
  updateSaveButtonState()

  try {
    const position = await getCurrentPositionCompat()
    const { latitude, longitude, accuracy } = position.coords
    state.currentPosition = { lat: latitude, lng: longitude, accuracy }
    updateCurrentLocationMarker(latitude, longitude, accuracy)
    map.setView([latitude, longitude], LOCATION_ZOOM)

    const accuracyText = Number.isFinite(accuracy) ? ` · 정확도 ±${Math.round(accuracy)}m` : ''
    setLocationStatus(`현재 위치 확인됨${accuracyText}`)
    updateSaveButtonState()
  } catch (error) {
    state.currentPosition = null
    updateSaveButtonState()

    if (error?.code === 'UNSUPPORTED') {
      setLocationStatus('이 브라우저는 위치 정보를 지원하지 않습니다.', { failed: true })
      return
    }

    let message = '현재 위치를 확인하지 못했습니다.'
    if (error?.code === 1 /* PERMISSION_DENIED */) {
      message = '위치 접근 권한이 거부되었습니다. 설정에서 위치 권한을 허용해주세요.'
    } else if (error?.code === 3 /* TIMEOUT */) {
      message = '위치 확인이 시간 초과되었습니다.'
    }
    setLocationStatus(message, { failed: true })
  }
}

function renderMarker(record) {
  const photoHtml = record.photoUrl
    ? `<img class="popup-photo" src="${escapeHtml(record.photoUrl)}" alt="" />`
    : ''
  const marker = L.marker([record.lat, record.lng]).addTo(map).bindPopup(
    `${photoHtml}<strong>${escapeHtml(record.species)}</strong><br>${escapeHtml(record.memo || '')}<br><small>${formatTimestamp(
      record.createdAt
    )}</small>`
  )
  state.markers.set(record.id, marker)
}

function removeMarker(id) {
  const marker = state.markers.get(id)
  if (marker) {
    map.removeLayer(marker)
    state.markers.delete(id)
  }
}

function escapeHtml(text) {
  const div = document.createElement('div')
  div.textContent = text
  return div.innerHTML
}

// A record with no ownerId predates Supabase (local-only) or Supabase isn't configured;
// treat those as the local user's own. Otherwise only the owning session may delete it.
function canDeleteRecord(record) {
  return !record.ownerId || (!!state.ownerId && record.ownerId === state.ownerId)
}

function renderList(records) {
  el.recordCount.textContent = records.length

  if (records.length === 0) {
    el.list.innerHTML = '<li class="empty-state">아직 기록된 나무가 없습니다</li>'
    return
  }

  el.list.innerHTML = ''
  for (const record of records) {
    const li = document.createElement('li')
    li.className = 'tree-item'
    li.dataset.id = record.id

    if (record.photoUrl) {
      const thumb = document.createElement('img')
      thumb.className = 'tree-item-photo'
      thumb.src = record.photoUrl
      thumb.alt = ''
      li.append(thumb)
    }

    const main = document.createElement('div')
    main.className = 'tree-item-main'

    const species = document.createElement('p')
    species.className = 'tree-item-species'
    species.textContent = record.species

    const memo = document.createElement('p')
    memo.className = 'tree-item-memo'
    memo.textContent = record.memo || ''

    const meta = document.createElement('p')
    meta.className = 'tree-item-meta'
    meta.textContent = `${formatTimestamp(record.createdAt)} · ${formatCoord(record.lat)}, ${formatCoord(
      record.lng
    )}`

    main.append(species, memo, meta)
    li.append(main)

    if (canDeleteRecord(record)) {
      const deleteBtn = document.createElement('button')
      deleteBtn.type = 'button'
      deleteBtn.className = 'tree-item-delete'
      deleteBtn.textContent = '삭제'
      deleteBtn.addEventListener('click', (event) => {
        event.stopPropagation()
        handleDelete(record.id)
      })
      li.append(deleteBtn)
    }

    li.addEventListener('click', () => {
      map.setView([record.lat, record.lng], DEFAULT_ZOOM)
      state.markers.get(record.id)?.openPopup()
    })

    el.list.appendChild(li)
  }
}

async function handleDelete(id) {
  const { success, error } = await deleteRecord(id)

  if (!success) {
    console.error('Failed to delete record', error)
    setSaveStatus('삭제하지 못했습니다. 네트워크 상태를 확인하고 다시 시도해주세요.', { failed: true })
    return
  }

  state.records = state.records.filter((record) => record.id !== id)
  removeMarker(id)
  renderList(state.records)
}

async function loadExistingRecords() {
  const { records, source, ownerId, error } = await getRecords()

  state.records = records
  state.ownerId = ownerId

  for (const record of records) {
    renderMarker(record)
  }
  renderList(state.records)

  if (source === 'cache' && error) {
    setSyncStatus('클라우드에 연결할 수 없어 마지막으로 저장된 기록을 표시 중입니다.')
  } else {
    setSyncStatus('')
  }
}

el.form.addEventListener('submit', async (event) => {
  event.preventDefault()
  if (!state.currentPosition || state.saving) return

  const species = el.species.value.trim()
  if (!species) return

  state.saving = true
  updateSaveButtonState()

  const photoFile = el.photo.files[0] || null
  let photo = state.resizedPhoto || null
  if (photoFile && !photo) {
    setSaveStatus('사진 처리 중…')
    try {
      photo = await resizeImageFile(photoFile)
    } catch (error) {
      console.error('Failed to process photo', error)
      state.saving = false
      updateSaveButtonState()
      setSaveStatus('사진을 처리하지 못했습니다. 다른 사진으로 시도해주세요.', { failed: true })
      return
    }
  }

  setSaveStatus('저장 중…')

  const { record, error } = await addRecord({
    species,
    memo: el.memo.value.trim(),
    lat: state.currentPosition.lat,
    lng: state.currentPosition.lng,
    accuracy: state.currentPosition.accuracy,
    photo,
  })

  state.saving = false
  updateSaveButtonState()

  if (!record) {
    console.error('Failed to save record', error)
    setSaveStatus('저장하지 못했습니다. 네트워크 상태를 확인하고 다시 시도해주세요.', { failed: true })
    return
  }

  if (record.ownerId && !state.ownerId) {
    state.ownerId = record.ownerId
  }

  state.records = [record, ...state.records]
  renderMarker(record)
  renderList(state.records)
  setSaveStatus('')

  el.form.reset()
  resetPhotoState()
})

el.retryLocationBtn.addEventListener('click', requestLocation)
el.photoPickBtn.addEventListener('click', () => el.photo.click())
el.photo.addEventListener('change', handlePhotoChange)
el.photoClearBtn.addEventListener('click', clearPhotoInput)

loadExistingRecords()
requestLocation()
