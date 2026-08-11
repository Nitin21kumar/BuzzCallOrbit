import { createContext, useContext } from 'react'

const PermissionsContext = createContext(null)

export function PermissionsProvider({ profile, catalog, refreshProfile, children }) {
  // Two DIFFERENT questions that must not be conflated:
  //  - hasModule(module): "can this person even open this page / see it in
  //    the sidebar?" — a pure membership check against profile.modules.
  //  - can(module, service): "can they view the data inside it, or perform
  //    a specific action?" — checks the granular service grant.
  // A brand-new user gets every module (except Users) in profile.modules but
  // zero entries in profile.services — so hasModule() is true (they can open
  // the page and see what it offers) while can(module, 'view'/'create'/...)
  // is false (no data, no actions) until an admin grants specific services.
  const hasModule = (module) => {
    if (!profile) return false
    if (profile.role === 'super_admin' || profile.role === 'admin') return true
    return (profile.modules || []).includes(module)
  }

  const can = (module, service) => {
    if (!profile) return false
    if (profile.role === 'super_admin' || profile.role === 'admin') return true
    if (!(profile.modules || []).includes(module)) return false
    if (!service) return true
    return (profile.services || []).includes(`${module}:${service}`)
  }

  const canField = (module, field) => {
    if (!profile) return false
    if (profile.role === 'super_admin' || profile.role === 'admin') return true
    return (profile.fields || []).includes(`${module}:${field}`)
  }

  return (
    <PermissionsContext.Provider value={{ profile, catalog, hasModule, can, canField, refreshProfile }}>
      {children}
    </PermissionsContext.Provider>
  )
}

export function usePermissions() {
  const ctx = useContext(PermissionsContext)
  if (!ctx) throw new Error('usePermissions must be used within a PermissionsProvider')
  return ctx
}
