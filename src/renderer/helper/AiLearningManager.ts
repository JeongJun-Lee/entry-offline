import IpcRendererHelper from './ipcRendererHelper';

export default class AiLearningManager {
    static lastModelData: any;
    static dispatchHooked = false;

    static openModelSelectionWindow() {
        let lang = 'ko';
        try {
            const rawPersist = localStorage.getItem('persist:storage');
            if (rawPersist) {
                lang = JSON.parse(JSON.parse(rawPersist).persist).lang || 'ko';
            }
        } catch (e) { }

        (window as any).ipcInvoke('openAiLearningTrainWindow', lang);
    }

    static popupListenerRegistered = false;

    static lang = 'ko';
    static _getLang(key: string, fallback: string) {
        const Lang = (window as any).Lang;
        return Lang?.AiLearning?.[key] || fallback;
    }
    static init() {
        if (typeof window !== 'undefined') {
            window.addEventListener('message', async (event) => {
                if (event.data && event.data.type === 'trainComplete') {
                    const entry = (window as any).Entry;
                    if (entry?.aiLearning) {
                        await AiLearningManager.handleTrainComplete(event.data.modelData);
                    }
                }
            });

            if ((window as any).ipcListen) {
                (window as any).ipcListen('trainComplete-result', async (event: any, modelData: any) => {
                    const entry = (window as any).Entry;
                    if (entry?.aiLearning) {
                        await AiLearningManager.handleTrainComplete(modelData);
                    }
                });

                // Speech input popup result — registered once here to prevent listener accumulation
                (window as any).ipcListen('speechInputResult', async (_event: any, specData: any) => {
                    if (AiLearningManager._pendingSpeechCallback) {
                        await AiLearningManager._pendingSpeechCallback(specData);
                    }
                });
                (window as any).ipcListen('speechInputClose', () => {
                    if (AiLearningManager._pendingSpeechCallback) {
                        AiLearningManager._pendingSpeechCallback = null;
                        const entry = (window as any).Entry;
                        if (entry?.aiLearning) entry.aiLearning.isLoading = false;
                    }
                });
            }

            this.hookDispatchEvent();
            this.patchSvm();
            if (!this.dispatchHooked) {
                const retryInterval = setInterval(() => {
                    this.hookDispatchEvent();
                    this.patchSvm();
                    if (this.dispatchHooked) clearInterval(retryInterval);
                }, 1000);
                setTimeout(() => clearInterval(retryInterval), 60000);
            }
        }
    }

    static patchSvm() {
        const entry = (window as any).Entry;
        if (!entry?.aiLearning || (entry.aiLearning as any).__svmPatched) return;

        const originalTrain = entry.aiLearning.train;
        if (typeof originalTrain !== 'function') return;

        console.log('[AiLearningManager] Patching Entry.aiLearning.train for SVM defaults...');
        entry.aiLearning.train = async function(...args: any[]) {
            const module = this._module;
            if (module && module.type === 'svm') {
                console.log('[AiLearningManager] Injecting SVM defaults before training:', module.trainParam);
                module.trainParam = {
                    kernel: 'linear',
                    C: 1,
                    degree: 3,
                    gamma: 1,
                    ...module.trainParam,
                };
            }
            return await originalTrain.apply(this, args);
        };

        const originalPredict = entry.aiLearning.predict;
        if (typeof originalPredict === 'function') {
            console.log('[AiLearningManager] Patching Entry.aiLearning.predict for SVM scaling...');
            entry.aiLearning.predict = async function(obj: any) {
                const module = this._module;
                if (module && module.type === 'svm' && module.result?.scaling) {
                    const scaling = module.result.scaling;
                    if (Array.isArray(obj)) {
                        const scaled = obj.map((val, i) => {
                            if (scaling[i]) {
                                const { min, max } = scaling[i];
                                const diff = max - min;
                                return diff === 0 ? 0 : (parseFloat(val) - min) / diff;
                            }
                            return val;
                        });
                        return await originalPredict.call(this, scaled);
                    }
                }
                return await originalPredict.call(this, obj);
            };
        }
        (entry.aiLearning as any).__svmPatched = true;
    }

    static async handleTrainComplete(modelData: any) {
        console.log('[AiLearningManager] handleTrainComplete received modelData:', modelData);
        const entry = (window as any).Entry;
        try {
            this.lastModelData = modelData;
            if (entry?.aiLearning) {
                console.log('[AiLearningManager] Calling entry.aiLearning.load(modelData)...');
                await entry.aiLearning.load(modelData);
                
                // Post-load fix for Offline environment
                const module = entry.aiLearning._module;
                if (module && modelData.type === 'svm') {
                    console.log('[AiLearningManager] SVM post-load fix. module:', module);
                    if (typeof modelData.model === 'string') {
                        const libsvm = (window as any).libsvm;
                        console.log('[AiLearningManager] libsvm available:', !!libsvm, 'svm.model trained:', !!module.model);
                        
                        // If the bundled entry-js load() failed to restore the model, we do it manually.
                        if (libsvm && !module.model) {
                            try {
                                console.log('[AiLearningManager] Manually restoring SVM model...');
                                module.model = libsvm.load(modelData.model);
                                module.trained = true;
                                module.valueMap = modelData.result?.valueMap || modelData.valueMap;
                                module.attrValueMaps = modelData.result?.attrValueMaps || modelData.attrValueMaps || {};
                                if (typeof module.updateFields === 'function') {
                                    module.updateFields();
                                }
                                console.log('[AiLearningManager] SVM model restoration success');
                            } catch (e) {
                                console.error('[AiLearningManager] SVM model restoration failed:', e);
                            }
                        }
                    }
                }

                // Post-load fix for Regression: ensure result and attrValueMaps are set on module
                if (module && modelData.type === 'regression') {
                    console.log('[AiLearningManager] Regression post-load fix. module:', module);
                    try {
                        if (modelData.result && !module.result?.graphData) {
                            module.result = modelData.result;
                        }
                        if (!module.attrValueMaps || Object.keys(module.attrValueMaps).length === 0) {
                            module.attrValueMaps = modelData.result?.attrValueMaps || modelData.attrValueMaps || {};
                        }
                        if (typeof module.updateFields === 'function') {
                            module.updateFields();
                        }
                        console.log('[AiLearningManager] Regression post-load fix done. rsquared:', module.result?.rsquared);
                    } catch (e) {
                        console.error('[AiLearningManager] Regression post-load fix failed:', e);
                    }
                }
            }
            this.hookDispatchEvent();

            const refreshUI = () => {
                const bm = entry.playground?.blockMenu || (entry.getMainWS && entry.getMainWS()?.blockMenu);
                if (!bm) {
                    return;
                }
                const runUnban = () => {
                    bm.unbanCategory('ai_utilize');
                    if (entry.aiLearning?.unbanBlocks) {
                        entry.aiLearning.unbanBlocks(bm);
                    }
                    try {
                        entry.playground?.reloadPlayground();
                        bm.align();
                        bm.selectMenu('ai_utilize', true, true);
                    } catch (err) { }
                };
                [0, 500, 1500, 3000].forEach((delay) => setTimeout(runUnban, delay));
            };
            setTimeout(refreshUI, 100);
        } catch (err) {
            console.error('[AiLearningManager] handleTrainComplete error:', err);
        }
    }


