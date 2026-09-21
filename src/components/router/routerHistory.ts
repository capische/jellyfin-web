/* eslint-disable @typescript-eslint/no-explicit-any */
import type { Router, RouterState } from '@remix-run/router';
import type { History, Listener, To } from 'history';

import Events, { type Event } from 'utils/events';

const HISTORY_UPDATE_EVENT = 'HISTORY_UPDATE';

export class RouterHistory implements History {
    _router: Router;
    createHref: (arg: any) => string;
    private _unsubscribe?: () => void;

    constructor(router: Router) {
        this._router = router;
        this.createHref = router.createHref;
        this._subscribe();
    }

    /**
     * Points this history at a different router.
     *
     * There is one `history` per bundle and it is shared by `appRouter`, `dialogHelper` and everything that
     * navigates. Whichever router is actually rendered has to be the one it drives: navigating a router that is
     * not mounted changes the address bar, because both read the same window hash, while the rendered router
     * never hears about it — so the URL moves and the screen does not. That failure is silent and looks like a
     * dead button.
     */
    adopt(router: Router) {
        if (this._router === router) return;
        this._unsubscribe?.();
        this._router = router;
        this.createHref = router.createHref;
        this._subscribe();
    }

    private _subscribe() {
        this._unsubscribe = this._router.subscribe(state => {
            console.debug('[RouterHistory] history update', state);
            Events.trigger(document, HISTORY_UPDATE_EVENT, [ state ]);
        });
    }

    get action() {
        return this._router.state.historyAction;
    }

    get location() {
        return this._router.state.location;
    }

    back() {
        void this._router.navigate(-1);
    }

    forward() {
        void this._router.navigate(1);
    }

    go(delta: number) {
        void this._router.navigate(delta);
    }

    push(to: To, state?: any) {
        void this._router.navigate(to, { state });
    }

    replace(to: To, state?: any): void {
        void this._router.navigate(to, { state, replace: true });
    }

    block() {
        // NOTE: We don't seem to use this functionality, so leaving it unimplemented.
        throw new Error('`history.block()` is not implemented');
        return () => undefined;
    }

    listen(listener: Listener) {
        const compatListener = (_e: Event, state: RouterState) => {
            return listener({ action: state.historyAction, location: state.location });
        };

        Events.on(document, HISTORY_UPDATE_EVENT, compatListener);

        return () => Events.off(document, HISTORY_UPDATE_EVENT, compatListener);
    }
}

export const createRouterHistory = (router: Router): History => {
    return new RouterHistory(router);
};

/* eslint-enable @typescript-eslint/no-explicit-any */
