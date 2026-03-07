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

    static init() {
        if (typeof window !== 'undefined') {
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

                            const refreshUI = () => {
                                if (!entry.playground?.blockMenu) return;

                                const bm = entry.playground.blockMenu;
                                const attrLength = modelData.tableData?.select?.[0]?.length || 0;

                                const runUnban = () => {
                                    console.log('Updating UI for AI Model...');
                                    if (entry.aiLearning.unbanBlocks) entry.aiLearning.unbanBlocks();

                                    bm.unbanCategory('ai_utilize');

                                    // Make sure the category is visible and selected
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
        }
    }
}
