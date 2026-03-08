import IpcRendererHelper from './ipcRendererHelper';

export default class AiLearningManager {
    static lastModelData: any = null;

    static openModelSelectionWindow() {
        let lang = 'ko';
        try {
            const rawPersist = localStorage.getItem('persist:storage');
            if (rawPersist) {
                lang = JSON.parse(JSON.parse(rawPersist).persist).lang || 'ko';
            }
        } catch (e) { }

        const targetUrl = `../../renderer/views/ai_model_selection.html?lang=${lang}`;
        window.open(targetUrl, 'AiModelSelection', 'width=1040,height=700,menubar=no,toolbar=no,location=no,status=no,resizable=yes');
    }

    static popupListenerRegistered = false;

    static init() {
        if (typeof window !== 'undefined') {
            // --- Listen for trainComplete from the training modal ---
            window.addEventListener('message', async (event) => {
                if (event.data && event.data.type === 'trainComplete') {
                    console.log('Model trained (Integrated Flow):', event.data.modelData);
                    const entry = (window as any).Entry;
                    if (entry?.aiLearning) {
                        try {
                            const modelData = event.data.modelData;
                            this.lastModelData = modelData;

                            // Direct Load using the integrated offline support in AILearning.js
                            await entry.aiLearning.load(modelData);

                            // Hook Entry.dispatchEvent to intercept openMLInputPopup
                            this.hookDispatchEvent();

                            const refreshUI = () => {
                                if (!entry.playground?.blockMenu) return;

                                const bm = entry.playground.blockMenu;

                                const runUnban = () => {
                                    console.log('Updating UI for AI Model...');
                                    if (entry.aiLearning.unbanBlocks) entry.aiLearning.unbanBlocks();

                                    bm.unbanCategory('ai_utilize');

                                    try {
                                        entry.playground.reloadPlayground();
                                        bm.align();
                                        bm.selectMenu('ai_utilize', true, true);
                                    } catch (err) {
                                        console.error('UI Refresh failed:', err);
                                    }
                                };

                                [0, 500, 1500].forEach((delay) => setTimeout(runUnban, delay));
                            };

                            setTimeout(refreshUI, 100);
                        } catch (err) {
                            console.error('Error in trainComplete integration:', err);
                        }
                    }
                }
            });

            // Also try hooking early via retry in case Entry is already loaded
            this.hookDispatchEvent();
            if (!this.dispatchHooked) {
                const retryInterval = setInterval(() => {
                    this.hookDispatchEvent();
                    if (this.dispatchHooked) {
                        clearInterval(retryInterval);
                    }
                }, 1000);
                setTimeout(() => clearInterval(retryInterval), 60000);
            }
        }
    }

    /**
     * Hook Entry.dispatchEvent to intercept openMLInputPopup events.
     * This bypasses Entry.events_ which can get cleared during initialization.
     */
    static dispatchHooked = false;
    static hookDispatchEvent() {
        if (this.dispatchHooked) return;
        const entry = (window as any).Entry;
        if (!entry || typeof entry.dispatchEvent !== 'function') return;

        const originalDispatch = entry.dispatchEvent.bind(entry);
        const self = this;
        entry.dispatchEvent = function(eventName: string, ...args: any[]) {
            if (eventName === 'openMLInputPopup') {
                console.log('[AiLearningManager] Intercepted openMLInputPopup via dispatch hook');
                self.showInputPopup(args[0]);
                return;
            }
            return originalDispatch(eventName, ...args);
        };
        this.dispatchHooked = true;
        console.log('[AiLearningManager] dispatchEvent hook installed');
    }

