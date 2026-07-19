import Framework7 from 'framework7/lite-bundle'
import Framework7React from 'framework7-react'

// Framework7 is a process-wide singleton. Keep plugin registration in one module
// so every entry point (including tests and embedded views) gets the same runtime.
// eslint-disable-next-line react-hooks/rules-of-hooks -- Framework7 plugin registration, not a React hook.
Framework7.use(Framework7React)

export default Framework7
