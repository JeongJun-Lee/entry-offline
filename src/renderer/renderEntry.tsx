// render workspace

import React from 'react';
import ReactDom from 'react-dom';
import { Provider } from 'react-redux';
import { PersistGate } from 'redux-persist/integration/react';
import configureStore from './store';
import Index from './components/Index';
import makeEntryAsciiArt from './makeEntryAsciiArt';

import AiLearningManager from './helper/AiLearningManager';

const { store, persistor } = configureStore();

window.onPageLoaded(() => {
    AiLearningManager.init();
    ReactDom.render(
        <Provider store={store}>
            <PersistGate persistor={persistor}>
                <Index />
            </PersistGate>
        </Provider>,
        document.getElementById('__next'),
    );
    makeEntryAsciiArt();
});
