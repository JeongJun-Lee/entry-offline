import { createLogger, format, transports } from 'winston';
import DailyRotateFile from 'winston-daily-rotate-file';
import path from 'path';

const { combine, timestamp, printf } = format;

const logger = createLogger({
    level: 'verbose',
    format: combine(
        timestamp({ format: 'YYYY-MM-DD HH:mm:ss' }),
        printf(({ level, message, label, timestamp }) => `[${label}][${level}][${timestamp}]: ${message}`),
    ),
    transports: [
        new transports.Console(),
    ],
    exitOnError: false,
});

let isTransportAdded = false;
const ensureTransport = () => {
    if (process.env.NODE_ENV === 'production' && !isTransportAdded) {
        try {
            const { app } = require('electron');
            if (app && typeof app.getPath === 'function') {
                const _logPath = path.join(app.getPath('appData'), 'Entry', 'logs');
                logger.add(new DailyRotateFile({
                    level: 'info',
                    filename: 'entry-offline-%DATE%.log',
                    dirname: _logPath,
                    datePattern: 'YYYY-MM-DD',
                    zippedArchive: true,
                    maxSize: '10m',
                    maxFiles: '14d',
                    json: false,
                    formatter: ({ level, message, label, timestamp }: any) =>
                        `[${label}][${level}][${timestamp}]: ${message}`,
                }));
                isTransportAdded = true;
            }
        } catch (e) {
            console.error('Failed to add file transport to logger:', e);
        }
    }
};

export const logPath = null;
export default (labelName: string) => {
    ensureTransport();
    return logger.child({ label: labelName });
};
