import { BrowserWindow, app, ipcMain, NamedBrowserWindow } from 'electron';
import path from 'path';

export default class {
    hardwareWindow?: NamedBrowserWindow;
    requestLocalDataInterval?: NodeJS.Timeout;

    constructor() {
        this.hardwareWindow = undefined;
    }

    createHardwareWindow() {
        let title;
        if (app.getLocale() === 'ko') {
            title = '엔트리 하드웨어';
        } else {
            title = 'Entry HardWare';
        }

        this.hardwareWindow = new BrowserWindow({
            width: 800,
            height: 650,
            title,
            show: false,
            webPreferences: {
                backgroundThrottling: false,
            },
        });

        this.hardwareWindow.setMenu(null);
        this.hardwareWindow.setMenuBarVisibility(false);
        this.hardwareWindow.loadURL(`file:///${path.resolve(
            __dirname, '..', '..', 'renderer', 'bower_components', 'entry-hw', 'app', 'index.html')}`);
        this.hardwareWindow.on('closed', () => {
            this.hardwareWindow = undefined;
        });

        this.hardwareWindow.webContents.name = 'hardware';
        this.requestLocalDataInterval = undefined;
        ipcMain.on('startRequestLocalData', (event: Electron.Event, duration: number) => {
            this.requestLocalDataInterval = setInterval(() => {
                if (!event.sender.isDestroyed()) {
                    event.sender.send('sendingRequestLocalData');
                }
            }, duration);
        });
        ipcMain.on('stopRequestLocalData', () => {
            if (this.requestLocalDataInterval) {
                clearInterval(this.requestLocalDataInterval);
            }
        });
    }

    openHardwareWindow() {
        if (!this.hardwareWindow) {
            this.createHardwareWindow();
        }
        const hardwareWindow = this.hardwareWindow as BrowserWindow;
        hardwareWindow.show();
        if (hardwareWindow.isMinimized()) {
            hardwareWindow.restore();
        }
        hardwareWindow.focus();
    }

    closeHardwareWindow() {
        if (this.hardwareWindow) {
            if (this.requestLocalDataInterval) {
                clearInterval(this.requestLocalDataInterval);
            }
            this.hardwareWindow.destroy();
        }
    }

    reloadHardwareWindow() {
        if (this.hardwareWindow) {
            this.hardwareWindow.reload();
        }
    }
}
