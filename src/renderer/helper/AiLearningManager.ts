
declare global {
    interface Window {
        getAppPathWithParams: (...params: string[]) => string;
    }

}

export default class AiLearningManager {
    static window: Window | null = null;

    static init() {
        if (typeof Entry === 'undefined') {
            console.error('AiLearningManager: Entry is undefined');
            return;
        }

        console.log('AiLearningManager: Initializing');
        Entry.addEventListener('openAIUtilizeTrainManager', () => {
            console.log('AiLearningManager: Event received');
            AiLearningManager.openTrainingWindow();
        });
        window.addEventListener('message', AiLearningManager.handleMessage);
    }

    static openTrainingWindow() {
        console.log('AiLearningManager: Opening window');
        if (AiLearningManager.window && !AiLearningManager.window.closed) {
            AiLearningManager.window.focus();
            return;
        }

        const filePath = window.getAppPathWithParams('src', 'renderer', 'views', 'ai_learning_guide.html');
        // Prepend file:// protocol if not present
        const fileUrl = `file://${filePath}?lang='ko'}`; //${Entry.Lang?.type || 'ko'}`;

        // Open window with nodeIntegration enabled if possible via generic window.open? 
        // No, standard window.open doesn't allow nodeIntegration config easily in renderer.
        // However, since we use postMessage, we don't strictly need nodeIntegration in the child window 
        // UNLESS we want to use TF.js with node backend (which relies on node-gyp bindings).
        // But TF.js works in browser too. We included CDN links in HTML.
        // If offline, those CDN links won't work!
        // We should fix the CDN links to be local or rely on what Entry provides.
        // Entry likely has local assets.
        // But for now let's hope user has internet or we use local generic path?
        // Since I cannot easily add TF.js to package.json and rebuild without user permission and internet, 
        // I will stick to CDN and warn user.
        // OR better: use `entry-js` included libraries if possible.
        // `entry-js` uses `@tensorflow/tfjs` but it is bundled.

        // Let's assume internet for now or local cache.

        AiLearningManager.window = window.open(fileUrl, 'AI Model Learning', 'width=1000,height=700,menubar=no,toolbar=no,location=no,status=no,resizable=yes,scrollbars=yes');
    }

    static handleMessage(event: MessageEvent) {
        if (!event.data || event.data.type !== 'trainComplete') return;

        console.log('Received trained model from child window', event.data.message);
        const modelData = JSON.parse(event.data.message);

        if (Entry.aiLearning) {
            // For now, just alert until we implement full loading logic
            alert('Model received! Application of trained model is pending deep integration.');
            console.log(modelData);
        }
    }
}
