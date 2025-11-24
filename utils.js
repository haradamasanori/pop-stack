const IS_DEV = !('update_url' in chrome.runtime.getManifest());

export function devLog(...messages) {
    if (IS_DEV) {
        console.log(...messages);
    }
}

export function devWarn(...messages) {
    if (IS_DEV) {
        console.warn(...messages);
    }
}

export function devError(...messages) {
    if (IS_DEV) {
        console.error(...messages);
    }
}

export function log(...messages) {
    console.log('WebStackSpy:', ...messages);
}

export function logWarn(...messages) {
    console.warn('WebStackSpy:', ...messages);
}

export function logError(...messages) {
    console.error('WebStackSpy:', ...messages);
}
