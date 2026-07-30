import path from "node:path";
import {
  app,
  BaseWindow,
  BrowserWindow,
  Menu,
  session,
  shell,
  WebContentsView,
  type Event,
  type Input
} from "electron";
import type {
  BrowserState,
  OverlayAnchor,
  OverlayDragInput,
  OverlayMode,
  WorkflowRuntimeState
} from "../shared/contracts";
import {
  createAutomaticMemory,
  isRestrictedPracticeUrl,
  isSupportedPracticeUrl,
  normalizeNavigationUrl
} from "../shared/workflow";
import { DatabaseService } from "./database";
import { registerIpc } from "./ipc";
import {
  boundsForOverlay,
  clampDraggedBounds,
  collapsedOverlayShape,
  normalizeOverlayAnchor,
  snapOverlayAnchor,
  type Rect
} from "./overlay-geometry";
import { PlatformAdapterHost } from "./platform-adapter-host";
import { ProviderRouter } from "./provider-router";
import { SecretStore } from "./secret-store";

declare const MAIN_WINDOW_VITE_DEV_SERVER_URL: string | undefined;
declare const MAIN_WINDOW_VITE_NAME: string;

const DEFAULT_URL = "https://leetcode.cn/problemset/";
const OVERLAY_ANCHOR_SETTING = "overlayAnchor";

let mainWindow: BaseWindow | undefined;
let browserView: WebContentsView | undefined;
let overlayWindow: BrowserWindow | undefined;
let database: DatabaseService | undefined;
let adapterHost: PlatformAdapterHost | undefined;
let removeIpc: (() => void) | undefined;
let attemptTimer: NodeJS.Timeout | undefined;
let attemptPollBusy = false;
let overlayMode: OverlayMode = "collapsed";
let overlayContentHeight = 420;
let overlayAnchor: OverlayAnchor = { side: "right", yRatio: 0.82 };
let dragState:
  | {
      startX: number;
      startY: number;
      bounds: Rect;
    }
  | undefined;
let workflowState: WorkflowRuntimeState = {
  mode: "guided",
  stage: "understand"
};

if (!app.isPackaged) {
  app.setPath("userData", path.join(app.getPath("appData"), "Algo Companion Dev"));
}

if (process.platform === "linux") {
  app.commandLine.appendSwitch("use-gl", "angle");
  app.commandLine.appendSwitch("use-angle", "swiftshader");
}

function currentBrowserState(): BrowserState {
  const url = browserView?.webContents.getURL() || DEFAULT_URL;
  return {
    url,
    title: browserView?.webContents.getTitle() || "Practice",
    canGoBack: browserView?.webContents.navigationHistory.canGoBack() ?? false,
    canGoForward: browserView?.webContents.navigationHistory.canGoForward() ?? false,
    restricted: isRestrictedPracticeUrl(url),
    supported: isSupportedPracticeUrl(url)
  };
}

function contentBounds(): Rect | undefined {
  return mainWindow?.getContentBounds();
}

function layoutBrowser(): void {
  if (!mainWindow || !browserView) return;
  const [width, height] = mainWindow.getContentSize();
  browserView.setBounds({ x: 0, y: 0, width, height });
}

function layoutOverlay(): void {
  if (!overlayWindow || overlayWindow.isDestroyed() || dragState) return;
  const content = contentBounds();
  if (!content) return;
  const bounds = boundsForOverlay(
    content,
    overlayAnchor,
    overlayMode,
    overlayContentHeight
  );
  overlayWindow.setBounds(bounds, false);
  if (process.platform === "linux" || process.platform === "win32") {
    overlayWindow.setShape(
      overlayMode === "collapsed"
        ? collapsedOverlayShape(bounds.width)
        : [{ x: 0, y: 0, width: bounds.width, height: bounds.height }]
    );
  }
}

function syncOverlayVisibility(): void {
  if (!mainWindow || !overlayWindow || overlayWindow.isDestroyed()) return;
  const shouldShow =
    !mainWindow.isMinimized() && !currentBrowserState().restricted;
  if (shouldShow) {
    layoutOverlay();
    overlayWindow.showInactive();
  } else {
    overlayWindow.hide();
  }
}

function layoutWindows(): void {
  dragState = undefined;
  layoutBrowser();
  layoutOverlay();
}

function setOverlay(mode: OverlayMode, contentHeight?: number): void {
  overlayMode = mode;
  if (typeof contentHeight === "number" && contentHeight > 0) {
    overlayContentHeight = contentHeight;
  }
  layoutOverlay();
}

function persistOverlayAnchor(): void {
  database?.setSetting(OVERLAY_ANCHOR_SETTING, JSON.stringify(overlayAnchor));
}

