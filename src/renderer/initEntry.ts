import Entrylms from './resources/modal/app.js';
import StorageManager from './helper/storageManager';
import ImportToggleHelper from './helper/importToggleHelper';

// Lang, EntryStatic
// If the saved lang is not, set the first lang by window.getSharedObject().language from OS's locale
const lastLang = StorageManager.getPersistLangType() || window.getSharedObject().language 
const lastWSMode = StorageManager.getPersistWorkspaceMode();

(async() => {
    await ImportToggleHelper.changeLang(lastLang);
    await ImportToggleHelper.changeEntryStatic(lastWSMode);
})();

const entrylms = new Entrylms();
window.entrylms = {
    alert: entrylms.alert,
    confirm: entrylms.confirm,
};
