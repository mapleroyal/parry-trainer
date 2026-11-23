// A Hyperline record updates atomically and holds at most 8 KiB across 32
// fields. Share common settings between drills and keep portable exports as
// ordinary trainer JSON. Stay below the limit including protobuf field overhead.
export const fieldCount = 30
const fieldBytes = 250
const chunkName = index => 'p' + index

export function packTrainerDocument(doc) {
  const values = [], keys = new Map(), settings = [], saved = new Map()
  function encode(text) {
    if (text === undefined) return -1
    if (saved.has(text)) return saved.get(text)
    let coded = ''
    for (const value of text.split(',')) {
      if (!keys.has(value)) {
        if (values.length >= 16384) throw Error('Too many settings.')
        keys.set(value, values.length)
        values.push(value)
      }
      coded += String.fromCharCode(64 + keys.get(value))
    }
    const id = settings.length
    saved.set(text, id)
    settings.push(coded)
    return id
  }
  const current = encode(doc.settings)
  const profiles = doc.profiles.map(p => [p.id, p.name, encode(p.settings), p.loadout || null])
  return JSON.stringify([1, doc.nextId, values, settings, current, profiles])
}

export function unpackTrainerDocument(packed) {
  const [version, nextId, values, settings, current, profiles] = JSON.parse(packed)
  if (version !== 1 || !Array.isArray(values) || !values.every(v => typeof v === 'string') ||
      !Array.isArray(settings) || !Array.isArray(profiles)) throw Error('Invalid cloud library.')
  const expanded = settings.map(text => {
    if (typeof text !== 'string' || text.length > 256) throw Error('Invalid drill.')
    const result = []
    for (const c of text) {
      const value = values[c.charCodeAt(0) - 64]
      if (value === undefined) throw Error('Invalid drill setting.')
      result.push(value)
    }
    const saved = result.join(',')
    if (saved.length > 2048) throw Error('Drill is too long.')
    return saved
  })
  function drill(key) {
    if (!Number.isInteger(key) || key < 0 || key >= expanded.length) throw Error('Missing drill.')
    return expanded[key]
  }
  return JSON.stringify({ format: 'parry-trainer', version: 3, nextId, settings: drill(current),
    profiles: profiles.map(([id, name, key, build]) => ({ id, name, loadout: build ?? undefined,
      settings: key === -1 ? undefined : drill(key) })) })
}

export function recordParts(packed) {
  const parts = []
  let field = '', bytes = 0
  for (const c of packed) {
    const n = c.codePointAt(0), size = n < 128 ? 1 : n < 2048 ? 2 : n < 65536 ? 3 : 4
    if (bytes + size > fieldBytes) {
      parts.push(field)
      if (parts.length === fieldCount) return
      field = ''
      bytes = 0
    }
    field += c
    bytes += size
  }
  if (field) parts.push(field)
  return parts
}

// Always replace the entire record, including trailing fields from a previously
// larger library. This is one transaction even when lobbies overlap.
export function recordUpdate(parts) {
  return Object.fromEntries(Array.from({length: fieldCount}, (_, i) => [chunkName(i), { set: parts[i] || '' }]))
}

export function readRecord(record) {
  if (!Object.keys(record).length) return undefined
  let packed = '', ended = false
  for (let i = 0; i < fieldCount; i++) {
    const text = record[chunkName(i)]
    if (typeof text !== 'string' || (ended && text)) throw Error('Incomplete cloud record.')
    ended = ended || !text
    packed += text
  }
  return unpackTrainerDocument(packed)
}
