import RendererUtils from './rendererUtils';

const SUPPORTED_LANGUAGES = ['uz', 'ru', 'en', 'ko', 'jp', 'vn', 'kaa'];
const DEFAULT_LANGUAGE = 'uz';

export default class {
    /**
     * 교과형 / 일반형 변경
     * 교과형으로 변경시에는 lang 이 강제로 ko 로 고정된다.
     * TODO ko 로 진입하는 것이 불법접근인데 필요한 방어코드인지 고려
     * @param mode{string} workspace | practical_course
     */
    static async changeEntryStatic(mode?: string) {
        let defaultEntryStatic;
        try {
            if (mode === 'practical_course') {
                if (window.Lang && RendererUtils.getLangType() !== 'ko') {
                    (async() => await this.changeLang('ko'))();
                }
                defaultEntryStatic = await import('../resources/static_mini.js');
            } else {
                defaultEntryStatic = await import('../resources/static.js');
            }
            defaultEntryStatic = defaultEntryStatic && defaultEntryStatic.default ? defaultEntryStatic.default : defaultEntryStatic;
            window.EntryStatic = defaultEntryStatic || window.EntryStatic;
        } catch (e) {
            console.error('Failed to changeEntryStatic:', e);
            try {
                const fallbackStatic = await import('../resources/static.js');
                window.EntryStatic = fallbackStatic && fallbackStatic.default ? fallbackStatic.default : fallbackStatic;
            } catch (err) {
                console.error('Failed to load fallback static.js:', err);
            }
        }
    }

    /**
     * 엔트리 오프라인에서는 다운로드 버튼이 열기 버튼으로 바뀐다. 이를 강제 치환 후,
     * 해당 블록 함수의 프로토타입 자체를 치환해버리는 코드를 가지고 있다.
     * @param lang
     * @return {Promise<void>}
     */
    static async changeLang(lang: string) {
        let targetLang = lang;
        if (!targetLang || !SUPPORTED_LANGUAGES.includes(targetLang)) {
            console.warn(`Unsupported language "${lang}". Fallback to "${DEFAULT_LANGUAGE}".`);
            targetLang = DEFAULT_LANGUAGE;
        }

        try {
            window.Lang = require(`../resources/lang/${targetLang}.json`);
        } catch (e) {
            console.error(`Failed to load lang '${targetLang}', falling back to '${DEFAULT_LANGUAGE}'`, e);
            targetLang = DEFAULT_LANGUAGE;
            try {
                window.Lang = require(`../resources/lang/${DEFAULT_LANGUAGE}.json`);
            } catch (err) {
                console.error(`Failed to load default language file '${DEFAULT_LANGUAGE}.json'`, err);
            }
        }

        const shared = window.getSharedObject && window.getSharedObject();
        if (shared) {
            shared.language = targetLang;
        }
        if (window.initNativeMenu) {
            window.initNativeMenu();
        }
    }
}
