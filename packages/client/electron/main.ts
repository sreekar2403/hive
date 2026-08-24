import { app, BrowserWindow, globalShortcut } from "electron";
import * as path from "path";

let mainWindow: BrowserWindow | null = null;

function createWindow() {
  mainWindow = new BrowserWindow({
    width: 1400,
    height: 900,
    minWidth: 1100,
    minHeight: 720,
    webPreferences: {
      preload: path.join(__dirname, "preload.js"),
      contextIsolation: true,
      nodeIntegration: false,
    },
    // Matches the app's dark ground so there's no white flash before the
    // renderer paints.
    backgroundColor: "#0e1013",
    // Window + taskbar icon (the bundle/installer icon comes from
    // electron-builder via electron/icons/icon.ico).
    icon: path.join(__dirname, "..", "icons", "icon.png"),
    show: false,
  });

  // Avoid the blank-window flash on startup.
  mainWindow.once("ready-to-show", () => mainWindow?.show());

  const isDev = process.env.NODE_ENV === "development";
  if (isDev) {
    mainWindow.loadURL("http://localhost:3000");
  } else {
    // Compiled main.js lives in electron/dist/; the Vite build output is
    // packages/client/dist/.
    mainWindow.loadFile(path.join(__dirname, "..", "..", "dist", "index.html"));
  }

  // DevTools open on request only. Set HIVE_DEVTOOLS=1 to have them open
  // at launch instead.
  if (process.env.HIVE_DEVTOOLS === "1") {
    mainWindow.webContents.openDevTools({ mode: "detach" });
  }
}

app.whenReady().then(() => {
  createWindow();

  const toggleDevTools = () => {
    const contents = BrowserWindow.getFocusedWindow()?.webContents;
    if (!contents) return;
    if (contents.isDevToolsOpened()) contents.closeDevTools();
    else contents.openDevTools({ mode: "detach" });
  };
  globalShortcut.register("F12", toggleDevTools);
  globalShortcut.register("CommandOrControl+Shift+I", toggleDevTools);
});

app.on("will-quit", () => {
  globalShortcut.unregisterAll();
});

app.on("window-all-closed", () => {
  if (process.platform !== "darwin") app.quit();
});

app.on("activate", () => {
  if (BrowserWindow.getAllWindows().length === 0) createWindow();
});