    static async loadTfScripts() {
        if ((window as any).tf) return;
        return new Promise<void>((resolve, reject) => {
            const tfScript = document.createElement('script');
            tfScript.src = '../../renderer/resources/lib/tensorflow/tf.min.js';
            tfScript.onload = () => resolve();
            tfScript.onerror = () => reject('tf load failed');
            document.head.appendChild(tfScript);
        });
    }

    static async loadSpeechScripts() {
        await this.loadTfScripts();
        if ((window as any).speechCommands) return;
        return new Promise<void>((resolve, reject) => {
            const scScript = document.createElement('script');
            scScript.src = '../../renderer/resources/lib/tensorflow/speech-commands.min.js';
            scScript.onload = () => resolve();
            scScript.onerror = () => reject('speech commands load failed');
            document.head.appendChild(scScript);
        });
    }

    static hookDispatchEvent() {
        if (this.dispatchHooked) return;
        const entry = (window as any).Entry;
        if (!entry || typeof entry.dispatchEvent !== 'function') return;

        const originalDispatch = entry.dispatchEvent.bind(entry);
        const self = this;
        entry.dispatchEvent = function(eventName: string, ...args: any[]) {
            if (eventName === 'openMLInputPopup') {
                self.showInputPopup(args[0]);
                return;
            }
            return originalDispatch(eventName, ...args);
        };
        this.dispatchHooked = true;
    }

    // Pending callbacks for the speech input popup window
    static _pendingSpeechCallback: ((specData: { data: number[]; frameSize: number }) => Promise<void>) | null = null;

    static async showInputPopup(data: any) {
        const { type } = data;
        const entry = (window as any).Entry;

        if (type !== 'image' && type !== 'text' && type !== 'speech') return;

        // ── Speech: open in a separate Electron window to avoid TF version conflict ──
        if (type === 'speech') {
            if (entry?.aiLearning) entry.aiLearning.isLoading = true;

            // Register a one-time callback (the listener is registered in init())
            this._pendingSpeechCallback = async (specData: { data: number[]; frameSize: number }) => {
                this._pendingSpeechCallback = null;
                try {
                    const floatData = new Float32Array(specData.data);
                    console.log(`[AiLearningManager] Invoking predict, frameSize=${specData.frameSize}, dataLength=${floatData.length}`);
                    const result = await data.predict({ data: floatData, frameSize: specData.frameSize });
                    if (result) data.setResult(result);
                } catch (e) {
                    console.error('[AiLearningManager] speechInputResult handling failed:', e);
                } finally {
                    if (entry?.aiLearning) entry.aiLearning.isLoading = false;
                }
            };

            // Open the isolated speech popup window
            await (window as any).ipcInvoke('openAiLearningInputWindow', {
                recordTime: data.recordTime || 3000,
                labels: data.labels || [],
            });
            return;
        }

        // ── Image / Text: existing in-process DOM popup ──
        if (entry?.aiLearning) entry.aiLearning.isLoading = true;

        const overlay = document.createElement('div');
        overlay.id = 'ml-input-popup-overlay';
        overlay.style.cssText = `
            position: fixed; top: 0; left: 0; width: 100%; height: 100%;
            background: rgba(0,0,0,0.5); z-index: 99999;
            display: flex; align-items: center; justify-content: center;
        `;

        const popup = document.createElement('div');
        popup.style.cssText = `
            background: white; border-radius: 12px; width: 480px; 
            box-shadow: 0 12px 40px rgba(0,0,0,0.3); overflow: hidden;
            box-sizing: border-box;
        `;

        overlay.appendChild(popup);
        document.body.appendChild(overlay);

        const cleanup = () => {
            if (overlay.parentElement) overlay.parentElement.removeChild(overlay);
            if (entry?.aiLearning) entry.aiLearning.isLoading = false;
        };

        const showResultUI = (result: any) => {
            const resultDiv = document.getElementById('ml-popup-result') as HTMLDivElement;
            const applyBtn = document.getElementById('ml-popup-apply') as HTMLButtonElement;
            if (!resultDiv) return;

            if (!result || !Array.isArray(result) || result.length === 0) {
                resultDiv.innerText = `${AiLearningManager._getLang('classification_result', '분류 결과: ')}${AiLearningManager._getLang('unknown', '알 수 없음')}`;
                resultDiv.style.display = 'block';
                return;
            }
            const top = result[0];
            const prob = (top.probability * 100).toFixed(1);
            resultDiv.innerHTML = `${AiLearningManager._getLang('classification_result', '분류 결과: ')}<strong>${top.className}</strong> (${prob}%)`;
            resultDiv.style.display = 'block';
            if (applyBtn) applyBtn.style.display = 'block';
        };

        if (type === 'image') {
            this.renderImagePopup(popup, data, cleanup, showResultUI);
        } else if (type === 'text') {
            this.renderTextPopup(popup, data, cleanup, showResultUI);
        }
    }


