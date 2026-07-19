import { createContext, useContext, type ReactNode } from 'react'

const Framework7RuntimeContext = createContext(false)

export function Framework7RuntimeProvider({ children }: { children: ReactNode }) {
  return (
    <Framework7RuntimeContext.Provider value>
      {children}
    </Framework7RuntimeContext.Provider>
  )
}

// eslint-disable-next-line react-refresh/only-export-components -- this hook is intentionally colocated with its private context.
export function useFramework7Runtime() {
  return useContext(Framework7RuntimeContext)
}
