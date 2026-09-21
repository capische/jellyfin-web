/**
 * Legacy view templates are imported as modules; webpack's html-loader turns them into a default-exported string.
 *
 * Upstream never needed this declaration because every one of its own template imports goes through a template
 * literal, which TypeScript does not resolve at all. The mod's detail route names one template directly
 * (`apps/legacy/controllers/itemDetails/index.html`), because it loads a single known view rather than a
 * configurable one, so the module has to be described (P7.S6).
 */
declare module '*.html' {
    const template: string;
    export default template;
}