    static renderImagePopup(popup: HTMLElement, data: any, cleanup: () => void, showResultUI: (res: any) => void) {
        const { predict, setResult } = data;
        const entry = (window as any).Entry;

        popup.innerHTML = `
            <div style="background: #2b6df3; color: white; padding: 14px 20px; display: flex; justify-content: space-between; align-items: center; box-sizing: border-box;">
                <span style="font-weight: 700; font-size: 18px;">${AiLearningManager._getLang('data_input', '데이터 입력')}</span>
                <button id="ml-popup-close" style="background: none; border: none; color: white; font-size: 24px; cursor: pointer;">&times;</button>
            </div>
            <div style="padding: 24px; display: flex; flex-direction: column; gap: 20px; box-sizing: border-box;">
                <div id="ml-popup-main-content" style="display: flex; gap: 20px; align-items: stretch; width: 100%; box-sizing: border-box;">
                    <div id="ml-popup-left-col" style="flex: 1; min-width: 0; display: flex; flex-direction: column; gap: 20px; box-sizing: border-box;">
                        <div style="position: relative; width: 100%; box-sizing: border-box;">
                            <select id="ml-popup-mode" style="width: 100%; padding: 10px 14px; border: 2px solid #e9ecef; border-radius: 8px; font-size: 15px; appearance: none; background: white; cursor: pointer; font-weight: 700; box-sizing: border-box;">
                                <option value="upload">${AiLearningManager._getLang('mode_upload', '업로드')}</option>
                                <option value="webcam" selected>${AiLearningManager._getLang('mode_webcam', '촬영')}</option>
                            </select>
                        </div>
                        <div id="ml-popup-capture-area" style="display: block; width: 100%; box-sizing: border-box;">
                            <button id="ml-popup-capture" style="width: 100%; height: 80px; background: #5a87ff; color: white; border: none; border-radius: 12px; cursor: pointer; display: flex; align-items: center; justify-content: center; box-shadow: 0 4px 12px rgba(90, 135, 255, 0.3); box-sizing: border-box;">
                                <svg width="36" height="36" viewBox="0 0 24 24" fill="white"><path d="M12 17c2.206 0 4-1.794 4-4s-1.794-4-4-4-4 1.794-4 4 1.794 4 4 4zm0-6c1.103 0 2 .897 2 2s-.897 2-2 2-2-.897-2-2 .897-2 2-2z"/><path d="M20 5h-3.172l-1.414-1.414A1.989 1.989 0 0 0 14.004 3H9.997c-.544 0-1.045.211-1.414.586L7.17 5H4c-1.103 0-2 .897-2 2v11c0 1.103.897 2 2 2h16c1.103 0 2-.897 2-2V7c0-1.103-.897-2-2-2zm0 13H4V7h4.828l1.414-1.414A1.989 1.989 0 0 1 11.657 5h2.686c.545 0 1.045.211 1.414.586L17.172 7H20v11z"/></svg>
                            </button>
                        </div>
                    </div>
                    <div id="ml-popup-display-area" style="flex: 1.1; min-width: 0; box-sizing: border-box; position: relative;">
                        <div id="ml-popup-upload-box" style="display: none; align-items: center; justify-content: center; border: 2px dashed #dbdfed; border-radius: 12px; width: 100%; aspect-ratio: 1 / 1; cursor: pointer; background: #fbfcfe; box-sizing: border-box; position: relative; overflow: hidden; background-size: cover; background-position: center;">
                            <div id="ml-popup-upload-overlay" style="display: flex; flex-direction: column; align-items: center; justify-content: center; gap: 8px; z-index: 2; width: 100%; height: 100%; background: rgba(251,252,254,0.3); pointer-events: none;">
                                <svg width="40" height="40" fill="none" viewBox="0 0 24 24" stroke-width="2.5" stroke="currentColor"><path d="M12 4.5v15m7.5-7.5h-15"/></svg>
                                <span style="font-size: 15px; font-weight: 700;">${AiLearningManager._getLang('upload_box_text', '파일 업로드')}</span>
                            </div>
                            <input type="file" id="ml-popup-file" accept="image/*" style="display:none;">
                        </div>
                        <div id="ml-popup-webcam-box" style="display: block; position: relative; border-radius: 12px; overflow: hidden; background: #000; width: 100%; aspect-ratio: 1 / 1; box-sizing: border-box;">
                            <video id="ml-popup-video" playsinline autoplay muted style="width: 100%; height: 100%; object-fit: cover;"></video>
                            <div id="ml-popup-video-flip" style="position: absolute; right: 12px; bottom: 12px; background: rgba(255,255,255,0.95); border-radius: 10px; padding: 8px; cursor: pointer; display: flex; align-items: center; justify-content: center; z-index: 5; box-sizing: border-box;">
                                <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="#2b6df3" stroke-width="3" stroke-linecap="round" stroke-linejoin="round"><path d="M2.5 2v6h6M21.5 22v-6h-6"/><path d="M22 11.5A10 10 0 0 0 3.2 7.2M2 12.5a10 10 0 0 0 18.8 4.3"/></svg>
                            </div>
                        </div>
                        <img id="ml-popup-preview" style="display: none; width: 100%; aspect-ratio: 1 / 1; object-fit: cover; border-radius: 12px; border: 1px solid #dee2e6; box-sizing: border-box;">
                    </div>
                </div>
                <div id="ml-popup-result" style="display: none; padding: 14px; background: #eef2ff; border: 1px solid #d0d7f7; border-radius: 10px; font-size: 15px; font-weight: 700; color: #2b6df3; box-sizing: border-box; text-align: center;"></div>
                <canvas id="ml-popup-canvas" style="display: none;" width="224" height="224"></canvas>
                <button id="ml-popup-apply" style="display: none; width: 100%; padding: 16px; background: #4e7cfe; color: white; border: none; border-radius: 12px; font-size: 19px; cursor: pointer; font-weight: 800; box-sizing: border-box; box-shadow: 0 4px 14px rgba(78, 124, 254, 0.35);">${AiLearningManager._getLang('apply', '적용하기')}</button>
            </div>
        `;

        const modeSelect = document.getElementById('ml-popup-mode') as HTMLSelectElement;
        const uploadBox = document.getElementById('ml-popup-upload-box') as HTMLDivElement;
        const uploadOverlay = document.getElementById('ml-popup-upload-overlay') as HTMLDivElement;
        const webcamBox = document.getElementById('ml-popup-webcam-box') as HTMLDivElement;
        const captureArea = document.getElementById('ml-popup-capture-area') as HTMLDivElement;
        const fileInput = document.getElementById('ml-popup-file') as HTMLInputElement;
        const video = document.getElementById('ml-popup-video') as HTMLVideoElement;
        const captureBtn = document.getElementById('ml-popup-capture') as HTMLButtonElement;
        const preview = document.getElementById('ml-popup-preview') as HTMLImageElement;
        const canvas = document.getElementById('ml-popup-canvas') as HTMLCanvasElement;
        const applyBtn = document.getElementById('ml-popup-apply') as HTMLButtonElement;
        const closeBtn = document.getElementById('ml-popup-close') as HTMLButtonElement;
        let stream: MediaStream | null = null;

        const onClose = () => {
            if (stream) {
                stream.getTracks().forEach(t => t.stop());
                stream = null;
            }
            cleanup();
        };

        closeBtn.addEventListener('click', onClose);

        const videoFlipBtn = document.getElementById('ml-popup-video-flip') as HTMLDivElement;
        let isFlipped = false;
        video.style.transform = 'scaleX(1)';

        videoFlipBtn.addEventListener('click', () => {
            isFlipped = !isFlipped;
            video.style.transform = isFlipped ? 'scaleX(-1)' : 'scaleX(1)';
        });

        const initWebcam = async () => {
            uploadBox.style.display = 'none';
            webcamBox.style.display = 'block';
            captureArea.style.display = 'block';
            try {
                if (stream) { stream.getTracks().forEach(t => t.stop()); stream = null; }
                const devices = await navigator.mediaDevices.enumerateDevices();
                const videoDevices = devices.filter(d => d.kind === 'videoinput');
                const prioritized = videoDevices.find(d => 
                    d.label.toLowerCase().includes('facetime') || d.label.toLowerCase().includes('hd camera')
                );
                const constraints = { video: prioritized ? { deviceId: { exact: prioritized.deviceId } } : true };
                stream = await navigator.mediaDevices.getUserMedia(constraints);
                video.srcObject = stream;
            } catch (e) {
                try {
                    stream = await navigator.mediaDevices.getUserMedia({ video: true });
                    video.srcObject = stream;
                } catch (e2) { }
            }
        };
        
        if (modeSelect.value === 'webcam') initWebcam();

        modeSelect.addEventListener('change', async () => {
            const mode = modeSelect.value;
            preview.style.display = 'none';
            if (mode === 'upload') {
                uploadBox.style.display = 'flex';
                webcamBox.style.display = 'none';
                captureArea.style.display = 'none';
                if (stream) { stream.getTracks().forEach(t => t.stop()); stream = null; }
            } else {
                await initWebcam();
            }
        });

        uploadBox.addEventListener('click', () => fileInput.click());
        fileInput.addEventListener('change', async () => {
            const file = fileInput.files?.[0];
            if (!file) return;
            const reader = new FileReader();
            reader.onload = async (ev) => {
                const imgSrc = ev.target?.result as string;
                uploadBox.style.backgroundImage = `url(${imgSrc})`;
                uploadOverlay.style.background = 'rgba(255,255,255,0.4)';
                const img = new Image();
                img.onload = async () => {
                    const ctx = canvas.getContext('2d')!;
                    ctx.drawImage(img, 0, 0, 224, 224);
                    const result = await predict(canvas);
                    showResultUI(result);
                    setResult(result);
                };
                img.src = imgSrc;
            };
            reader.readAsDataURL(file);
        });

        captureBtn.addEventListener('click', async () => {
            const ctx = canvas.getContext('2d')!;
            if (isFlipped) {
                ctx.save(); ctx.scale(-1, 1); ctx.drawImage(video, -224, 0, 224, 224); ctx.restore();
            } else {
                ctx.drawImage(video, 0, 0, 224, 224);
            }
            preview.src = canvas.toDataURL('image/png');
            preview.style.display = 'block';
            webcamBox.style.display = 'none';
            const result = await predict(canvas);
            showResultUI(result);
            setResult(result);
        });

        applyBtn.addEventListener('click', onClose);
    }

