import type { PracticeAPI } from "../shared/contracts";

declare global {
  interface Window {
    practiceAPI: PracticeAPI;
  }
}

export {};