function dragOverlay(input: OverlayDragInput): void {
  if (!overlayWindow || overlayWindow.isDestroyed()) return;
  const content = contentBounds();
  if (!content) return;
  if (input.phase === "start") {
    dragState = {
      startX: input.screenX,
      startY: input.screenY,
      bounds: overlayWindow.getBounds()
    };
    return;
  }
  if (!dragState) return;
  const moved = clampDraggedBounds(content, {
    ...dragState.bounds,
    x: Math.round(dragState.bounds.x + input.screenX - dragState.startX),
    y: Math.round(dragState.bounds.y + input.screenY - dragState.startY)
  });
  overlayWindow.setBounds(moved, false);
  if (input.phase === "end") {
    overlayAnchor = snapOverlayAnchor(content, moved);
    dragState = undefined;
    persistOverlayAnchor();
    layoutOverlay();
  }
}

function sendBrowserState(): void {
  if (!overlayWindow || overlayWindow.webContents.isDestroyed()) return;
  const state = currentBrowserState();
  overlayWindow.webContents.send("browser:state-changed", state);
  syncOverlayVisibility();
}

function allowRemoteNavigation(event: Event, url: string): void {
  if (isSupportedPracticeUrl(url)) return;
  event.preventDefault();
  try {
    const parsed = new URL(url);
    if (parsed.protocol === "https:") void shell.openExternal(parsed.toString());
  } catch {
    // Ignore invalid external navigation.
  }
}

function handleBrowserShortcut(input: Input): void {
  if (!browserView || input.type !== "keyDown") return;
  const history = browserView.webContents.navigationHistory;
  const command = input.key.toLowerCase();
  if (input.alt && command === "left" && history.canGoBack()) history.goBack();
  if (input.alt && command === "right" && history.canGoForward()) history.goForward();
  if ((input.control || input.meta) && command === "r") browserView.webContents.reload();
  if (command === "f5") browserView.webContents.reload();
}

async function attachAdapter(): Promise<void> {
  await adapterHost?.attach().catch(() => undefined);
}

async function pollAttempts(): Promise<void> {
  if (attemptPollBusy || !adapterHost || !database || !overlayWindow) return;
  if (currentBrowserState().restricted) return;
  attemptPollBusy = true;
  try {
    const observed = await adapterHost.pollAttempt();
    if (!observed) return;
    const record = database.recordAttempt({
      ...observed.draft,
      mode: workflowState.mode,
      stage: workflowState.stage,
      trigger: observed.trigger,
      status: observed.status
    });
    if (record.status === "accepted" && record.trigger === "submit") {
      const history = database.listProblemHistory(record.problemKey);
      database.saveMemory(
        createAutomaticMemory(observed.draft, history, workflowState.selectedMethod)
      );
    }
    if (!overlayWindow.webContents.isDestroyed()) {
      overlayWindow.webContents.send("attempt:detected", {
        record,
        draft: observed.draft
      });
    }
  } finally {
    attemptPollBusy = false;
  }
}

function registerBrowserEvents(): void {
  if (!browserView) return;
  browserView.webContents.on("will-navigate", allowRemoteNavigation);
  browserView.webContents.on("before-input-event", (_event, input) =>
    handleBrowserShortcut(input)
  );
  browserView.webContents.setWindowOpenHandler(({ url }) => {
    if (isSupportedPracticeUrl(url)) {
      void browserView?.webContents.loadURL(url);
    } else {
      try {
        const parsed = new URL(url);
        if (parsed.protocol === "https:") void shell.openExternal(parsed.toString());
      } catch {
        // Ignore invalid URLs.
      }
    }
    return { action: "deny" };
  });
  browserView.webContents.on("did-navigate", () => {
    setOverlay("collapsed", 420);
    sendBrowserState();
    void attachAdapter();
  });
  browserView.webContents.on("did-navigate-in-page", () => {
    setOverlay("collapsed", 420);
    sendBrowserState();
    void attachAdapter();
  });
  browserView.webContents.on("did-finish-load", () => {
    sendBrowserState();
    void attachAdapter();
  });
  browserView.webContents.on("page-title-updated", sendBrowserState);
}

function createOverlayWindow(): BrowserWindow {
  if (!mainWindow) throw new Error("主窗口尚未创建。");
  const initial = boundsForOverlay(
    mainWindow.getContentBounds(),
    overlayAnchor,
    overlayMode,
    overlayContentHeight
  );
  const win = new BrowserWindow({
    ...initial,
    parent: mainWindow,
    show: false,
    frame: false,
    transparent: true,
    resizable: false,
    maximizable: false,
    minimizable: false,
    fullscreenable: false,
    skipTaskbar: true,
    hasShadow: false,
    backgroundColor: "#00000000",
    webPreferences: {
      preload: path.join(__dirname, "preload.js"),
      nodeIntegration: false,
      contextIsolation: true,
      sandbox: true,
      webSecurity: true,
      allowRunningInsecureContent: false,
      devTools: false
    }
  });
  win.setMenu(null);
  win.webContents.setWindowOpenHandler(() => ({ action: "deny" }));
  win.webContents.on("will-navigate", (event) => event.preventDefault());
  return win;
}

