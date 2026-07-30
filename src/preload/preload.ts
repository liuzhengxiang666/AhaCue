import { contextBridge, ipcRenderer } from "electron";
import type {
  BrowserState,
  DetectedAttemptEvent,
  GuidanceProgress,
  GuidanceRequest,
  MemoryInput,
  OverlayStateInput,
  OverlayDragInput,
  PracticeAPI,
  ProviderId,
  ProviderKeyInput,
  ProviderTestInput,
  WorkflowRuntimeState
} from "../shared/contracts";

const api: PracticeAPI = {
  getSnapshot: () => ipcRenderer.invoke("app:snapshot"),
  onBrowserState: (listener) => {
    const wrapped = (_event: Electron.IpcRendererEvent, state: BrowserState) => listener(state);
    ipcRenderer.on("browser:state-changed", wrapped);
    return () => ipcRenderer.removeListener("browser:state-changed", wrapped);
  },
  getBrowserState: () => ipcRenderer.invoke("browser:state"),
  navigate: (url: string) => ipcRenderer.invoke("browser:navigate", url),
  goBack: () => ipcRenderer.invoke("browser:back"),
  goForward: () => ipcRenderer.invoke("browser:forward"),
  reload: () => ipcRenderer.invoke("browser:reload"),
  acceptZenTerms: () => ipcRenderer.invoke("provider:accept-zen"),
  refreshFreeModels: () => ipcRenderer.invoke("provider:zen-refresh"),
  selectFreeModel: (modelId: string) =>
    ipcRenderer.invoke("provider:zen-select", modelId),
  testFreeModel: (modelId: string) =>
    ipcRenderer.invoke("provider:zen-test", modelId),
  testProvider: (input: ProviderTestInput) => ipcRenderer.invoke("provider:test", input),
  saveProviderKey: (input: ProviderKeyInput) =>
    ipcRenderer.invoke("provider:save-key", input),
  clearProviderKey: (providerId: ProviderId) =>
    ipcRenderer.invoke("provider:clear-key", providerId),
  generateGuidance: (request: GuidanceRequest) =>
    ipcRenderer.invoke("guidance:generate", request),
  cancelGuidance: (requestId: string) =>
    ipcRenderer.invoke("guidance:cancel", requestId),
  onGuidanceProgress: (listener) => {
    const wrapped = (
      _event: Electron.IpcRendererEvent,
      progress: GuidanceProgress
    ) => listener(progress);
    ipcRenderer.on("guidance:progress", wrapped);
    return () => ipcRenderer.removeListener("guidance:progress", wrapped);
  },
  setOverlay: (input: OverlayStateInput) => ipcRenderer.invoke("overlay:set", input),
  dragOverlay: (input: OverlayDragInput) =>
    ipcRenderer.invoke("overlay:drag", input),
  setWorkflowState: (input: WorkflowRuntimeState) =>
    ipcRenderer.invoke("workflow:set-state", input),
  readPracticeContext: () => ipcRenderer.invoke("practice:context"),
  insertSnippet: (snippet: string) => ipcRenderer.invoke("editor:insert-snippet", snippet),
  replaceSolution: (code: string) => ipcRenderer.invoke("editor:replace-solution", code),
  undoEditorChange: () => ipcRenderer.invoke("editor:undo"),
  onAttemptDetected: (listener) => {
    const wrapped = (_event: Electron.IpcRendererEvent, attempt: DetectedAttemptEvent) =>
      listener(attempt);
    ipcRenderer.on("attempt:detected", wrapped);
    return () => ipcRenderer.removeListener("attempt:detected", wrapped);
  },
  saveMemory: (input: MemoryInput) => ipcRenderer.invoke("memory:save", input),
  getProblemMemory: (problemKey: string) => ipcRenderer.invoke("memory:get", problemKey),
  getProblemHistory: (problemKey: string) =>
    ipcRenderer.invoke("problem:history", problemKey),
  exportData: () => ipcRenderer.invoke("data:export"),
  importData: () => ipcRenderer.invoke("data:import"),
  deleteAllData: () => ipcRenderer.invoke("data:delete-all")
};

contextBridge.exposeInMainWorld("practiceAPI", api);
