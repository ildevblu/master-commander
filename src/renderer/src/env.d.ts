import type { MasterCommanderApi } from '../../preload/index'

declare global {
  interface Window {
    masterCommander: MasterCommanderApi
  }
}

export {}
