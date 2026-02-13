import { app, Tray, Menu, BrowserWindow, nativeImage } from 'electron';
import * as path from 'path';

let tray: Tray | null = null;

export function createTray(
  mainWindow: BrowserWindow,
  onChangeLibrary: () => void,
): Tray {
  // Use Template image for macOS (auto-adapts to light/dark mode)
  const iconPath = path.join(__dirname, '../icons/tray-Template.png');
  let icon: Electron.NativeImage;

  try {
    icon = nativeImage.createFromPath(iconPath);
  } catch {
    // Fallback to empty image if icon not found
    icon = nativeImage.createEmpty();
  }

  tray = new Tray(icon);
  tray.setToolTip('Alex');

  const contextMenu = Menu.buildFromTemplate([
    {
      label: 'Show Alex',
      click: () => {
        mainWindow.show();
        if (mainWindow.isMinimized()) {
          mainWindow.restore();
        }
      },
    },
    {
      label: 'Change Library Folder...',
      click: () => {
        onChangeLibrary();
      },
    },
    { type: 'separator' },
    {
      label: 'Quit Alex',
      click: () => {
        app.quit();
      },
    },
  ]);

  tray.setContextMenu(contextMenu);

  // Click tray icon to toggle window visibility
  tray.on('click', () => {
    if (mainWindow.isVisible()) {
      mainWindow.hide();
    } else {
      mainWindow.show();
      if (mainWindow.isMinimized()) {
        mainWindow.restore();
      }
    }
  });

  return tray;
}

export function destroyTray() {
  if (tray) {
    tray.destroy();
    tray = null;
  }
}