    /**
     * Show the runtime data input popup for image classification.
     * Called when the "학습한 모델로 분류하기" block executes.
     */
    static showInputPopup(data: any) {
        const { type, predict, labels, setResult } = data;
        const entry = (window as any).Entry;

        if (type !== 'image') {
            console.warn('showInputPopup: unsupported type', type);
            return;
        }

        // Mark isLoading so the block waits for result
        if (entry?.aiLearning) {
            entry.aiLearning.isLoading = true;
        }

        // Create overlay
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

        popup.innerHTML = `
            <div style="background: #2b6df3; color: white; padding: 14px 20px; display: flex; justify-content: space-between; align-items: center; box-sizing: border-box;">
                <span style="font-weight: 700; font-size: 18px; letter-spacing: -0.5px;">데이터 입력</span>
                <button id="ml-popup-close" style="background: none; border: none; color: white; font-size: 24px; cursor: pointer; padding: 0; line-height: 1;">&times;</button>
            </div>
            <div style="padding: 24px; display: flex; flex-direction: column; gap: 20px; box-sizing: border-box;">
                <div id="ml-popup-main-content" style="display: flex; gap: 20px; align-items: stretch; width: 100%; box-sizing: border-box;">
                    <div id="ml-popup-left-col" style="flex: 1; min-width: 0; display: flex; flex-direction: column; gap: 20px; box-sizing: border-box;">
                        <div style="position: relative; width: 100%; box-sizing: border-box;">
                            <select id="ml-popup-mode" style="width: 100%; padding: 10px 36px 10px 14px; border: 2px solid #e9ecef; border-radius: 8px; font-size: 15px; appearance: none; background: white; cursor: pointer; font-weight: 700; color: #343a40; box-sizing: border-box;">
                                <option value="upload">업로드</option>
                                <option value="webcam" selected>촬영</option>
                            </select>
                            <div style="position: absolute; right: 12px; top: 50%; transform: translateY(-50%); pointer-events: none; color: #495057;">
                                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="3.5" stroke-linecap="round" stroke-linejoin="round"><path d="m6 9 6 6 6-6"/></svg>
                            </div>
                        </div>
                        
                        <div id="ml-popup-capture-area" style="display: block; width: 100%; box-sizing: border-box;">
                            <button id="ml-popup-capture" style="width: 100%; height: 80px; background: #5a87ff; color: white; border: none; border-radius: 12px; cursor: pointer; display: flex; align-items: center; justify-content: center; box-shadow: 0 4px 12px rgba(90, 135, 255, 0.3); transition: transform 0.1s, background 0.2s; box-sizing: border-box;">
                                <svg width="36" height="36" viewBox="0 0 24 24" fill="white"><path d="M12 17c2.206 0 4-1.794 4-4s-1.794-4-4-4-4 1.794-4 4 1.794 4 4 4zm0-6c1.103 0 2 .897 2 2s-.897 2-2 2-2-.897-2-2 .897-2 2-2z"/><path d="M20 5h-3.172l-1.414-1.414A1.989 1.989 0 0 0 14.004 3H9.997c-.544 0-1.045.211-1.414.586L7.17 5H4c-1.103 0-2 .897-2 2v11c0 1.103.897 2 2 2h16c1.103 0 2-.897 2-2V7c0-1.103-.897-2-2-2zm0 13H4V7h4.828l1.414-1.414A1.989 1.989 0 0 1 11.657 5h2.686c.545 0 1.045.211 1.414.586L17.172 7H20v11z"/></svg>
                            </button>
                        </div>
                    </div>

                    <div id="ml-popup-display-area" style="flex: 1.1; min-width: 0; box-sizing: border-box; position: relative;">
                        <div id="ml-popup-upload-box" style="display: none; align-items: center; justify-content: center; border: 2px dashed #dbdfed; border-radius: 12px; width: 100%; aspect-ratio: 1 / 1; cursor: pointer; flex-direction: column; gap: 8px; color: #8a95ab; background: #fbfcfe; box-sizing: border-box; position: relative; overflow: hidden; background-size: cover; background-position: center;">
                            <div id="ml-popup-upload-overlay" style="display: flex; flex-direction: column; align-items: center; justify-content: center; gap: 8px; z-index: 2; width: 100%; height: 100%; background: rgba(251,252,254,0.3); pointer-events: none;">
                                <svg width="40" height="40" fill="none" viewBox="0 0 24 24" stroke-width="2.5" stroke="currentColor"><path stroke-linecap="round" stroke-linejoin="round" d="M12 4.5v15m7.5-7.5h-15"/></svg>
                                <span style="font-size: 15px; font-weight: 700;">파일 업로드</span>
                            </div>
                            <input type="file" id="ml-popup-file" accept="image/*" style="display:none;">
                        </div>
                        
                        <div id="ml-popup-webcam-box" style="display: block; position: relative; border-radius: 12px; overflow: hidden; background: #000; width: 100%; aspect-ratio: 1 / 1; box-shadow: 0 4px 12px rgba(0,0,0,0.15); box-sizing: border-box;">
                            <video id="ml-popup-video" playsinline autoplay muted style="width: 100%; height: 100%; object-fit: cover;"></video>
                            <div id="ml-popup-video-flip" style="position: absolute; right: 12px; bottom: 12px; background: rgba(255,255,255,0.95); border-radius: 10px; padding: 8px; cursor: pointer; display: flex; align-items: center; justify-content: center; box-shadow: 0 2px 10px rgba(0,0,0,0.2); transition: transform 0.1s, background 0.2s; z-index: 5; box-sizing: border-box;">
                                <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="#2b6df3" stroke-width="3" stroke-linecap="round" stroke-linejoin="round"><path d="M2.5 2v6h6M21.5 22v-6h-6"/><path d="M22 11.5A10 10 0 0 0 3.2 7.2M2 12.5a10 10 0 0 0 18.8 4.3"/></svg>
                            </div>
                        </div>

                        <img id="ml-popup-preview" style="display: none; width: 100%; aspect-ratio: 1 / 1; object-fit: cover; border-radius: 12px; border: 1px solid #dee2e6; box-sizing: border-box;">
                    </div>
                </div>

                <div id="ml-popup-result" style="display: none; padding: 14px; background: #eef2ff; border: 1px solid #d0d7f7; border-radius: 10px; font-size: 15px; font-weight: 700; color: #2b6df3; box-sizing: border-box; text-align: center;"></div>
                
                <canvas id="ml-popup-canvas" style="display: none;" width="224" height="224"></canvas>
                
                <button id="ml-popup-apply" style="display: none; width: 100%; padding: 16px; background: #4e7cfe; color: white; border: none; border-radius: 12px; font-size: 19px; cursor: pointer; font-weight: 800; box-sizing: border-box; transition: transform 0.1s, background 0.2s; box-shadow: 0 4px 14px rgba(78, 124, 254, 0.35);">적용하기</button>
            </div>
        `;

        overlay.appendChild(popup);
        document.body.appendChild(overlay);

        // Elements
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
        const resultDiv = document.getElementById('ml-popup-result') as HTMLDivElement;
        const applyBtn = document.getElementById('ml-popup-apply') as HTMLButtonElement;
        const closeBtn = document.getElementById('ml-popup-close') as HTMLButtonElement;
        let stream: MediaStream | null = null;

        const cleanup = () => {
            if (stream) {
                stream.getTracks().forEach(t => t.stop());
                stream = null;
            }
            if (overlay.parentElement) {
                overlay.parentElement.removeChild(overlay);
            }
            if (entry?.aiLearning) {
                entry.aiLearning.isLoading = false;
            }
        };

        const showResult = (result: string) => {
            resultDiv.innerText = `분류 결과: ${result}`;
            resultDiv.style.display = 'block';
            applyBtn.style.display = 'block';
            setResult(result);
        };

        // Close handler
        closeBtn.addEventListener('click', cleanup);
        overlay.addEventListener('click', (e) => {
            if (e.target === overlay) cleanup();
        });

        // Initialize with default mode
        const initWebcam = async () => {
            uploadBox.style.display = 'none';
            webcamBox.style.display = 'block';
            captureArea.style.display = 'block';
            try {
                stream = await navigator.mediaDevices.getUserMedia({ video: true });
                video.srcObject = stream;
            } catch (e) {
                console.error('Webcam access failed:', e);
            }
        };
        
        if (modeSelect.value === 'webcam') {
            initWebcam();
        } else {
            uploadBox.style.display = 'flex';
            webcamBox.style.display = 'none';
            captureArea.style.display = 'none';
        }

        // Mode switch
        modeSelect.addEventListener('change', async () => {
            const mode = modeSelect.value;
            preview.style.display = 'none';
            resultDiv.style.display = 'none';
            applyBtn.style.display = 'none';
            uploadBox.style.backgroundImage = 'none';
            uploadOverlay.style.background = 'rgba(251,252,254,0.3)';
            
            if (mode === 'upload') {
                uploadBox.style.display = 'flex';
                webcamBox.style.display = 'none';
                captureArea.style.display = 'none';
                if (stream) {
                    stream.getTracks().forEach(t => t.stop());
                    stream = null;
                }
            } else {
                await initWebcam();
            }
        });

        // Upload click
        uploadBox.addEventListener('click', () => fileInput.click());

        // File selected
        fileInput.addEventListener('change', async () => {
            const file = fileInput.files?.[0];
            if (!file) return;
            const reader = new FileReader();
            reader.onload = async (ev) => {
                const imgSrc = ev.target?.result as string;
                
                // Show as background in upload box
                uploadBox.style.backgroundImage = `url(${imgSrc})`;
                uploadOverlay.style.background = 'rgba(255,255,255,0.4)';

                const img = new Image();
                img.onload = async () => {
                    const ctx = canvas.getContext('2d')!;
                    ctx.drawImage(img, 0, 0, 224, 224);
                    const result = await predict(canvas);
                    showResult(result);
                };
                img.src = imgSrc;
            };
            reader.readAsDataURL(file);
        });

        // Capture click
        captureBtn.addEventListener('click', async () => {
            const ctx = canvas.getContext('2d')!;
            ctx.drawImage(video, 0, 0, 224, 224);
            const dataUrl = canvas.toDataURL('image/png');
            preview.src = dataUrl;
            preview.style.display = 'block';
            webcamBox.style.display = 'none';

            const result = await predict(canvas);
            showResult(result);
        });

        // Apply
        applyBtn.addEventListener('click', cleanup);
    }
}
