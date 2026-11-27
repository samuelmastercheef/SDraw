import type { SdrawApi } from '../preload/api'

declare global {
  interface Window {
    sdraw: SdrawApi
  }
}

export {}
