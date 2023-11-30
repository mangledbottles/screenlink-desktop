import { app, BrowserWindow, ipcMain, desktopCapturer, dialog, nativeImage, shell, systemPreferences } from 'electron'
import { Tray, Menu } from 'electron'
import os from 'os';
import axios from 'axios';


let mainWindow: BrowserWindow | null
let floatingWindow: BrowserWindow | null
let webcamWindow: BrowserWindow | null
let tray: Tray | null = null

// recording state
let showCameraWindow = false;

import { createReadStream, unlink, writeFile } from 'node:fs'
import { writeFile as writeFilePromise, readFile as readFilePromise } from 'fs/promises';
import path from 'node:path'
import got from "got";
const sessionDataPath = app.getPath('sessionData');
const deviceCodeFilePath = path.join(sessionDataPath, 'deviceCode.txt');
import cp from 'child_process';
import { baseUrl } from '../src/utils';

function getComputerName() {
  switch (process.platform) {
    case "win32":
      return process.env.COMPUTERNAME;
    case "darwin":
      return cp.execSync("scutil --get ComputerName").toString().trim();
    case "linux":
      const prettyname = cp.execSync("hostnamectl --pretty").toString().trim();
      return prettyname === "" ? os.hostname() : prettyname;
    default:
      return os.hostname();
  }
}

ipcMain.handle('get-desktop-capturer-sources', async () => {
  const sources = await desktopCapturer.getSources({ types: ['window', 'screen'], fetchWindowIcons: true, thumbnailSize: { width: 1920, height: 1080 } })
  // const sources = await desktopCapturer.getSources({ types: ['screen'], fetchWindowIcons: true, thumbnailSize: { width: 1920, height: 1080 } })
  const excludeTitles = ['ScreenLink.io', 'App Icon Window', 'App Icon Screens', 'Gesture Blocking Overlay', 'Touch Bar']
  return sources
    .filter(source => !excludeTitles.includes(source.name))
    .map(source => ({
      id: source.id,
      name: source.name,
      thumbnail: source.thumbnail.toDataURL() ?? source.appIcon.toDataURL(),
      dimensions: {
        width: source.thumbnail.getSize().width,
        height: source.thumbnail.getSize().height,
      },
    }))
})

ipcMain.handle('get-webcam-sources', async () => {
  const webcam = await navigator.mediaDevices.getUserMedia({
    audio: true,
    video: true
  });
  return webcam;
});



// save video to file; show-save-dialog
ipcMain.handle('show-save-dialog', async (_, options: Electron.SaveDialogOptions) => {
  return await dialog.showSaveDialog({
    ...options,
    buttonLabel: 'Save video',
    defaultPath: `content-${Date.now()}.webm`
  });
});

// save video
ipcMain.handle('save-video', async (_, filePath, buffer: Buffer) => {
  await writeFile(filePath, buffer, () => console.log('video saved successfully!'));
});


ipcMain.handle('set-camera-source', async (_, source: Partial<MediaDeviceInfo> | null) => {
  if (webcamWindow) {
    webcamWindow.webContents.send('new-camera-source', source);
  }
});

ipcMain.handle('start-recording', async (_) => {
  if (mainWindow) mainWindow.minimize();
  if (webcamWindow && showCameraWindow) {
    toggleCameraWindow(true);
    webcamWindow.setAlwaysOnTop(true);
  }
  if (floatingWindow) {
    floatingWindow.show();
    floatingWindow.webContents.send('started-recording', true);
  }
});

ipcMain.handle('stop-recording', async (_) => {
  if (floatingWindow) floatingWindow.hide();
  if (webcamWindow) {
    toggleCameraWindow(true);
    webcamWindow.setAlwaysOnTop(false);
  }
  if (mainWindow) {
    console.log("finsihed recoridng, opening mainwindow")
    mainWindow.webContents.send('finished-recording', true);
    mainWindow.maximize();
    mainWindow.focus();
  }
});

