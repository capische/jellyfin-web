import DOMPurify from 'dompurify';
import React, { type FC, useState } from 'react';
import dialogHelper from 'components/dialogHelper/dialogHelper';
import globalize from 'lib/globalize';
import { Button, DialogContent, Input } from './Controls';
import { mountDialog } from './dialogHost';

interface DialogOptions {
    title?: string;
    text?: string;
    html?: string;
    dialogOptions?: Record<string, unknown>;
    buttons?: { id: string;
        name: string;
        description?: string;
        type?: string }[];
}

export const showDesignDialog = (options: DialogOptions) => {
    const host = dialogHelper.createDialog({ removeOnClose: true, scrollY: false, ...options.dialogOptions });
    let result: string | undefined;
    let closing = false;
    const close = () => {
        if (!closing) dialogHelper.close(host);
    };
    mountDialog(host, <DialogContent title={options.title} close={close}>
        <div data-ds-text='' dangerouslySetInnerHTML={{ __html: DOMPurify.sanitize(options.html || options.text || '') }} />
        <div className='dlgfoot'>{options.buttons?.map((button, index) => <React.Fragment key={button.id}>
            <Button initialFocus={index === 0} data-id={button.id} kind={button.type === 'delete' ? 'destroy' : undefined} className={button.type === 'submit' ? 'main' : undefined}
                onClick={() => {
                    if (!closing) result = button.id;
                    close();
                }}>{button.name}</Button>
            {button.description && <div className='help' dangerouslySetInnerHTML={{ __html: DOMPurify.sanitize(button.description) }} />}
        </React.Fragment>)}</div>
    </DialogContent>, close);
    host.addEventListener('closing', () => {
        closing = true;
    });
    return dialogHelper.open(host).then(() => result ? result : Promise.reject(new Error('Dialog closed without resolving')));
};

interface PromptOptions {
    title?: string;
    label?: string;
    value?: string;
    description?: string;
    confirmText?: string
}
const Prompt: FC<PromptOptions & { submit: (value: string) => void;
    close: () => void }> = ({ submit, close, ...options }) => {
    const [value, setValue] = useState(options.value || '');
    return <DialogContent title={options.title} close={close} narrow><form onSubmit={event => {
        event.preventDefault();
        event.stopPropagation();
        submit(value);
    }}><Input initialFocus label={options.label || ''} value={value} help={options.description} onChange={event => setValue(event.target.value)} />
        <div className='dlgfoot'><Button type='submit' kind='main'>{options.confirmText || globalize.translate('ButtonOk')}</Button></div>
    </form></DialogContent>;
};
export const showDesignPrompt = (options: PromptOptions) => {
    const host = dialogHelper.createDialog({ removeOnClose: true, scrollY: false });
    let result: string | undefined;
    let closing = false;
    const close = () => {
        if (!closing) dialogHelper.close(host);
    };
    const submit = (value: string) => {
        if (!closing) result = value;
        setTimeout(close, 300);
    };
    mountDialog(host, <Prompt {...options} submit={submit} close={close} />, close);
    host.addEventListener('closing', () => {
        closing = true;
    });
    return dialogHelper.open(host).then(() => result ? result : Promise.reject(new Error('Prompt closed without resolving')));
};
