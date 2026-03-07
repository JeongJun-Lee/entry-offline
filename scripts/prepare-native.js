const { execSync } = require('child_process');
const fs = require('fs');
const path = require('path');

const arch = process.argv[2];
if (!['ia32', 'x64', 'arm64'].includes(arch)) {
    console.error('Usage: node prepare-native.js [ia32|x64|arm64]');
    process.exit(1);
}

const ROOT = path.resolve(__dirname, '..');
const isWindows = process.platform === 'win32';
const isMac = process.platform === 'darwin';

console.log(`[prepare-native] Targeting architecture: ${arch} on ${process.platform}`);

function getArch(filePath) {
    try {
        if (!fs.existsSync(filePath)) return 'MISSING';
        const buffer = Buffer.alloc(4096);
        const fd = fs.openSync(filePath, 'r');
        fs.readSync(fd, buffer, 0, 4096, 0);
        fs.closeSync(fd);

        if (isWindows) {
            const peOffset = buffer.readUInt32LE(0x3c);
            if (buffer.readUInt32BE(peOffset) !== 0x50450000) return 'NOT_PE';
            const machine = buffer.readUInt16LE(peOffset + 4);
            if (machine === 0x014c) return 'ia32';
            if (machine === 0x8664) return 'x64';
            return `0x${machine.toString(16)}`;
        } else if (isMac) {
            const magic = buffer.readUInt32BE(0);
            if (magic === 0xcafebabe || magic === 0xbebafeca) return 'universal';
            if (magic === 0xcfeedfac || magic === 0xcfaedfe) return 'x64';
            if (magic === 0xfeedfacf || magic === 0xfeedface) return 'arm64';
            return 'NOT_MACHO';
        }
        return 'UNKNOWN_PLATFORM';
    } catch (e) { return 'ERR'; }
}

// 1. Check current Vosk DLL and backup if it's x64 (Windows Only)
if (isWindows) {
    const VOSK_DLL_PATH = path.join(ROOT, 'node_modules', 'vosk', 'lib', 'win-x86_64', 'libvosk.dll');
    const BACKUP_DLL_PATH = path.join(ROOT, 'node_modules', 'vosk', 'lib', 'win-x86_64', 'libvosk.dll.bak');
    if (fs.existsSync(VOSK_DLL_PATH)) {
        const currentArch = getArch(VOSK_DLL_PATH);
        console.log(`[prepare-native] Current Vosk DLL arch: ${currentArch}`);
        if (currentArch === 'x64' && !fs.existsSync(BACKUP_DLL_PATH)) {
            console.log('[prepare-native] Backing up x64 Vosk DLL...');
            fs.copyFileSync(VOSK_DLL_PATH, BACKUP_DLL_PATH);
        }
    }
}

// 2. Rebuild native modules
console.log(`[prepare-native] Rebuilding native modules for ${arch}...`);
try {
    const nativeModules = ['ref-napi', 'ffi-napi', 'node-hid', '@serialport/bindings'];
    nativeModules.forEach(mod => {
        const modPath = path.join(ROOT, 'node_modules', mod);
        const buildPath = path.join(modPath, 'build');
        
        if (fs.existsSync(modPath)) {
            // Permission Check
            try {
                fs.accessSync(modPath, fs.constants.W_OK);
            } catch (e) {
                console.error(`[prepare-native] CRITICAL PERMISSION ERROR: Cannot write to ${modPath}`);
                console.error(`[prepare-native] Please run: sudo chown -R $(whoami) ${path.join(ROOT, 'node_modules')}`);
                process.exit(1);
            }

            if (fs.existsSync(buildPath)) {
                console.log(`[prepare-native] Removing old build folder for ${mod}...`);
                fs.rmSync(buildPath, { recursive: true, force: true });
            }
        }
    });

    nativeModules.forEach(mod => {
        if (!fs.existsSync(path.join(ROOT, 'node_modules', mod))) return;
        
        const rebuildCmd = `npx electron-rebuild -f -a ${arch} -v 18.3.0 -m node_modules/${mod}`;
        console.log(`[prepare-native] Running: ${rebuildCmd}`);
        execSync(rebuildCmd, {
            stdio: 'inherit',
            cwd: ROOT,
            env: { ...process.env, npm_config_arch: arch }
        });

        // Verification
        const binaryPaths = [
            path.join(ROOT, 'node_modules', mod, 'build', 'Release', 'binding.node'),
            path.join(ROOT, 'node_modules', mod, 'build', 'Release', 'bindings.node'),
            path.join(ROOT, 'node_modules', mod, 'build', 'Release', 'ffi_bindings.node'),
            path.join(ROOT, 'node_modules', mod, 'build', 'Release', 'HID.node'),
        ];
        const found = binaryPaths.some(p => fs.existsSync(p));
        if (!found) {
            console.warn(`[prepare-native] WARN: No binary found in build/Release for ${mod} after rebuild!`);
        } else {
            console.log(`[prepare-native] Verified binary for ${mod}`);
        }
    });
} catch (e) {
    console.error('[prepare-native] Native rebuild failed!');
    console.error(e.message);
    process.exit(1);
}

