import { app } from 'electron';
import path from 'path';
import http from 'http';
import socketIo from 'socket.io';
import createLogger from './utils/functions/createLogger';

const log = createLogger('main/voskSTT.ts');
let vosk: any = null;
let isStarted = false;

export async function startVoskServer(): Promise<boolean> {
    if (isStarted) {
        log.info('[voskSTT] Server already started');
        return true;
    }

    try {
        const isWindows = process.platform === 'win32';
        const isMac = process.platform === 'darwin';
        const arch = process.arch;

        let voskDir = path.join(app.getAppPath(), 'node_modules', 'vosk');
        if (voskDir.includes('app.asar') && !voskDir.includes('app.asar.unpacked')) {
            voskDir = voskDir.replace('app.asar', 'app.asar.unpacked');
        }

        let voskLibDir = '';
        if (isWindows) {
            // Note: prepare-native.js injects 32-bit DLLs into this folder during ia32 builds.
            voskLibDir = path.join(voskDir, 'lib', 'win-x86_64');
        } else if (isMac) {
            voskLibDir = path.join(voskDir, 'lib', 'osx-universal');
        }

        if (voskLibDir && voskLibDir.includes('app.asar') && !voskLibDir.includes('app.asar.unpacked')) {
            voskLibDir = voskLibDir.replace('app.asar', 'app.asar.unpacked');
        }

        if (isWindows && voskLibDir) {
            if (require('fs').existsSync(voskLibDir)) {
                log.info(`[voskSTT] Adding library directory to PATH: ${voskLibDir}`);
                process.env.PATH = `${voskLibDir}${path.delimiter}${process.env.PATH}`;
            }
        }

        // Electron + ASAR + ffi-napi workaround:
        // ffi-napi cannot load DLLs from inside ASAR. We must point it to the unpacked path.
        const ffi = require('ffi-napi');
        const originalLibrary = ffi.Library;
        ffi.Library = function (libPath: string, ...args: any[]) {
            if (typeof libPath === 'string') {
                const basename = path.basename(libPath).toLowerCase();
                // Redirect Vosk library loads to our verified architecture-specific path
                if (voskLibDir && (basename === 'libvosk.dll' || basename === 'libvosk.dylib')) {
                    const redirectedPath = path.join(voskLibDir, basename);
                    if (require('fs').existsSync(redirectedPath)) {
                        log.info(`[voskSTT] Redirecting ffi.Library Vosk load: ${libPath} -> ${redirectedPath}`);
                        libPath = redirectedPath;
                    }
                }

                // General ASAR -> unpacked redirection
                if (libPath.includes('app.asar') && !libPath.includes('app.asar.unpacked')) {
                    const unpackedPath = libPath.replace('app.asar', 'app.asar.unpacked');
                    if (require('fs').existsSync(unpackedPath)) {
                        log.info(`[voskSTT] Redirecting ffi.Library ASAR load: ${libPath} -> ${unpackedPath}`);
                        libPath = unpackedPath;
                    }
                }
            }
            return originalLibrary.apply(this, [libPath, ...args]);
        };

        vosk = require('vosk');
    } catch (e: any) {
        log.error(`[voskSTT] Vosk module require failed! Name: ${e.name}, Message: ${e.message}`);
        log.error(`[voskSTT] Vosk module require stack: ${e.stack}`);
        return false;
    }

    const PORT = 4002;
    const server = http.createServer((req, res) => {
        if (req.url === '/health') {
            log.info('[voskSTT] Health check received');
            res.writeHead(200, { 'Content-Type': 'text/plain', 'Access-Control-Allow-Origin': '*' });
            res.end('OK');
            return;
        }
        res.writeHead(404);
        res.end();
    });
    const io = socketIo(server, {
        path: '/vc',
        origins: '*:*', // Allow all origins for local STT
        transports: ['websocket', 'polling']
    });

    let model: any = null;
    let modelLoadingPromise: Promise<any> | null = null;

    async function ensureModelLoaded(socket?: any) {
        if (model) {
            return model;
        }
        if (modelLoadingPromise) {
            if (socket) {
                socket.emit('message', 'MODEL_LOADING');
            }
            return modelLoadingPromise;
        }

        modelLoadingPromise = new Promise((resolve) => {
            let modelPath = path.resolve(app.getAppPath(), 'src', 'renderer', 'resources', 'vosk-model-uz');
            if (modelPath.includes('app.asar')) {
                modelPath = modelPath.replace('app.asar', 'app.asar.unpacked');
            }

            log.info(`[voskSTT] Starting to load Vosk model from ${modelPath}...`);
            if (socket) {
                socket.emit('message', 'MODEL_LOADING');
            }

            // Small delay to allow message to actually be emitted/sent before blocking the main thread
            setTimeout(() => {
                try {
                    vosk.setLogLevel(-1);
                    // Heavy synchronous call - will still block main thread but ONLY when first needed
                    model = new vosk.Model(modelPath);
                    log.info(`[voskSTT] Vosk model loaded successfully!`);
                    if (socket) {
                        socket.emit('message', 'MODEL_LOADED');
                    }
                    resolve(model);
                } catch (err) {
                    log.error(`[voskSTT] Failed to load Vosk model: ${err}`);
                    modelLoadingPromise = null;
                    resolve(null);
                }
            }, 100);
        });

        return modelLoadingPromise;
    }

    io.on('connection', async (socket: any) => {
        log.info(`Client connected to local Vosk STT Server. Socket ID: ${socket.id}`);
        socket.send('CONNECTED');

        let rec: any = null;
        let timeout: any = null;

        const loadedModel = await ensureModelLoaded(socket);
        if (loadedModel) {
            try {
                rec = new vosk.Recognizer({ model: loadedModel, sampleRate: 16000 });
                log.info(`Vosk Recognizer initialized for socket ${socket.id}`);
            } catch (e) {
                log.error(`Failed to initialize Vosk Recognizer: ${e}`);
            }
        } else {
            log.error('Cannot initialize Recognizer: Model failed to load');
            socket.send('NOT_RECOGNIZED');
        }

        let resultSent = false;
        const flushResult = () => {
            if (!rec || resultSent) return;
            try {
                const result = rec.finalResult();
                const text = result?.text?.trim();

                log.info(`Vosk flushResult (final) for ${socket.id}: "${text}"`);
                if (text && text.length > 0) {
                    log.info(`[voskSTT] Sending final result to client: ${text}`);
                    socket.emit('message', JSON.stringify([text]));
                    resultSent = true;
                } else {
                    log.info(`[voskSTT] No result detected, sending NOT_RECOGNIZED`);
                    socket.emit('message', 'NOT_RECOGNIZED');
                    resultSent = true;
                }
            } catch (e) {
                log.error(`Vosk finalResult error: ${e}`);
                socket.emit('message', 'NOT_RECOGNIZED');
                resultSent = true;
            }
        };

        socket.on('message', (data: any) => {
            if (!rec || resultSent) {
                return;
            }

            try {
                const pcmBuffer = Buffer.from(data);
                if (pcmBuffer.length > 0) {
                    if (rec.acceptWaveform(pcmBuffer)) {
                        const result = rec.result();
                        const text = result?.text?.trim();
                        if (text && text.length > 0) {
                            log.info(`[voskSTT] Sending detected phrase to client: ${text}`);
                            socket.emit('message', JSON.stringify([text]));
                            resultSent = true;
                        }
                    }
                }

                if (timeout) clearTimeout(timeout);
                timeout = setTimeout(flushResult, 1500);
            } catch (e) {
                log.error(`Vosk processing error: ${e}`);
            }
        });

        socket.on('disconnect', (reason: string) => {
            log.info(`Client disconnected from local Vosk STT Server. Socket: ${socket.id}, Reason: ${reason}`);
            if (timeout) clearTimeout(timeout);
            if (rec) {
                rec.free();
                rec = null;
                log.info(`Vosk Recognizer freed for socket ${socket.id}`);
            }
        });
    });

    server.on('error', (err) => {
        log.error(`[voskSTT] Server error: ${err}`);
    });

    return new Promise((resolve) => {
        server.listen(PORT, '127.0.0.1', () => {
            log.info(`[voskSTT] Vosk local Socket.IO server running on port ${PORT}`);
            isStarted = true;
            resolve(true);
        }).on('error', (err) => {
            log.error(`[voskSTT] Failed to bind local server port: ${err}`);
            resolve(false);
        });
    });
}