const getUploadLink = async (sourceTitle: string) => {
  try {
    const deviceCode = await getDeviceCode();
    const url = `${baseUrl}/api/uploads`
    console.log({ url, sourceTitle, deviceCode })
    const response = await axios.post(url,
      { sourceTitle: sourceTitle ?? 'Recording' },
      {
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${deviceCode}`
        }
      }
    );
    if (response.status !== 200) {
      console.log(response.data);
      throw new Error(response.statusText);
    }
    const data = response.data;

    return data;
  } catch (error) {
    console.log(error)
    throw new Error(JSON.stringify({ e: "failed to get upload link", error }))
  }
}

// convert buffer to video file and upload to Mux
ipcMain.handle('upload-video', async (_, buffer: Buffer, sourceTitle: string) => {
  try {
    await getAccount();

    // Define a temporary file path for storage
    const tempFilePath = path.join(app.getPath('home'), `temp-${Date.now()}.webm`);

    // Convert buffer to video file
    await writeFile(tempFilePath, buffer, () => console.log('Video file created successfully!'));

    // Make a request to get the upload URL
    const upload = await getUploadLink(sourceTitle);
    const uploadLink = upload.uploadLink;
    const id = upload.id;

    got.put(uploadLink, {
      body: createReadStream(tempFilePath),
    }).then(async () => {
      console.log('Video uploaded successfully!');

      // Delete the temporary file after upload
      unlink(tempFilePath, (err) => {
        if (err) {
          throw new Error(JSON.stringify({ e: "failed to delete temporary file", err, tempFilePath }));
        } else {
          console.log('Temporary file deleted successfully!');
        }
      });
    }).catch((err) => {
      console.log(JSON.stringify({ e: "failed to upload video", err, uploadLink }))
      throw new Error(err);
    });

    return id;
  } catch (error) {
    console.log(error)
  }
});

ipcMain.handle('open-in-browser', async (_, url: string) => {
  try {
    return await shell.openExternal(url);
  } catch (error) {
    console.log(error)
  }
});

ipcMain.handle('open-new-device', async (_) => {
  try {
    const deviceName = getComputerName();
    const appVersion = app.getVersion();
    const deviceType = os.type();
    const url = `${baseUrl}/app/devices/new?device=${deviceName}&appVersion=${appVersion}&deviceType=${deviceType}`;
    return await shell.openExternal(url);
  } catch (error) {
    console.log(error)
  }
});

ipcMain.handle('show-camera-window', async (_, show: boolean) => {
  try {
    toggleCameraWindow(show);
  } catch (error) {
    console.log(error)
  }
});

const toggleCameraWindow = (show: boolean) => {
  if (webcamWindow) {
    showCameraWindow = show;
    if (show) webcamWindow.show();
    else webcamWindow.hide();
  }
}

const verifyDeviceCode = async (deviceCode: string) => {
  try {
    const url = `${baseUrl}/api/devices/verify`;
    const response = await fetch(url, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({ deviceCode })
    });
    if (response.status !== 200) {
      console.log(JSON.stringify({ e: "failed to verify device code", url }))
      throw new Error(response.statusText);
    }
    const data = await response.json();
    if (data.error) {
      console.log(JSON.stringify({ e: "failed to verify device code", url, error: data.error }))
      throw new Error(data.error);
    }
    return data;
  } catch (error) {
    console.log(error)
    throw new Error(JSON.stringify({ e: "failed to verify device code", error }))
  }
}

const getDeviceCode = async () => {
  // Read the device code from the file (deviceCodeFilePath)
  // and send it to the renderer process
  const deviceCodeBuffer = await readFilePromise(deviceCodeFilePath);
  const deviceCode = deviceCodeBuffer.toString();

  if (!deviceCode) {
    if (mainWindow) {
      mainWindow.webContents.send('device-code', '');
    }
    return;
  }
  return deviceCode;
}

const getAccount = async () => {
  try {
    const deviceCode = await getDeviceCode();
    console.log('Device code on get: ', deviceCode);
    if (deviceCode === '' || !deviceCode) {
      if (mainWindow) {
        mainWindow.webContents.send('device-code', 'Device code not available');
      }
      return;
    }

    // Verify the device code
    const device = await verifyDeviceCode(deviceCode);
    if (!device) {
      if (mainWindow) {
        mainWindow.webContents.send('device-code', 'Device code not available');
      }
      return;
    }
    return device;
  } catch (error) {
    console.log(error)
    if (mainWindow) {
      mainWindow.webContents.send('device-code', 'Device code not available');
    }
    return;
  }
}

ipcMain.handle('get-device-code', async (_) => {
  try {
    const deviceCode = await getDeviceCode();
    console.log('Device code on get: ', deviceCode);
    if (deviceCode === '') {
      return null;
    }

    // TODO: Update this logic as it does not need to check immediately on open, maybe 5 seconds later (UI purposes)
    // Verify the device code
    // const device = await verifyDeviceCode(deviceCode);
    // if (!device) {
    //   return null;
    // }
    return deviceCode;
  } catch (error) {
    console.log(error)
    return null;
  }
});

ipcMain.handle('permissions-missing', async (_) => {
  try {
    if (mainWindow) {
      mainWindow.webContents.send('set-window', 'permissions');
    }
  } catch (error) {
    console.log(error)
  }
});

// The built directory structure
//
// ├─┬─┬ dist
// │ │ └── index.html
// │ │
// │ ├─┬ dist-electron
// │ │ ├── main.js
// │ │ └── preload.js
// │
process.env.DIST = path.join(__dirname, '../dist')
process.env.VITE_PUBLIC = app.isPackaged ? process.env.DIST : path.join(process.env.DIST, '../public')


// 🚧 Use ['ENV_NAME'] avoid vite:define plugin - Vite@2.x
const VITE_DEV_SERVER_URL = process.env['VITE_DEV_SERVER_URL']

const missingPermissions = async () => {
  const screenStatus = await systemPreferences.getMediaAccessStatus('screen')
  const cameraStatus = await systemPreferences.getMediaAccessStatus('camera')
  const microphoneStatus = await systemPreferences.getMediaAccessStatus('microphone')

  let missingList = [];
  if (cameraStatus != 'granted') missingList.push('camera');
  if (microphoneStatus != 'granted') missingList.push('microphone');
  if (screenStatus != 'granted') missingList.push('screen');

  return missingList;
}

const requestPermissions = async (permission: string): Promise<boolean> => {
  try {
    if (permission === 'camera' || permission === 'microphone') {
      const status = await systemPreferences.askForMediaAccess(permission);
      return status;
    } else if (permission === 'screen') {
      if (process.platform === 'darwin') {
        const screenAccessStatus = systemPreferences.getMediaAccessStatus('screen');
        if (screenAccessStatus !== 'granted') {
          dialog.showMessageBox({
            type: 'info',
            message: 'Please grant screen recording permissions in System Preferences.',
            buttons: ['Open System Preferences', 'Cancel']
          }).then(({ response }) => {
            if (response === 0) {
              // Open the Security & Privacy section of System Preferences
              shell.openExternal('x-apple.systempreferences:com.apple.preference.security?Privacy_ScreenCapture');
            }
          });
        } else {
          // already granted
          return true;
        }
      } else {
        // return true if other than macOS for screen
        return true;
      }
    }
    return false;
  } catch (error) {
    console.log(error)
    return false;
  }

}

function createFloatingWindow() {
  const floatingWindow = new BrowserWindow({
    width: 60,
    height: 150,
    x: 0,
    y: 0,
    resizable: false,
    movable: true,
    alwaysOnTop: true,
    frame: false, // This makes the window frameless
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
    },
  });

  if (VITE_DEV_SERVER_URL) {
    // floatingWindow.loadURL(`${VITE_DEV_SERVER_URL}?window=floating`);
    floatingWindow.loadURL(`${VITE_DEV_SERVER_URL}`).then(() => {
      // Once the file is loaded, send a message to the renderer with the parameter
      if (!floatingWindow) return console.log('No floating window to send set-window to');
      floatingWindow?.webContents.send('set-window', 'floating');
    });

  } else {
    // floatingWindow.loadFile(path.join(process.env.DIST, 'index.html?window=floating')).then(() => {
    floatingWindow.loadFile(path.join(process.env.DIST, 'index.html')).then(() => {
      // Once the file is loaded, send a message to the renderer with the parameter
      if (!floatingWindow) return console.log('No floating window to send set-window to');
      floatingWindow?.webContents.send('set-window', 'floating');
    });
  }
  return floatingWindow;
}


const createWebcamWindow = () => {
  const webcamWindow = new BrowserWindow({
    width: 200,
    height: 150,
    x: 1920 - 200,
    y: 1080,
    resizable: false,
    movable: true,
    // alwaysOnTop: true,
    frame: false, // This makes the window frameless
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
    },
  });

  if (VITE_DEV_SERVER_URL) {
    // webcamWindow.loadURL(`${VITE_DEV_SERVER_URL}?window=webcam`);
    webcamWindow.loadURL(`${VITE_DEV_SERVER_URL}`).then(() => {
      // Once the file is loaded, send a message to the renderer with the parameter
      if (!webcamWindow) return console.log('No webcam window to send set-window to');
      webcamWindow?.webContents.send('set-window', 'webcam');
    });

  } else {
    // webcamWindow.loadFile(path.join(process.env.DIST, 'index.html?window=webcam'));
    webcamWindow.loadFile(path.join(process.env.DIST, 'index.html')).then(() => {
      // Once the file is loaded, send a message to the renderer with the parameter
      if (!webcamWindow) return console.log('No webcam window to send set-window to');
      webcamWindow?.webContents.send('set-window', 'webcam');
    });
  }
  return webcamWindow;
}

function createWindow() {
  // assign the deep link url to a variable (screenlinkDesktop://xxx)
  app.setAsDefaultProtocolClient('screenlinkDesktop');

  const applicationIconPath = path.join(process.env.VITE_PUBLIC, 'apple.icns');
  let applicationIcon = nativeImage.createFromPath(applicationIconPath);
  applicationIcon = applicationIcon.resize({
    height: 16,
    width: 16
  });

  mainWindow = new BrowserWindow({
    icon: applicationIconPath,
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
    },
  })

  // Test active push message to Renderer-process.
  mainWindow.webContents.on('did-finish-load', () => {
    mainWindow?.webContents.send('main-process-message', (new Date).toLocaleString())
  })


  // Create the floating window and hide it
  floatingWindow = createFloatingWindow();
  floatingWindow.hide();

  // Create the webcam window and hide it
  webcamWindow = createWebcamWindow();
  webcamWindow.hide();

  if (VITE_DEV_SERVER_URL) {
    // mainWindow.loadURL(`${VITE_DEV_SERVER_URL}?window=main`);
    mainWindow.loadURL(`${VITE_DEV_SERVER_URL}`).then(async () => {
      const permissionsMissing = await missingPermissions();
      if (permissionsMissing.length > 0) {
        mainWindow?.webContents.send('set-window', 'permissions');
        console.log({ permissionsMissing })
        permissionsMissing.forEach(async (permission: string) => {
          const wasApproved = await requestPermissions(permission);
          if (wasApproved) permissionsMissing.splice(permissionsMissing.indexOf(permission), 1);
        });

      } else {
        // Once the file is loaded, send a message to the renderer with the parameter
        if (!mainWindow) return console.log('No main window to send set-window to');
        mainWindow?.webContents.send('set-window', 'main');
      }
    })
      .catch(e => console.error('Failed to load index.html', e));
  } else {
    // mainWindow.loadFile(path.join(process.env.DIST, 'index.html?window=main'));
    // Load the file directly without URL parameters
    mainWindow.loadFile(path.join(process.env.DIST, 'index.html'))
      .then(async () => {
        const permissionsMissing = await missingPermissions();
        if (permissionsMissing.length > 0) {
          mainWindow?.webContents.send('set-window', 'permissions');
          console.log({ permissionsMissing })
          permissionsMissing.forEach(async (permission: string) => {
            const wasApproved = await requestPermissions(permission);
            if (wasApproved) permissionsMissing.splice(permissionsMissing.indexOf(permission), 1);
          });

        } else {
          // Once the file is loaded, send a message to the renderer with the parameter
          if (!mainWindow) return console.log('No main window to send set-window to');
          mainWindow?.webContents.send('set-window', 'main');
        }
      })
      .catch(e => console.error('Failed to load index.html', e));
  }


  const iconPath = path.join(process.env.VITE_PUBLIC, 'tray-icon.png');
  let icon = nativeImage.createFromPath(iconPath);
  icon = icon.resize({
    height: 16,
    width: 16
  });
  tray = new Tray(icon);

  const contextMenu = Menu.buildFromTemplate([
    { label: 'Item1', type: 'radio' },
    { label: 'Item2', type: 'radio' },
    { label: 'Item3', type: 'radio', checked: true },
    { label: 'Item4', type: 'radio' }
  ])
  tray.setToolTip('This is my application.')
  tray.setContextMenu(contextMenu)
  console.log(tray)

  // Read the device code from the file (deviceCodeFilePath)
  // and send it to the renderer process
  readFilePromise(deviceCodeFilePath).then((deviceCodeBuffer) => {
    const deviceCode = deviceCodeBuffer.toString();
    console.log('Device code on ready: ', deviceCode);
    if (mainWindow) {
      mainWindow.webContents.send('device-code', deviceCode);
    } else {
      console.log('No window to send device code to');
    }
  });

}

// Quit when all windows are closed, except on macOS. There, it's common
// for applications and their menu bar to stay active until the user quits
// explicitly with Cmd + Q.
app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') {
    app.quit()
    mainWindow = null
  }
})


app.on('activate', () => {
  // On OS X it's common to re-create a window in the app when the
  // dock icon is clicked and there are no other windows open.
  if (BrowserWindow.getAllWindows().length === 0) {
    createWindow()
  }
})

// This event will be emitted when your app is opened with a URL that uses your protocol
app.on('open-url', (event, url) => {
  // Prevent the default behavior
  event.preventDefault();

  // Parse the URL
  const parsedUrl = new URL(url);
  // deviceCode is in host (    host: 'deviceCode=8cda48126269f9bbc55bef2c7cf0300e8f1cbfe5',)
  const deviceCode = parsedUrl.host.split('=')[1];
  // Log the device code
  console.log(`Device code: ${deviceCode}`);
  // Send the device code to the renderer process
  // ipcMain.emit('device-code', deviceCode);

  // Write the device code to a file in the sessionData directory
  writeFilePromise(deviceCodeFilePath, deviceCode).then(() => {
    console.log('Device code saved successfully!');
  });


  // Send the device code to the renderer process
  if (mainWindow) {
    mainWindow.webContents.send('device-code', deviceCode);
  }
});

app.whenReady().then(createWindow)
