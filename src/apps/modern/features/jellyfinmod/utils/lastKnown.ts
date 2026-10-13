/**
 * The last answer of a read, kept in this browser's storage, so the next start draws from it at once while the read is asked
 * again (P1.FU23): the shared query cache is restored from IndexedDB only after the first cards are drawn, and is dropped
 * whole after every deploy. A browser without storage simply waits for the read.
 */
export const lastKnown = <T>(key: string) => ({
    read: (): T | undefined => {
        try {
            const raw = localStorage.getItem(key);
            return raw ? JSON.parse(raw) as T : undefined;
        } catch {
            return undefined;
        }
    },
    save: (value: T | undefined) => {
        try {
            if (value === undefined) localStorage.removeItem(key);
            else localStorage.setItem(key, JSON.stringify(value));
        } catch {
            // Nothing kept: the next start waits for the read.
        }
    }
});
