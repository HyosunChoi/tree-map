import L from 'leaflet'
import 'leaflet/dist/leaflet.css'
import markerIcon2x from 'leaflet/dist/images/marker-icon-2x.png'
import markerIcon from 'leaflet/dist/images/marker-icon.png'
import markerShadow from 'leaflet/dist/images/marker-shadow.png'
import './style.css'
import { getRecords, addRecord, deleteRecord } from './storage.js'

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
}

const el = {
  locationValue: document.getElementById('location-value'),
  retryLocationBtn: document.getElementById('retry-location'),
  form: document.getElementById('tree-form'),
  species: document.getElementById('species'),
  memo: document.getElementById('memo'),
  saveBtn: document.getElementById('save-btn'),
  list: document.getElementById('tree-list'),
  recordCount: document.getElementById('record-count'),
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

function requestLocation() {
  if (!('geolocation' in navigator)) {
    setLocationStatus('이 브라우저는 위치 정보를 지원하지 않습니다.', { failed: true })
    el.saveBtn.disabled = true
    return
  }

  setLocationStatus('현재 위치 확인 중…')
  el.saveBtn.disabled = true

  try {
    navigator.geolocation.getCurrentPosition(
      (position) => {
        const { latitude, longitude, accuracy } = position.coords
        state.currentPosition = { lat: latitude, lng: longitude }
        updateCurrentLocationMarker(latitude, longitude, accuracy)
        map.setView([latitude, longitude], LOCATION_ZOOM)

        const accuracyText = Number.isFinite(accuracy) ? ` · 정확도 ±${Math.round(accuracy)}m` : ''
        setLocationStatus(`현재 위치 확인됨${accuracyText}`)
        el.saveBtn.disabled = false
      },
      (error) => {
        state.currentPosition = null
        el.saveBtn.disabled = true

        let message = '현재 위치를 확인하지 못했습니다.'
        if (error.code === error.PERMISSION_DENIED) {
          message = '위치 접근 권한이 거부되었습니다. 브라우저 설정에서 위치 권한을 허용해주세요.'
        } else if (error.code === error.TIMEOUT) {
          message = '위치 확인이 시간 초과되었습니다.'
        }
        setLocationStatus(message, { failed: true })
      },
      { enableHighAccuracy: true, timeout: 10000, maximumAge: 0 }
    )
  } catch {
    state.currentPosition = null
    el.saveBtn.disabled = true
    setLocationStatus('현재 위치를 확인하지 못했습니다.', { failed: true })
  }
}

function renderMarker(record) {
  const marker = L.marker([record.lat, record.lng]).addTo(map).bindPopup(
    `<strong>${escapeHtml(record.species)}</strong><br>${escapeHtml(record.memo || '')}<br><small>${formatTimestamp(
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

function renderList() {
  const records = getRecords()
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

    const deleteBtn = document.createElement('button')
    deleteBtn.type = 'button'
    deleteBtn.className = 'tree-item-delete'
    deleteBtn.textContent = '삭제'
    deleteBtn.addEventListener('click', (event) => {
      event.stopPropagation()
      handleDelete(record.id)
    })

    li.append(main, deleteBtn)
    li.addEventListener('click', () => {
      map.setView([record.lat, record.lng], DEFAULT_ZOOM)
      state.markers.get(record.id)?.openPopup()
    })

    el.list.appendChild(li)
  }
}

function handleDelete(id) {
  deleteRecord(id)
  removeMarker(id)
  renderList()
}

function loadExistingRecords() {
  for (const record of getRecords()) {
    renderMarker(record)
  }
  renderList()
}

el.form.addEventListener('submit', (event) => {
  event.preventDefault()
  if (!state.currentPosition) return

  const species = el.species.value.trim()
  if (!species) return

  const record = addRecord({
    species,
    memo: el.memo.value.trim(),
    lat: state.currentPosition.lat,
    lng: state.currentPosition.lng,
  })

  renderMarker(record)
  renderList()

  el.form.reset()
})

el.retryLocationBtn.addEventListener('click', requestLocation)

loadExistingRecords()
requestLocation()
