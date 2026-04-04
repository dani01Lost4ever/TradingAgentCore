let paused = false
export const isPaused  = () => paused
export const pauseAgent  = () => { paused = true }
export const resumeAgent = () => { paused = false }
