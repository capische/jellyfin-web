import React, { type FC, useContext, useEffect, useRef, useState } from 'react';
import type { UserDto } from '@jellyfin/sdk/lib/generated-client/models/user-dto';
import { useSearchParams } from 'react-router-dom';
import { AppFeature } from 'constants/appFeature';
import { appHost } from 'components/apphost';
import { ServerConnections } from 'lib/jellyfin-apiclient';
import appSettings from 'scripts/settings/appSettings';
import Dashboard from 'utils/dashboard';
import globalize from 'lib/globalize';
import { authenticateUserByName, authenticateQuickConnect, sanitizeSignInDisclaimer } from '../integration/signInActions';
import { DesignContext, Root } from './Root';
import { Icon } from './Icon';

const UserAvatar: FC<{ src?: string }> = ({ src }) => {
    const [failed, setFailed] = useState<string>();
    return <span className='avatar2'>{src && failed !== src ? <img src={src} loading='lazy' alt='' onError={() => setFailed(src)} /> : <Icon name='person' />}</span>;
};

const Field: FC<{ label: string;
    id: string;
    password?: boolean;
    value: string;
    onChange: (value: string) => void;
    bad?: boolean }> = ({ label, id, password, value, onChange, bad }) => {
    const [focused, setFocused] = useState(false);
    return <div className={'fld' + (focused ? ' foc' : '') + (bad ? ' bad' : '')}>
        <label className='lb' htmlFor={id}>{label}</label><div className='box'><input className='v' id={id}
            type={password ? 'password' : 'text'} required={!password} value={value} autoComplete={password ? 'current-password' : 'username'}
            autoCapitalize='off' aria-invalid={bad || undefined} aria-describedby={bad ? 'signin-error' : undefined}
            onChange={event => onChange(event.target.value)} onFocus={() => setFocused(true)} onBlur={() => setFocused(false)} /></div>
    </div>;
};

