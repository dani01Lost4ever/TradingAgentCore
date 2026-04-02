export interface AgentConfig {
  autoApprove: boolean
}

const state: AgentConfig = {
  autoApprove: false,
}

export function getConfig(): Readonly<AgentConfig> {
  return state
}

export function setConfig(updates: Partial<AgentConfig>): AgentConfig {
  Object.assign(state, updates)
  return state
}
