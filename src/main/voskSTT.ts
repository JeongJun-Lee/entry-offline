import { app } from 'electron';
import path from 'path';
import http from 'http';
import socketIo from 'socket.io';
import createLogger from './utils/functions/createLogger';

const log = createLogger('main/voskSTT.ts');
let vosk: any = null;

export function startVoskServer() {
    try {
        vosk = require('vosk');
    } catch (e) {
        log.error(`Vosk module not available: ${e}`);
        return;
    }

    const PORT = 4002;
    const server = http.createServer((req, res) => {
        if (req.url === '/health') {
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
    let modelLoaded = false;

    try {
        let modelPath = path.resolve(app.getAppPath(), 'src', 'renderer', 'resources', 'vosk-model-uz');
        if (modelPath.includes('app.asar')) {
            modelPath = modelPath.replace('app.asar', 'app.asar.unpacked');
        }

        vosk.setLogLevel(-1);
        model = new vosk.Model(modelPath);
        modelLoaded = true;
        log.info(`Vosk model loaded successfully from ${modelPath}`);
    } catch (err) {
        log.error(`Failed to load Vosk model: ${err}`);
    }

    io.on('connection', (socket: any) => {
        log.info(`Client connected to local Vosk STT Server. Socket ID: ${socket.id}`);
        socket.send('CONNECTED');

        let rec: any = null;
        let timeout: any = null;

        if (modelLoaded) {
            try {
                rec = new vosk.Recognizer({ model: model, sampleRate: 16000 });
                log.info(`Vosk Recognizer initialized for socket ${socket.id}`);
            } catch (e) {
                log.error(`Failed to initialize Vosk Recognizer: ${e}`);
            }
        } else {
            log.error('Cannot initialize Recognizer: Model not loaded');
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

    server.listen(PORT, '127.0.0.1', () => {
        log.info(`Vosk local Socket.IO server running on port ${PORT}`);
    });
}