/** ds.js P.signin: form, wrong-password state and public users;
actions are the original controller's. */
const SignInBody = () => {
    const device = useContext(DesignContext);
    const [params] = useSearchParams();
    const serverId = params.get('serverid');
    const client = serverId ? ServerConnections.getOrCreateApiClient(serverId) : ServerConnections.currentApiClient();
    const target = params.get('url') || '/home';
    const page = useRef<HTMLDivElement>(null);
    const [users, setUsers] = useState<UserDto[]>([]);
    const [manual, setManual] = useState(false);
    const [loaded, setLoaded] = useState(false);
    const [username, setUsername] = useState('');
    const [password, setPassword] = useState('');
    const [remember, setRemember] = useState(appSettings.enableAutoLogin());
    const [wrong, setWrong] = useState<string>();
    const [busy, setBusy] = useState(false);
    const [quick, setQuick] = useState(false);
    const [disclaimer, setDisclaimer] = useState('');
    const [splash, setSplash] = useState<string>();
    const stopQuick = useRef<(() => void) | null>(null);
    useEffect(() => {
        let current = true;
        if (!client) return;
        client.getPublicUsers().then((list: UserDto[]) => {
            if (!current) return;
            setUsers(list);
            setManual(!list.length);
            setLoaded(true);
        }, () => {
            if (current) {
                setManual(true);
                setLoaded(true);
            }
        });
        client.getQuickConnect('Enabled').then((enabled: boolean) => current && setQuick(enabled === true)).catch(console.debug);
        client.getJSON(client.getUrl('Branding/Configuration')).then((options: { LoginDisclaimer?: string;
            SplashscreenEnabled?: boolean }) => {
            if (!current) return;
            setDisclaimer(sanitizeSignInDisclaimer(options.LoginDisclaimer));
            if (options.SplashscreenEnabled) setSplash(client.getUrl('Branding/Splashscreen'));
        }).catch(console.debug);
        return () => {
            current = false;
            stopQuick.current?.();
            stopQuick.current = null;
        };
    }, [client]);
    useEffect(() => {
        if (!loaded) return;
        if (!manual) page.current?.querySelector<HTMLElement>('.usr')?.focus();
        else page.current?.querySelector<HTMLInputElement>(username ? '#txtManualPassword' : '#txtManualName')?.focus();
    // A wrong password keeps the user and returns focus to the password.
    // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [loaded, manual, wrong]);
    useEffect(() => {
        page.current?.querySelectorAll<HTMLAnchorElement>('[data-ds-disclaimer] a').forEach(link => {
            link.rel = 'noopener noreferrer';
            link.target = '_blank';
            if (device === 'tv') link.tabIndex = -1;
        });
    }, [disclaimer, device, manual]);
    const signIn = (name = username, secret = password) => {
        if (!client || !page.current || busy) return;
        setBusy(true);
        setWrong(undefined);
        appSettings.enableAutoLogin(remember);
        authenticateUserByName(page.current, client, target, name, secret).then((result: boolean | number) => {
            setBusy(false);
            if (result === true) return;
            setPassword('');
            setManual(true);
            let message = 'MessageUnableToConnectToServer';
            if (result === 401) message = 'MessageInvalidUser';
            if (result === 403) message = 'MessageUnauthorizedUser';
            setWrong(globalize.translate(message));
        });
    };
    const quickConnect = () => {
        if (!client || stopQuick.current) return;
        authenticateQuickConnect(client, target).then((stop: false | (() => void)) => {
            if (!stop) return;
            if (page.current?.isConnected) stopQuick.current = stop;
            else stop();
        });
    };
    const buttons = <div className='btncol'><div className='btnstack'>
        {manual && <button type='submit' className='btn main focusable' disabled={busy}>Sign In</button>}
        {quick && <button type='button' className='btn focusable' onClick={quickConnect}>Use Quick Connect</button>}
        <button type='button' className='btn focusable' onClick={() => Dashboard.navigate('forgotpassword')}>Forgot Password</button>
        {manual && users.length > 0 && <button type='button' className='btn focusable' onClick={() => {
            setWrong(undefined);
            setManual(false);
        }}>Cancel</button>}
        {appHost.supports(AppFeature.MultiServer) && <button type='button' className='btn focusable' onClick={() => Dashboard.selectServer()}>Change Server</button>}
    </div></div>;
    return <div ref={page} className='signin onart' style={{ minHeight: '100vh', padding: `${device === 'phone' ? '2.618em' : '4.236em'} 0` }}>
        <div className='art' style={splash ? { backgroundImage: `url("${splash}")` } : undefined} />
        {loaded && (manual ? <form className='signbox manualLoginForm' aria-busy={busy} onSubmit={event => {
            event.preventDefault();
            signIn();
        }}>
            <div className='logo2' /><h1>Sign In</h1>
            <Field id='txtManualName' label='User' value={username} onChange={setUsername} />
            <Field id='txtManualPassword' label='Password' password value={password} onChange={setPassword} bad={!!wrong} />
            {wrong && <div className='help' id='signin-error' role='alert'><span style={{ color: 'var(--err)' }}>{wrong}</span></div>}
            <label className='swl'><span className='tx'><span>Remember Me</span></span><span className={'sw' + (remember ? ' on' : '')}>
                <i /><input type='checkbox' checked={remember} aria-label='Remember Me' onChange={event => setRemember(event.target.checked)} />
            </span></label>
            {buttons}
            {disclaimer && <div className='lead2' data-ds-disclaimer dangerouslySetInnerHTML={{ __html: disclaimer }} />}
        </form> : <div className='users' style={{ color: '#fff' }}>
            <h1 style={{ color: '#fff' }}>Who Is Watching?</h1>
            {users.map(user => <button key={user.Id} type='button' className='usr focusable' style={{ color: '#fff' }} disabled={busy}
                onFocus={event => event.currentTarget.classList.add('focus')} onBlur={event => event.currentTarget.classList.remove('focus')}
                onClick={() => {
                    setUsername(user.Name || '');
                    setPassword('');
                    // eslint-disable-next-line @typescript-eslint/no-deprecated -- preserve the public-user response's existing password behavior.
                    if (user.HasPassword) setManual(true);
                    else signIn(user.Name || '', '');
                }}>
                <UserAvatar src={user.PrimaryImageTag && user.Id ? client?.getUserImageUrl(user.Id, { width: 300, tag: user.PrimaryImageTag, type: 'Primary' }) : undefined} /><b>{user.Name}</b>
            </button>)}
            <button type='button' className='usr focusable btnManual' style={{ color: '#fff' }} onFocus={event => event.currentTarget.classList.add('focus')}
                onBlur={event => event.currentTarget.classList.remove('focus')} onClick={() => {
                    setUsername('');
                    setPassword('');
                    setManual(true);
                }}>
                <span className='avatar2 grey'><Icon name='plus' /></span><b>Other User</b>
            </button>{buttons}
            {disclaimer && <div className='lead2' data-ds-disclaimer dangerouslySetInnerHTML={{ __html: disclaimer }} />}
        </div>)}
        {/* The original authentication action clears this field even for a passwordless public user. */}
        {!manual && <input id='txtManualPassword' type='password' hidden readOnly value='' />}
    </div>;
};

export const SignIn = () => <Root><SignInBody /></Root>;
