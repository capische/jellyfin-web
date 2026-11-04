import actionsheet, { type Options } from 'components/actionSheet/actionSheet';
import { hasDesignPage } from './dialogHost';

const BACK = 'jfds-back';

/** P.menus' player sublist: Back reopens the existing controller, with its original options. */
export const playerSubmenu = (options: Options, name: string, parent: () => Promise<unknown>): Promise<unknown> => {
    if (!hasDesignPage()) return actionsheet.show(options);
    return actionsheet.show({ ...options, titleButton: { id: BACK, title: name, icon: 'arrow_back' } }).then(id => {
        if (id === BACK) return parent().then(() => Promise.reject());
        return id;
    }, () => parent().then(() => Promise.reject()));
};
