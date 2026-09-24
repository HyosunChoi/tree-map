// Pl@ntNet species suggestion (https://plantnet.org) — free tier, tuned for plant ID
// specifically (better accuracy for this than a general-purpose vision model).
// Missing key must not throw: this is a suggestion aid, never required to log a tree.
const API_BASE = 'https://my-api.plantnet.org/v2/identify/all'

export async function identifySpecies(photoBlob) {
  const apiKey = import.meta.env.VITE_PLANTNET_API_KEY
  if (!apiKey) return { suggestions: [], source: 'unconfigured' }

  const formData = new FormData()
  formData.append('images', photoBlob, 'photo.jpg')
  formData.append('organs', 'auto')

  try {
    const url = `${API_BASE}?api-key=${encodeURIComponent(apiKey)}&lang=ko`
    const response = await fetch(url, { method: 'POST', body: formData })
    if (!response.ok) throw new Error(`Pl@ntNet request failed (${response.status})`)

    const data = await response.json()
    const suggestions = (data.results || []).slice(0, 3).map((result) => ({
      label:
        result.species?.commonNames?.[0] ||
        result.species?.scientificNameWithoutAuthor ||
        '알 수 없는 종',
      scientificName: result.species?.scientificNameWithoutAuthor || '',
      score: result.score,
    }))
    return { suggestions, source: 'remote' }
  } catch (error) {
    return { suggestions: [], source: 'error', error }
  }
}
