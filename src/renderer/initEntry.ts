import Entrylms from './resources/modal/app.js';
import StorageManager from './helper/storageManager';
import ImportToggleHelper from './helper/importToggleHelper';

import AiLearningManager from './helper/AiLearningManager';

// Lang, EntryStatic
// If the saved lang is not, set the first lang by window.getSharedObject().language from OS's locale
const SUPPORTED_LANGUAGES = ['uz', 'ru', 'en', 'ko', 'jp', 'vn', 'kaa'];
const DEFAULT_LANGUAGE = 'uz';

const persistLang = StorageManager.getPersistLangType();
const sharedLang = window.getSharedObject && window.getSharedObject() && window.getSharedObject().language;
let lastLang = persistLang || sharedLang || DEFAULT_LANGUAGE;
if (!SUPPORTED_LANGUAGES.includes(lastLang)) {
    lastLang = DEFAULT_LANGUAGE;
}
const lastWSMode = StorageManager.getPersistWorkspaceMode() || 'workspace';

AiLearningManager.init();

(async () => {
    try {
        await ImportToggleHelper.changeLang(lastLang);
    } catch (e) {
        console.error('initEntry changeLang failed', e);
    }
    try {
        await ImportToggleHelper.changeEntryStatic(lastWSMode);
    } catch (e) {
        console.error('initEntry changeEntryStatic failed', e);
    }
})();

const entrylms = new Entrylms();
window.entrylms = {
    alert: entrylms.alert,
    confirm: entrylms.confirm,
};

import('@entrylabs/modal/dist/entry-modal.js').then((module) => {
    window.EntryModal = module;
});
