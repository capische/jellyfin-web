/** The media-mark drawings are imported as source text (`?raw`, a rule in webpack.common.js) and drawn inline in currentColor. */
declare module '*.svg?raw' {
    const source: string;
    export default source;
}
