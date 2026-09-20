interface FetchOptions {
    cache?: string
}

const URL_RESOLVER = document.createElement('a');

// `fetch` with `file:` support
// Recent browsers seem to support `file` protocol under some conditions.
// Based on https://github.com/github/fetch/pull/92#issuecomment-174730593
//          https://github.com/github/fetch/pull/92#issuecomment-512187452
export default async function fetchLocal(url: string, options?: FetchOptions) {
    // JellyfinMod: a bundle served from outside the document's directory declares where its own files are, so
    // `config.json` is fetched from the bundle rather than from beside the document (PHASE7 §3.1).
    URL_RESOLVER.href = window.__jfmodAssetRoot ? new URL(url, window.__jfmodAssetRoot).href : url;

    const requestURL = URL_RESOLVER.href;

    return new Promise<Response>((resolve, reject) => {
        const xhr = new XMLHttpRequest;

        xhr.onload = () => {
            // `file` protocol has invalid OK status
            let status = xhr.status;
            if (requestURL.startsWith('file:') && status === 0) {
                status = 200;
            }

            resolve(new Response(xhr.responseText, { status }));
        };

        xhr.onerror = () => {
            reject(new TypeError('Local request failed'));
        };

        xhr.open('GET', requestURL);

        if (options?.cache) {
            xhr.setRequestHeader('Cache-Control', options.cache);
        }

        xhr.send(null);
    });
}
