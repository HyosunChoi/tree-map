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

const state = {
  currentPosition: null,
  markers: new Map(),
}

const el = {
  locationValue: document.getElementById('location-value'),
  refreshLocationBtn: document.getElementById('refresh-location'),
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

function setLocationStatus(text) {
  el.locationValue.textContent = text
}

function requestLocation() {
  if (!('geolocation' in navigator)) {
    setLocationStatus('이 브라우저는 위치 정보를 지원하지 않습니다')
    el.saveBtn.disabled = true
    return
  }

  setLocationStatus('위치 확인 중…')
  el.saveBtn.disabled = true

  navigator.geolocation.getCurrentPosition(
    (position) => {
      const { latitude, longitude } = position.coords
      state.currentPosition = { lat: latitude, lng: longitude }
      setLocationStatus(`${formatCoord(latitude)}, ${formatCoord(longitude)}`)
      el.saveBtn.disabled = false
      map.setView([latitude, longitude], DEFAULT_ZOOM)
    },
    (error) => {
      state.currentPosition = null
      el.saveBtn.disabled = true
      if (error.code === error.PERMISSION_DENIED) {
        setLocationStatus('위치 접근이 거부되었습니다. 브라우저 설정을 확인하세요')
      } else {
        setLocationStatus('위치를 확인할 수 없습니다. 다시 시도해주세요')
      }
    },
    { enableHighAccuracy: true, timeout: 10000, maximumAge: 0 }
  )
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

el.refreshLocationBtn.addEventListener('click', requestLocation)

loadExistingRecords()
requestLocation()