async function createWindow(): Promise<void> {
  const remoteSession = session.fromPartition("persist:practice-browser", {
    cache: true
  });
  remoteSession.setPermissionRequestHandler(
    (_contents, _permission, callback) => callback(false)
  );
  remoteSession.setPermissionCheckHandler(() => false);

  mainWindow = new BaseWindow({
    width: 1440,
    height: 900,
    minWidth: 900,
    minHeight: 640,
    title: "Algo Companion",
    backgroundColor: "#0b1120"
  });

  browserView = new WebContentsView({
    webPreferences: {
      partition: "persist:practice-browser",
      nodeIntegration: false,
      contextIsolation: true,
      sandbox: true,
      webSecurity: true,
      allowRunningInsecureContent: false,
      devTools: false
    }
  });
  mainWindow.contentView.addChildView(browserView);
  layoutBrowser();
  registerBrowserEvents();

  const secrets = new SecretStore(app.getPath("userData"));
  await secrets.initialize();
  database = new DatabaseService(path.join(app.getPath("userData"), "practice.db"));
  const storedAnchor = database.getSetting(OVERLAY_ANCHOR_SETTING);
  if (storedAnchor) {
    try {
      overlayAnchor = normalizeOverlayAnchor(JSON.parse(storedAnchor));
    } catch {
      overlayAnchor = normalizeOverlayAnchor(undefined);
    }
  }
  const providers = new ProviderRouter(database, secrets);
  adapterHost = new PlatformAdapterHost(browserView.webContents);
  await adapterHost.initialize();
  overlayWindow = createOverlayWindow();

  removeIpc = registerIpc({
    appContentsId: overlayWindow.webContents.id,
    database,
    providers,
    secrets,
    getBrowserState: currentBrowserState,
    navigate: async (rawUrl) => {
      const url = normalizeNavigationUrl(rawUrl);
      await browserView?.webContents.loadURL(url);
      return currentBrowserState();
    },
    goBack: () => {
      if (browserView?.webContents.navigationHistory.canGoBack()) {
        browserView.webContents.navigationHistory.goBack();
      }
    },
    goForward: () => {
      if (browserView?.webContents.navigationHistory.canGoForward()) {
        browserView.webContents.navigationHistory.goForward();
      }
    },
    reload: () => browserView?.webContents.reload(),
    setOverlay,
    dragOverlay,
    setWorkflowState: (state) => {
      workflowState = state;
    },
    readPracticeContext: () =>
      adapterHost?.readContext() ??
      Promise.resolve({
        recognized: false,
        reason: "自动适配器尚未初始化。",
        capturedAt: new Date().toISOString()
      }),
    insertSnippet: (snippet) => {
      if (!adapterHost) throw new Error("自动适配器尚未初始化。");
      return adapterHost.insertSnippet(snippet);
    },
    replaceSolution: (code) => {
      if (!adapterHost) throw new Error("自动适配器尚未初始化。");
      return adapterHost.replaceSolution(code);
    },
    undoEditorChange: () => {
      if (!adapterHost) throw new Error("自动适配器尚未初始化。");
      return adapterHost.undo();
    }
  });

  if (MAIN_WINDOW_VITE_DEV_SERVER_URL) {
    await overlayWindow.loadURL(MAIN_WINDOW_VITE_DEV_SERVER_URL);
  } else {
    await overlayWindow.loadFile(
      path.join(__dirname, `../renderer/${MAIN_WINDOW_VITE_NAME}/index.html`)
    );
  }

  mainWindow.on("resize", layoutWindows);
  mainWindow.on("move", layoutWindows);
  mainWindow.on("minimize", syncOverlayVisibility);
  mainWindow.on("restore", syncOverlayVisibility);
  mainWindow.on("show", syncOverlayVisibility);
  mainWindow.on("closed", () => {
    removeIpc?.();
    removeIpc = undefined;
    if (attemptTimer) clearInterval(attemptTimer);
    attemptTimer = undefined;
    adapterHost = undefined;
    if (overlayWindow && !overlayWindow.isDestroyed()) overlayWindow.destroy();
    browserView?.webContents.close();
    overlayWindow = undefined;
    browserView = undefined;
    mainWindow = undefined;
  });

  await browserView.webContents.loadURL(DEFAULT_URL);
  sendBrowserState();
  syncOverlayVisibility();
  attemptTimer = setInterval(() => void pollAttempts(), 1_200);
  void providers.refreshFreeModels().catch(() => undefined);
}

app.whenReady().then(async () => {
  Menu.setApplicationMenu(null);
  await createWindow();
  app.on("activate", () => {
    if (!mainWindow) void createWindow();
  });
});

app.on("window-all-closed", () => {
  if (process.platform !== "darwin") app.quit();
});

app.on("before-quit", () => {
  if (attemptTimer) clearInterval(attemptTimer);
  database?.close();
  database = undefined;
});