    static renderTextPopup(popup: HTMLElement, data: any, cleanup: () => void, showResultUI: (res: any) => void) {
        const { predict, setResult } = data;

        popup.innerHTML = `
            <div style="background: #2b6df3; color: white; padding: 14px 20px; display: flex; justify-content: space-between; align-items: center;">
                <span style="font-weight: 700; font-size: 18px;">${AiLearningManager._getLang('data_input', '데이터 입력')}</span>
                <button id="ml-popup-close" style="background: none; border: none; color: white; font-size: 24px; cursor: pointer;">&times;</button>
            </div>
            <div style="padding: 24px; display: flex; flex-direction: column; gap: 20px;">
                <textarea id="ml-popup-text-input" style="width: 100%; height: 120px; padding: 12px; border: 2px solid #e9ecef; border-radius: 12px; font-size: 16px; resize: none; box-sizing: border-box;" 
                          placeholder="${AiLearningManager._getLang('text_input_placeholder', '분류할 텍스트를 입력하세요.')}"></textarea>
                <button id="ml-popup-predict-btn" style="width: 100%; padding: 14px; background: #5a87ff; color: white; border: none; border-radius: 12px; cursor: pointer; font-size: 16px; font-weight: 700;">${AiLearningManager._getLang('input', '입력하기')}</button>
                <div id="ml-popup-result" style="display: none; padding: 14px; background: #eef2ff; border: 1px solid #d0d7f7; border-radius: 10px; font-size: 15px; font-weight: 700; color: #2b6df3; text-align: center;"></div>
                <button id="ml-popup-apply" style="display: none; width: 100%; padding: 16px; background: #4e7cfe; color: white; border: none; border-radius: 12px; font-size: 19px; cursor: pointer; font-weight: 800;">${AiLearningManager._getLang('apply', '적용하기')}</button>
            </div>
        `;

        const textarea = document.getElementById('ml-popup-text-input') as HTMLTextAreaElement;
        const predictBtn = document.getElementById('ml-popup-predict-btn') as HTMLButtonElement;
        const applyBtn = document.getElementById('ml-popup-apply') as HTMLButtonElement;
        const closeBtn = document.getElementById('ml-popup-close') as HTMLButtonElement;

        closeBtn.addEventListener('click', cleanup);
        predictBtn.addEventListener('click', async () => {
            const text = textarea.value;
            if (!text.trim()) return;
            const result = await predict(text);
            showResultUI(result);
            setResult(result);
        });
        applyBtn.addEventListener('click', cleanup);
    }

