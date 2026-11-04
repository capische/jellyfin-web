const openers = new WeakMap<Element, HTMLElement>();
export const rememberCommandOpener = (source: Element, opener: HTMLElement) => openers.set(source, opener);
export const commandOpener = (source?: Element | null) => source && (openers.get(source) ?? source);
