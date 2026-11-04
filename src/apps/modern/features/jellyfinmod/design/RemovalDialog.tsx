import DOMPurify from 'dompurify';
import React, { type FC, useState } from 'react';
import { Button, DialogContent, Switch } from './Controls';

interface RemovalPlan {
    title: string;
    question: string;
    facts: { html: string; fail?: boolean }[];
    notes: string[];
    choices: { id: string; name: string; red?: boolean; text?: string }[];
    blocklist: boolean;
}

/** P.remove: data and decisions still come from queueActions.removalPlan. */
export const RemovalDialog: FC<{ plan: RemovalPlan; release: string; choose: (id: string, blocklist: boolean) => void; close: () => void }> = ({ plan, release, choose, close }) => {
    const [blocklist, setBlocklist] = useState(false);
    return <DialogContent title={plan.title} narrow close={close} className='jfmod-removeDialog'>
        <p data-ds-question='' style={{ margin: '.382em 0 0', fontSize: '1.1em' }}>{plan.question}</p>
        {plan.facts.map(fact => <p key={fact.html} data-ds-fact='' style={{ margin: '.618em 0 0', color: fact.fail ? 'var(--err)' : 'var(--text-70)' }}
            dangerouslySetInnerHTML={{ __html: DOMPurify.sanitize(fact.html) }} />)}
        {plan.notes.map(note => <p key={note} data-ds-note='' style={{ margin: '.382em 0 0', fontSize: '.95em', color: 'var(--text-70)' }}>{note}</p>)}
        <div className='rname' style={{ whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis', wordBreak: 'normal', opacity: '.5', marginTop: '.618em' }}>{release}</div>
        {plan.blocklist && <Switch label='Blocklist this release' help='Later searches skip it.' checked={blocklist} onChange={setBlocklist} />}
        {plan.choices.map((choice, index) => <React.Fragment key={choice.id}>
            <Button kind={choice.red ? 'destroy' : undefined} initialFocus={choice.id === 'cancel'} className={'wide-btn' + (index === 0 ? ' first' : '')}
                data-choice={choice.id} onClick={() => choose(choice.id, blocklist)}>{choice.name}</Button>
            {choice.text && <div className='help' style={{ marginLeft: 0 }}>{choice.text}</div>}
        </React.Fragment>)}
    </DialogContent>;
};