// 3. Inject correct DLLs (Windows only)
if (isWindows) {
    const VOSK_DLL_PATH = path.join(ROOT, 'node_modules', 'vosk', 'lib', 'win-x86_64', 'libvosk.dll');
    if (arch === 'ia32') {
        const sourceDir = path.join(ROOT, 'src', 'main', 'bins', 'ia32');
        if (fs.existsSync(sourceDir)) {
            console.log(`[prepare-native] Injecting 32-bit DLLs from ${sourceDir}`);
            const files = fs.readdirSync(sourceDir);
            files.forEach(file => {
                if (file.toLowerCase().endsWith('.dll')) {
                    const src = path.join(sourceDir, file);
                    const dest = path.join(path.dirname(VOSK_DLL_PATH), file);
                    const srcArch = getArch(src);

                    if (srcArch !== 'ia32') {
                        console.warn(`[prepare-native] SKIPPING ${file} - not ia32 (found ${srcArch})`);
                        return;
                    }

                    // Backup original if it's x64 and we haven't yet
                    const bak = dest + '.bak';
                    if (fs.existsSync(dest) && !fs.existsSync(bak)) {
                        const destArch = getArch(dest);
                        if (destArch === 'x64') {
                            console.log(`[prepare-native] Backing up original x64 ${file}...`);
                            fs.copyFileSync(dest, bak);
                        }
                    }

                    console.log(`[prepare-native] Injecting ${file} (ia32)...`);
                    fs.copyFileSync(src, dest);
                }
            });
        } else {
            console.warn('[prepare-native] WARN: 32-bit source folder not found');
        }
    } else {
        // x64: Restore from backup AND CLEANUP POLLUTION
        const targetDir = path.dirname(VOSK_DLL_PATH);
        if (fs.existsSync(targetDir)) {
            const files = fs.readdirSync(targetDir);

            // 1. Delete all ia32 DLLs and their backups
            files.forEach(file => {
                const fullPath = path.join(targetDir, file);
                if (file.toLowerCase().endsWith('.dll') || file.toLowerCase().endsWith('.dll.bak')) {
                    const currentArch = getArch(fullPath);
                    if (currentArch === 'ia32') {
                        console.log(`[prepare-native] Cleaning up ia32 file: ${file}`);
                        fs.unlinkSync(fullPath);
                    }
                }
            });

            // 2. Restore from backup (should only be x64 ones now)
            const remainingFiles = fs.readdirSync(targetDir);
            remainingFiles.forEach(file => {
                if (file.endsWith('.bak')) {
                    const bak = path.join(targetDir, file);
                    const dest = bak.slice(0, -4);
                    const bakArch = getArch(bak);

                    if (bakArch === 'x64') {
                        console.log(`[prepare-native] Restoring ${path.basename(dest)} from x64 backup...`);
                        fs.copyFileSync(bak, dest);
                    } else {
                        console.warn(`[prepare-native] SKIPPING restore of ${path.basename(dest)} - backup is NOT x64 (${bakArch})`);
                    }
                }
            });
        }
    }
} else {
    console.log(`[prepare-native] Skipping Windows-specific DLL injection on ${process.platform}`);
}

console.log('[prepare-native] Done!');
