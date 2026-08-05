import { useEffect, useRef } from 'react'
import { Search, X } from 'lucide-react'

export default function SearchBar({ active, query, onQueryChange, onClose }) {
  const inputRef = useRef(null)

  useEffect(() => {
    if (active) inputRef.current?.focus()
  }, [active])

  useEffect(() => {
    const onKey = (e) => { if (e.key === 'Escape') onClose() }
    if (active) document.addEventListener('keydown', onKey)
    return () => document.removeEventListener('keydown', onKey)
  }, [active, onClose])

  if (!active) return null

  return (
    <div className="search-overlay">
      <div className="search-overlay-bar">
        <Search size={16} className="search-overlay-icon" />
        <input
          ref={inputRef}
          value={query}
          onChange={(e) => onQueryChange(e.target.value)}
          placeholder="Search campaigns by name..."
          className="search-overlay-input"
        />
        <button className="search-overlay-close" onClick={onClose} aria-label="Close search"><X size={15} /></button>
      </div>
    </div>
  )
}
