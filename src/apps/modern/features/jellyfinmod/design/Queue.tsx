import React, { type FC, type ReactNode } from 'react';
import { Poster } from './Poster';

/** P.queue: one qrow structure on every device; the source CSS arranges the phone. */
export const QueueRowView: FC<{ image?: string; title: ReactNode; release: string; version?: string | null; details: ReactNode;
    progress: number | null; stale: boolean; figures: ReactNode; speed: string | null; eta: string | null; mark: ReactNode; more: ReactNode;
    id: string; tv: boolean; open: (target: HTMLElement) => void }> = props =>
    <div className={'qrow' + (props.tv ? ' focusable jfmod-queueFocus' : '')} data-jfmod-queue-id={props.id}
        role={props.tv ? 'button' : undefined} tabIndex={props.tv ? 0 : undefined}
        onFocus={event => event.currentTarget.classList.add('focus')} onBlur={event => {
            if (!event.currentTarget.contains(event.relatedTarget)) event.currentTarget.classList.remove('focus');
        }} onClick={props.tv ? event => props.open(event.currentTarget) : undefined}
        onKeyDown={props.tv ? event => {
            if (event.key === 'Enter' || event.key === ' ') {
                event.preventDefault();
                props.open(event.currentTarget);
            }
        } : undefined}>
        <Poster src={props.image} className='th' />
        <div className='q-t'><div className='a'>{props.title}</div>{props.version && <div className='qsub'>{props.version}</div>}
            <div className='b'>{props.release}</div>{props.details}</div>
        <div className='q-p'><div className='bar2' style={props.stale ? { opacity: '.55' } : undefined} role='progressbar'
            aria-label='Download progress' aria-valuemin={0} aria-valuemax={100} aria-valuenow={props.progress ?? undefined}>
            <i style={{ width: (props.progress ?? 0) + '%' }} /></div><div className='n'>{props.figures}</div></div>
        <span className='q-n'>{props.speed ?? '—'}</span><span className='q-n'>{props.eta ?? '—'}</span>
        <span className='q-s' style={{ color: 'var(--text-70)' }}>{props.mark}</span>{props.more}
    </div>;

export const QueueHead: FC = () => <div className='qhead' aria-hidden='true'><b style={{ width: 'var(--jfmod-q-lead, 3.618em)' }} />
    <b className='q-t'><span>Title</span></b><b className='q-p'><span>Progress</span></b>
    <b className='q-n'><span>Speed</span></b><b className='q-n'><span>Left</span></b><b className='q-s'><span>State</span></b>
    <b style={{ width: 'var(--jfmod-q-end, 2.7816em)' }} /></div>;