    static renderSpeechPopup(popup: HTMLElement, data: any, cleanup: () => void, showResultUI: (res: any) => void) {
        const { predict, setResult, recordTime = 3000 } = data;

        popup.innerHTML = `
            <div style="background: #2b6df3; color: white; padding: 14px 20px; display: flex; justify-content: space-between; align-items: center; box-sizing: border-box;">
                <span style="font-weight: 700; font-size: 18px;">${AiLearningManager._getLang('data_input', '데이터 입력')}</span>
                <button id="ml-popup-close" style="background: none; border: none; color: white; font-size: 24px; cursor: pointer;">&times;</button>
            </div>
            <div style="padding: 24px; display: flex; flex-direction: column; gap: 16px; box-sizing: border-box;">
                <div style="display: flex; gap: 12px; height: 50px;">
                    <div style="flex: 1; position: relative;">
                        <select id="ml-popup-mode" style="box-sizing: border-box; width: 100%; height: 100%; padding: 0 28px 0 12px; border: 1px solid #dee2e6; border-radius: 6px; font-size: 15px; font-weight: 700; appearance: none; background: #fff; cursor: pointer; color: #495057;">
                            <option value="record">${AiLearningManager._getLang('mode_record', 'Record')}</option>
                            <option value="upload">${AiLearningManager._getLang('mode_upload', 'Upload')}</option>
                        </select>
                        <div style="position: absolute; right: 10px; top: 50%; transform: translateY(-50%); pointer-events: none; display: flex; align-items: center;">
                            <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="#6b7280" stroke-width="3" stroke-linecap="round" stroke-linejoin="round"><path d="m6 9 6 6 6-6"/></svg>
                        </div>
                    </div>
                    <button id="ml-popup-record-btn" style="box-sizing: border-box; width: 140px; height: 100%; background: #5a87ff; color: white; border: none; border-radius: 6px; cursor: pointer; display: flex; align-items: center; justify-content: center; transition: background 0.2s;">
                        <svg width="24" height="24" viewBox="0 0 24 24" fill="white"><path d="M12 14c1.66 0 3-1.34 3-3V5c0-1.66-1.34-3-3-3S9 3.34 9 5v6c0 1.66 1.34 3 3 3z"/><path d="M17 11c0 2.76-2.24 5-5 5s-5-2.24-5-5H5c0 3.53 2.61 6.43 6 6.92V21h2v-3.08c3.39-.49 6-3.39 6-6.92h-2z"/></svg>
                    </button>
                    <button id="ml-popup-upload-trigger" style="box-sizing: border-box; display: none; width: 140px; height: 100%; background: #5a87ff; color: white; border: none; border-radius: 6px; cursor: pointer; align-items: center; justify-content: center; transition: background 0.2s;">
                        <svg width="24" height="24" viewBox="0 0 24 24" fill="white"><path d="M9 16h6v-6h4l-7-7-7 7h4zm-4 2h14v2H5z"/></svg>
                    </button>
                    <input type="file" id="ml-popup-file" accept="audio/*" style="display:none;">
                </div>
                
                <div id="ml-popup-editor" style="height: 120px; border: 1px solid #dee2e6; position: relative; display: flex; align-items: center; justify-content: center; background: #fff; overflow: hidden; margin-top: 8px;">
                    <canvas id="ml-popup-canvas" width="432" height="120" style="width: 100%; height: 100%; position: absolute; z-index: 1;"></canvas>
                    <div id="ml-crop-left-overlay" style="position: absolute; left: 0; top: 0; bottom: 0; width: 0%; background: rgba(255,0,0,0.1); z-index: 2; pointer-events: none;"></div>
                    <div id="ml-crop-right-overlay" style="position: absolute; right: 0; top: 0; bottom: 0; width: 0%; background: rgba(255,0,0,0.1); z-index: 2; pointer-events: none;"></div>
                    <div id="ml-crop-left-handle" style="position: absolute; left: 0; top: 0; bottom: 0; width: 2px; background: #ff4d4f; z-index: 3; cursor: ew-resize; transform: translateX(-50%);">
                        <div style="position: absolute; top: -5px; left: 50%; width: 10px; height: 10px; border-radius: 50%; background: #ff4d4f; transform: translate(-50%, 0);"></div>
                        <div style="position: absolute; bottom: -5px; left: 50%; width: 10px; height: 10px; border-radius: 50%; background: #ff4d4f; transform: translate(-50%, 0);"></div>
                    </div>
                    <div id="ml-crop-right-handle" style="position: absolute; right: 0; top: 0; bottom: 0; width: 2px; background: #ff4d4f; z-index: 3; cursor: ew-resize; transform: translateX(50%);">
                        <div style="position: absolute; top: -5px; left: 50%; width: 10px; height: 10px; border-radius: 50%; background: #ff4d4f; transform: translate(-50%, 0);"></div>
                        <div style="position: absolute; bottom: -5px; left: 50%; width: 10px; height: 10px; border-radius: 50%; background: #ff4d4f; transform: translate(-50%, 0);"></div>
                    </div>
                    <div id="ml-popup-debug" style="position: absolute; top: 0; left: 0; padding: 4px; font-size: 10px; color: red; z-index: 5; pointer-events: none; max-height: 100%; overflow: hidden; font-family: monospace;"></div>
                </div>
                
                <div style="display: flex; gap: 12px; margin-top: 8px;">
                    <button id="ml-popup-play-btn" style="width: 80px; height: 50px; background: white; border: 1px solid #dee2e6; border-radius: 4px; display: flex; align-items: center; justify-content: center; cursor: not-allowed; opacity: 0.3;">
                        <svg width="24" height="24" viewBox="0 0 24 24" fill="#dee2e6"><path d="M8 5v14l11-7z"/></svg>
                    </button>
                    <button id="ml-popup-apply" style="flex: 1; height: 50px; background: #e9ecef; color: #adb5bd; border: none; border-radius: 4px; font-size: 16px; font-weight: 700; cursor: not-allowed;">${AiLearningManager._getLang('apply', 'Apply')}</button>
                </div>
            </div>
        `;

        const modeSelect = document.getElementById('ml-popup-mode') as HTMLSelectElement;
        const recordBtn = document.getElementById('ml-popup-record-btn') as HTMLButtonElement;
        const uploadTrigger = document.getElementById('ml-popup-upload-trigger') as HTMLButtonElement;
        const fileInput = document.getElementById('ml-popup-file') as HTMLInputElement;
        const canvas = document.getElementById('ml-popup-canvas') as HTMLCanvasElement;
        const playBtn = document.getElementById('ml-popup-play-btn') as HTMLButtonElement;
        const applyBtn = document.getElementById('ml-popup-apply') as HTMLButtonElement;
        const closeBtn = document.getElementById('ml-popup-close') as HTMLButtonElement;
        const editor = document.getElementById('ml-popup-editor') as HTMLDivElement;
        
        const leftHandle = document.getElementById('ml-crop-left-handle') as HTMLDivElement;
        const rightHandle = document.getElementById('ml-crop-right-handle') as HTMLDivElement;
        const leftOverlay = document.getElementById('ml-crop-left-overlay') as HTMLDivElement;
        const rightOverlay = document.getElementById('ml-crop-right-overlay') as HTMLDivElement;
        
        let recordStream: MediaStream | null = null;
        let isRecording = false;
        let recognizer: any = null;
        let fullTensor: any = null;
        let staticWaveform: number[] = [];
        let audioBuffer: AudioBuffer | null = null;
        let recordBlob: Blob | null = null;
        let currentSource: AudioBufferSourceNode | null = null;

        // Crop slider logic
        let leftRatio = 0.0;
        let rightRatio = 1.0;
        let isDraggingLeft = false;
        let isDraggingRight = false;
        
        leftHandle.addEventListener('mousedown', (e) => { isDraggingLeft = true; e.preventDefault(); });
        rightHandle.addEventListener('mousedown', (e) => { isDraggingRight = true; e.preventDefault(); });
        window.addEventListener('mouseup', () => { isDraggingLeft = false; isDraggingRight = false; });
        window.addEventListener('mousemove', (e) => {
            if (!isDraggingLeft && !isDraggingRight) return;
            const rect = editor.getBoundingClientRect();
            let ratio = (e.clientX - rect.left) / rect.width;
            ratio = Math.max(0, Math.min(1, ratio));
            
            if (isDraggingLeft) {
                if (ratio >= rightRatio - 0.05) ratio = rightRatio - 0.05;
                leftRatio = ratio;
                leftHandle.style.left = `${ratio * 100}%`;
                leftOverlay.style.width = `${ratio * 100}%`;
            } else if (isDraggingRight) {
                if (ratio <= leftRatio + 0.05) ratio = leftRatio + 0.05;
                rightRatio = ratio;
                rightHandle.style.right = `${(1 - ratio) * 100}%`;
                rightOverlay.style.width = `${(1 - ratio) * 100}%`;
            }
        });

        const stopAudio = () => {
            if (currentSource) { currentSource.stop(); currentSource = null; }
            if (recordStream) { recordStream.getTracks().forEach(t => t.stop()); recordStream = null; }
            cleanup();
        };

        closeBtn.addEventListener('click', stopAudio);

        // Stores raw spectrogram data (Float32Array + shape) instead of a TF tensor,
        // so we avoid any TF version conflicts in the popup context.
        let capturedSpecData: { data: Float32Array; frameSize: number } | null = null;

        const captureSpectrogram = async () => {
            const slog = (m:string) => { const div = document.getElementById('ml-popup-debug'); if(div) div.innerHTML += m + '<br>'; };

            // Priority 1: Reuse the recognizer already initialized by Entry.js (TF 1.7.4)
            // This avoids loading speech-commands/TF a second time in a conflicting version.
            const entryModule = (window as any).Entry?.aiLearning?._module;
            let currentRecognizer: any = null;

            if (entryModule?._recognizer) {
                currentRecognizer = entryModule._recognizer;
                slog('Reusing Entry._module._recognizer');
            } else if (entryModule?.baseRecognizer) {
                currentRecognizer = entryModule.baseRecognizer;
                slog('Reusing Entry._module.baseRecognizer');
            }

            if (!currentRecognizer) {
                slog('Error: No recognizer found on Entry.aiLearning._module. Is the speech model loaded?');
                console.error('[AiLearningManager] captureSpectrogram: no recognizer available on Entry module.');
                return;
            }

            try {
                slog('Starting recognize capture (reusing existing recognizer)...');
                const result = await currentRecognizer.recognize({ 
                    includeSpectrogram: true, 
                    probabilityThreshold: 0,
                    includeEmbedding: false 
                });
                slog('Recognize ended. Result: ' + (result ? 'Yes' : 'No'));

                if (result?.spectrogram) {
                    const { data: specData, frameSize } = result.spectrogram;
                    slog(`Spectrogram captured. Length: ${specData.length}, FrameSize: ${frameSize}`);
                    // Store raw data; tensor creation is done inside Entry.js's TF scope via predict()
                    capturedSpecData = { data: specData, frameSize };
                } else {
                    slog('Result or spectrogram data is missing.');
                }
            } catch(e) {
                slog(`Recognize capture failed: ${String(e)}`);
                console.error('recognize capture failed', e);
            }
        };
        
        const drawStaticWaveform = () => {
            const ctx = canvas.getContext('2d')!;
            ctx.clearRect(0, 0, canvas.width, canvas.height);
            ctx.fillStyle = '#ffb800';
            const numPoints = 100;
            const step = canvas.width / numPoints;
            const barWidth = Math.max(1, step * 0.8);
            
            let x = 0;
            for (let i = 0; i < staticWaveform.length; i++) {
                const barHeight = Math.min((staticWaveform[i] / 255) * canvas.height * 1.5, canvas.height * 0.9);
                ctx.fillRect(x, (canvas.height - barHeight) / 2, barWidth, Math.max(2, barHeight));
                x += step;
            }
        };

        modeSelect.addEventListener('change', () => {
            if (modeSelect.value === 'upload') {
                recordBtn.style.display = 'none';
                uploadTrigger.style.display = 'flex';
            } else {
                recordBtn.style.display = 'flex';
                uploadTrigger.style.display = 'none';
            }
        });
        
        uploadTrigger.addEventListener('click', () => fileInput.click());
        fileInput.addEventListener('change', async () => {
            // Placeholder: file loading can be integrated with OfflineAudioContext if needed
            alert('업로드 모드는 현재 구현 중입니다. 녹음 모드를 이용해주세요.');
        });

        let actualRecordTime = 3000;

        recordBtn.addEventListener('click', async () => {
            if (isRecording) return;
            isRecording = true;
            recordBtn.style.background = '#ff4d4f';
            staticWaveform = [];
            audioBuffer = null;
            recordBlob = null;

            // Reset buttons
            playBtn.style.borderColor = '#dee2e6';
            playBtn.style.opacity = '0.3';
            playBtn.style.cursor = 'not-allowed';
            (playBtn.querySelector('svg') as SVGElement).setAttribute('fill', '#dee2e6');
            applyBtn.style.background = '#e9ecef';
            applyBtn.style.color = '#adb5bd';
            applyBtn.style.cursor = 'not-allowed';
            
            const originalGetUserMedia = navigator.mediaDevices.getUserMedia.bind(navigator.mediaDevices);
            const rTimeMs = (recordTime < 100) ? recordTime * 1000 : recordTime; // Unit conversion if passed in seconds (e.g. 1, 2, 3)
            actualRecordTime = (rTimeMs > 0) ? rTimeMs : 3000;
            const debugDiv = document.getElementById('ml-popup-debug') as HTMLDivElement;
            debugDiv.innerHTML = `Starting record... (target: ${actualRecordTime}ms, given raw: ${recordTime})<br>`;
            const dlog = (m:string) => { debugDiv.innerHTML += m + '<br>'; };
            
            // Replicate image learning's device selection technique to avoid dead virtual microphones
            const devices = await navigator.mediaDevices.enumerateDevices();
            const audioDevices = devices.filter(d => d.kind === 'audioinput');
            const prioritized = audioDevices.find(d => 
                d.label.toLowerCase().includes('macbook') || 
                d.label.toLowerCase().includes('built-in') ||
                d.label.toLowerCase().includes('default')
            ) || audioDevices[0];
            
            const constraints = { audio: prioritized ? { deviceId: { exact: prioritized.deviceId } } : true };
            const sharedAudioStream = await originalGetUserMedia(constraints);
            
            // Intercept getUserMedia so tfjs speech-commands uses a clone of our stream instantly WITHOUT starvation
            navigator.mediaDevices.getUserMedia = async function (constraints) {
                if (constraints && constraints.audio && !constraints.video) {
                    return sharedAudioStream.clone();
                }
                return originalGetUserMedia(constraints);
            };

            recordStream = sharedAudioStream.clone();
            const audioCtx = new (window.AudioContext || (window as any).webkitAudioContext)();
            
            // Critical: AudioContext is often suspended by default in Electron, even inside a click handler
            // especially if an async operation (like getUserMedia) preceded it or is concurrent.
            if (audioCtx.state === 'suspended') {
                await audioCtx.resume();
            }
            
            recordStream = await navigator.mediaDevices.getUserMedia({ audio: true });
            
            const analyser = audioCtx.createAnalyser();
            const mediaStreamSource = audioCtx.createMediaStreamSource(recordStream);
            mediaStreamSource.connect(analyser);
            analyser.fftSize = 256;
            const bufferLength = analyser.frequencyBinCount;
            const dataArray = new Uint8Array(bufferLength);
            
            const ctx = canvas.getContext('2d')!;
            let resultWaveform: number[] = [];
            const amplitudeHistory: number[] = [];
            
            const mediaRecorder = new MediaRecorder(recordStream);
            const chunks: Blob[] = [];
            
            mediaRecorder.ondataavailable = e => {
                if (e.data.size > 0) chunks.push(e.data);
            };
            
            mediaRecorder.onstop = () => {
                dlog(`Stop! Chunks: ${chunks.length}, MR: ${mediaRecorder.state}`);
                if (chunks.length > 0) {
                    recordBlob = new Blob(chunks, { type: chunks[0].type || 'audio/webm' });
                }
                processCollectedAudio();
                staticWaveform = [...resultWaveform];
                recordBtn.style.background = '#5a87ff';
                if (recordStream) recordStream.getTracks().forEach(t => t.stop());
                drawStaticWaveform();
            };
            
            mediaRecorder.onerror = (e) => dlog(`MR error: ${e}`);
            mediaRecorder.start(250);
            
            let maxAmp = 0;
            const drawWaveform = (waveform: number[]) => {
                ctx.clearRect(0, 0, canvas.width, canvas.height);
                ctx.fillStyle = '#ffb800';
                
                const numPoints = 100;
                const step = canvas.width / numPoints;
                const barWidth = Math.max(1, step * 0.8);
                
                let x = 0;
                for (let i = 0; i < waveform.length; i++) {
                    const barHeight = Math.min((waveform[i] / 255) * canvas.height * 1.5, canvas.height * 0.9);
                    ctx.fillRect(x, (canvas.height - barHeight) / 2, barWidth, Math.max(2, barHeight));
                    x += step;
                }
            };

            const drawLive = () => {
                if (!isRecording) return;
                requestAnimationFrame(drawLive);
                
                analyser.getByteTimeDomainData(dataArray);
                let sum = 0; for(let i=0; i<dataArray.length;i++) sum += Math.abs(dataArray[i] - 128);
                let equivalentFloat = (sum / dataArray.length) / 128.0;
                let amplitudeVal = equivalentFloat * 255 * 5;
                if (amplitudeVal > maxAmp) maxAmp = amplitudeVal;
                
                amplitudeHistory.push(Math.min(255, amplitudeVal));

                const targetBars = 100;
                let currentWaveform = [];
                if (amplitudeHistory.length <= targetBars) {
                    currentWaveform = [...amplitudeHistory];
                } else {
                    const stepSize = Math.max(1, Math.floor(amplitudeHistory.length / targetBars));
                    for(let i=0; i<targetBars; i++) {
                        let sum = 0;
                        for(let j=0; j<stepSize; j++) {
                            sum += (amplitudeHistory[i*stepSize + j] || 0);
                        }
                        currentWaveform.push(Math.min(255, sum / stepSize));
                    }
                }
                resultWaveform = currentWaveform;
                
                drawWaveform(resultWaveform);
            };
            drawLive();

            // process collected offline audio
            const processCollectedAudio = () => {
                try {
                    if (recordBlob) {
                        // Generate full duration static waveform from amplitudeHistory
                        const stepSize = Math.max(1, Math.floor(amplitudeHistory.length / 100));
                        staticWaveform = [];
                        for(let i=0; i<100; i++) {
                            let sum = 0;
                            for(let j=0; j<stepSize; j++) {
                                sum += (amplitudeHistory[i*stepSize + j] || 0);
                            }
                            staticWaveform.push(Math.min(255, sum / stepSize));
                        }
                        resultWaveform = staticWaveform;
                        drawWaveform(resultWaveform);

                        // Activate buttons
                        playBtn.style.borderColor = '#5a87ff';
                        playBtn.style.opacity = '1';
                        playBtn.style.cursor = 'pointer';
                        (playBtn.querySelector('svg') as SVGElement).setAttribute('fill', '#5a87ff');
                        applyBtn.style.background = '#5a87ff';
                        applyBtn.style.color = 'white';
                        applyBtn.style.cursor = 'pointer';
                    } else {
                        // Diagnostic alert if blob is completely empty
                        alert(`녹음 실패: 오디오 데이터가 수집되지 않았습니다.`);
                    }
                } catch (e) {
                    console.error("Popup audio process failed:", e);
                    alert("오디오 생성 실패: " + String(e));
                }
            };

            // Start capture automatically since it relies on boolean isRecording
            capturedSpecData = null;
            const predictPromise = captureSpectrogram().then(() => {
                dlog(`Predict Promise resolved! SpecData: ${capturedSpecData ? 'Present' : 'NULL'}`);
            }).catch(e => {
                dlog(`Predict Promise error: ${e}`);
                console.error('Popup predict failed:', e);
            });
            
            let tick = 0;
            const tracer = setInterval(() => {
                tick++;
                if (tick <= 5) {
                    const track = recordStream?.getAudioTracks()[0];
                    dlog(`${tick}s: ctx:${audioCtx.state}, MR:${mediaRecorder.state}, act:${recordStream?.active}, trk:${track?.readyState}(${track?.enabled}), maxAmp:${maxAmp.toFixed(1)}`);
                }
            }, 500);

            setTimeout(async () => {
                clearInterval(tracer);
                isRecording = false;
                dlog(`Timeout. maxAmp: ${maxAmp.toFixed(1)}`);
                try { mediaRecorder.stop(); } catch(e){ dlog(`stop err ${e}`); }
                
                // wait for AI inference to complete BEFORE killing the mic (fallback based on configured time)
                await Promise.race([predictPromise, new Promise(r => setTimeout(r, actualRecordTime + 1000))]);
                
                if (sharedAudioStream) sharedAudioStream.getTracks().forEach(t => t.stop());
                navigator.mediaDevices.getUserMedia = originalGetUserMedia; // Restore instantly
            }, actualRecordTime);
        });

        let currentAudioElement: HTMLAudioElement | null = null;
        
        playBtn.addEventListener('click', () => {
            if (!applyBtn.style.color || applyBtn.style.color !== 'white') return; // Not ready
            if (currentAudioElement) { try { currentAudioElement.pause(); } catch(e){} currentAudioElement = null; }
            if (!recordBlob) return;
            
            const audioElement = document.createElement('audio');
            audioElement.src = URL.createObjectURL(recordBlob);
            audioElement.currentTime = leftRatio * (actualRecordTime / 1000);
            audioElement.play().catch(e => console.warn("Audio element play error:", e));
            
            currentAudioElement = audioElement;
            const playDuration = (rightRatio - leftRatio) * actualRecordTime;
            setTimeout(() => {
                if (currentAudioElement === audioElement) {
                    audioElement.pause();
                    currentAudioElement = null;
                }
            }, playDuration);
        });

        applyBtn.addEventListener('click', async () => {
            if (!capturedSpecData) {
                alert(AiLearningManager._getLang('record_first', '음성을 먼저 녹음해주세요.'));
                return;
            }

            const { data, frameSize } = capturedSpecData;
            const numFrames = data.length / frameSize;
            const startFrame = Math.floor(leftRatio * numFrames);
            const endFrame = Math.ceil(rightRatio * numFrames);

            // Zero-out frames outside the crop window (same as before but without TF tensor ops)
            let minVal = 0;
            for (let i = 0; i < data.length; i++) if (data[i] < minVal) minVal = data[i];

            const croppedData = new Float32Array(data.length);
            for (let f = 0; f < numFrames; f++) {
                const isSelected = (f >= startFrame && f <= endFrame);
                for (let i = 0; i < frameSize; i++) {
                    croppedData[f * frameSize + i] = isSelected ? data[f * frameSize + i] : minVal;
                }
            }

            // predict() is defined in SpeechClassification.js and uses Entry.js's TF (1.7.4),
            // so we pass a plain object that it can wrap in a tensor internally.
            // The spectrogram shape is [1, numFrames, frameSize, 1]
            const result = await predict({ data: croppedData, frameSize });

            if (result) {
                showResultUI(result);
                setResult(result);
            }
            stopAudio();
        });
    }
}
