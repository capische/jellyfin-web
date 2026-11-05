// Offline browser integration for Preferences projection/lifetime, Quick Connect, menus and player presentation.
// No server, credentials or network; actual components/adapters with controlled service boundaries.
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium } from 'playwright';
const require = createRequire(import.meta.url);
const { build } = require('esbuild');
const sass = require('sass');
const repo = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const feature = path.join(repo, 'src/apps/modern/features/jellyfinmod');
const mocks = {
    layoutManager: `export default {get tv(){return document.documentElement.classList.contains('layout-tv')},get mobile(){return document.documentElement.classList.contains('layout-mobile')}};`,
    scrollManager: `export default {isEnabled:()=>false};`,
    keyboardNavigation: `export const getKeyName=e=>e.key;`,
    dpadModals: `export const isBackKey=key=>['Escape','GoBack','BrowserBack'].includes(key);`,
    reactUtils: `import React from 'react';import {createRoot} from 'react-dom/client';import {flushSync} from 'react-dom';
        export const renderComponent=(Component,props,host)=>{const root=createRoot(host);window.mounts++;flushSync(()=>root.render(React.createElement(Component,props)));return ()=>{root.unmount();window.unmounts++}};`,
    playbackmanager: `export const playbackManager={getCurrentPlayer:()=>null};`,
    apphost: `export const appHost={supports:()=>false};`,
    'jellyfin-apiclient': `export const ServerConnections={currentApiClient:()=>window.client};`,
    appSettings: `export default {enableAutoLogin:()=>false};`,
    dashboard: `export default {alert:()=>window.failures++,navigate:()=>window.logins++,onServerChanged(){}};`,
    globalize: `export default {translate:key=>key};`,
    loading: `export default {show(){},hide(){}};`,
    toast: `export default ()=>{};`,
    alert: `export default ()=>{const node=document.createElement('div');node.id='quickConnectAlert';document.body.append(node);return new Promise((resolve,reject)=>{window.dismissQuick=(back=false)=>{node.remove();back?reject():resolve()}})};`,
    dialogHelper: `export default {close:()=>window.dismissQuick()};`
};
const result = await build({stdin:{contents:`
    import React from 'react';import {createRoot} from 'react-dom/client';import {flushSync} from 'react-dom';import {MemoryRouter} from 'react-router-dom';
    import {paintPreferencesPages} from '${feature}/integration/prefsPages';
    import {paintPlayer} from '${feature}/integration/playerDesign';
    import {SignIn} from '${feature}/design/SignIn';
    import {Menu} from '${feature}/design/Menu';import {Root} from '${feature}/design/Root';
    import ViewSettingsButton from '${repo}/src/apps/modern/features/libraries/components/ViewSettingsButton';
    const root=createRoot(document.getElementById('app'));
    let stopPrefs;let stopPlayer;
    const View=({image,mode})=>{const [value,set]=React.useState({ViewMode:mode,ImageType:image,ShowTitle:false,ShowYear:false,CardLayout:false});return React.createElement(Root,null,React.createElement(ViewSettingsButton,{viewType:'movies',libraryViewSettings:value,setLibraryViewSettings:set,renderButton:({onClick})=>React.createElement('button',{onClick},'View Settings')}))};
    window.ui={
        startPrefs(){stopPrefs=paintPreferencesPages()},stopPrefs(){stopPrefs()},
        signIn(){flushSync(()=>root.render(React.createElement(MemoryRouter,null,React.createElement(SignIn))))},
        clear(){flushSync(()=>root.render(null))},
        menu(){flushSync(()=>root.render(React.createElement(Root,null,React.createElement(Menu,{label:'Test menu',close:()=>window.ui.clear()},React.createElement('button',null,'Choice')))))},
        settings(image='Primary',mode='grid'){flushSync(()=>root.render(React.createElement(View,{key:image+mode,image,mode})))},
        player(){stopPlayer=paintPlayer(document.getElementById('player'))},stopPlayer(){stopPlayer()}
    };`,resolveDir:repo,loader:'tsx'},bundle:true,write:false,format:'iife',platform:'browser',tsconfig:path.join(repo,'tsconfig.json'),
    plugins:[{name:'environment',setup(b){
        b.onResolve({filter:/\.(scss|css)$/},a=>({path:a.path,namespace:'empty'}));b.onLoad({filter:/.*/,namespace:'empty'},()=>({contents:'',loader:'js'}));
        b.onResolve({filter:/(?:^|\/)(layoutManager|scrollManager|keyboardNavigation|dpadModals|reactUtils|playbackmanager|apphost|jellyfin-apiclient|appSettings|dashboard|globalize|loading|toast|alert|dialogHelper)$/},a=>({path:a.path.split('/').pop(),namespace:'mock'}));
        b.onLoad({filter:/.*/,namespace:'mock'},a=>({contents:mocks[a.path],loader:'js',resolveDir:repo}));
    }}]
});
const css=[path.join(repo,'src/elements/emby-slider/emby-slider.scss'),path.join(feature,'design/design.scss')].map(file=>sass.compile(file,{logger:{warn(){}},silenceDeprecations:['import','global-builtin','color-functions']}).css).join('\n');
const browser=await chromium.launch({headless:true});
try {
    const page=await browser.newPage({viewport:{width:1440,height:900}});page.setDefaultTimeout(5000);
    await page.route('**/*',route=>route.abort());
    await page.setContent('<html class="jfmod-chrome layout-desktop" data-theme="dark"><body><button id="outside">Outside</button><div id="app"></div></body></html>');
    const errors=[];page.on('pageerror',e=>errors.push(e.message));
    await page.evaluate(()=>{
        window.mounts=0;window.unmounts=0;window.failures=0;window.logins=0;window.initiations=0;window.polls=0;
        const timers=new Set();window.timers=timers;
        const observers=new Set();window.observers=observers;const NativeObserver=window.MutationObserver;
        window.MutationObserver=class extends NativeObserver {observe(target,options){if(target===document.body||options.attributeFilter?.includes('data-theme'))observers.add(this);return super.observe(target,options)}disconnect(){observers.delete(this);return super.disconnect()}};const set=window.setInterval.bind(window),clear=window.clearInterval.bind(window);
        window.setInterval=(fn,ms,...args)=>{if(ms===5000)window.quickTick=fn;const id=set(fn,ms,...args);timers.add(id);return id};
        window.clearInterval=id=>{timers.delete(id);clear(id)};
        window.client={getPublicUsers:async()=>[],getQuickConnect:async()=>true,getJSON:async url=>{
            if(url.includes('Branding'))return {};
            window.polls++;if(window.pollFailure)throw Error('poll failed');
            if(window.latePoll)return new Promise(resolve=>window.finishPoll=resolve);
            return {Authenticated:!!window.authenticated,Secret:'test-only'};
        },getUrl:route=>route,ajax:async()=>{window.initiations++;return {json:async()=>({Secret:'test-only',Code:'123456'})}},quickConnect:async()=>({User:{Id:'viewer'},AccessToken:'test-only'})};
    });
    await page.addStyleTag({content:css});await page.addScriptTag({content:result.outputFiles[0].text});
    await page.evaluate(()=>ui.startPrefs());
    for(let visit=0;visit<3;visit++){
        await page.evaluate(()=>{
            const view=document.createElement('div');view.id='quickConnectPreferencesPage';
            view.innerHTML='<div><form><h2>Quick Connect</h2><div class="selectContainer"><label for="sourceSelect">Language</label><select id="sourceSelect"><option value="en">English</option><option value="uk">Ukrainian</option></select></div><div class="inputContainer"><label for="sourceInput">Code</label><input id="sourceInput" required pattern="[0-9]{6}"></div><div class="inputContainer"><label for="sourceCss">Custom CSS</label><textarea id="sourceCss"></textarea></div><button type="submit">Save</button></form></div>';
            document.body.append(view);
            // Same inheritance shape as emby-select, emby-input and emby-textarea (no immediate value descriptor).
            view.querySelectorAll('select,input,textarea').forEach(node=>Object.setPrototypeOf(node,Object.create(Object.getPrototypeOf(node))));
            view.querySelector('form').onsubmit=e=>{e.preventDefault();window.saved=[...e.currentTarget.querySelectorAll('select,input,textarea')].map(n=>n.value)};
            view.dispatchEvent(new Event('viewshow',{bubbles:true}));
        });
        const painted=page.locator('.jfmod-dsPrefsHost');await painted.waitFor();
        await painted.getByRole('button',{name:'Save',exact:true}).click();await painted.getByRole('alert').waitFor();
        await painted.getByRole('combobox').click();await painted.getByRole('option',{name:'Ukrainian'}).click();
        await painted.getByRole('textbox',{name:'Code',exact:true}).fill('123456');
        await painted.getByRole('textbox',{name:'Custom CSS',exact:true}).fill('body { color: red; }');
        await painted.getByRole('button',{name:'Save',exact:true}).click();
        assert.deepEqual(await page.evaluate(()=>saved),['uk','123456','body { color: red; }']);
        await page.evaluate(()=>{const error=document.createElement('div');error.className='quickConnectError';error.textContent='The service rejected this code.';document.querySelector('#quickConnectPreferencesPage form').append(error)});
        await painted.getByRole('alert').filter({hasText:'The service rejected'}).waitFor();
        await page.evaluate(()=>document.getElementById('quickConnectPreferencesPage').remove());
        try { await page.waitForFunction(()=>mounts===unmounts&&timers.size===0&&observers.size===1); } catch(error) { console.log(await page.evaluate(()=>({mounts,unmounts,timers:timers.size,observers:observers.size}))); throw error; }
    }
    await page.evaluate(()=>ui.stopPrefs());
    assert.equal(await page.evaluate(()=>observers.size),0);
    // Safari can leave body focused after a tap; an outside pointer must still dismiss the sheet.
    await page.evaluate(()=>{document.activeElement.blur();ui.menu()});await page.getByRole('menu').waitFor();
    await page.locator('#outside').click();await page.getByRole('menu').waitFor({state:'detached'});
    for(const [image,mode,expected] of [['Primary','grid',0],['Primary','list',3],['Thumb','grid',3],['Banner','grid',3]]){
        await page.evaluate(({image,mode})=>ui.settings(image,mode),{image,mode});await page.getByRole('button',{name:'View Settings',exact:true}).click();
        assert.equal(await page.locator('input[name=ShowTitle],input[name=ShowYear],input[name=CardLayout]').count(),expected);
        await page.evaluate(()=>ui.clear());
    }
    await page.evaluate(()=>ui.signIn());await page.getByRole('button',{name:'Use Quick Connect'}).waitFor();
    for(const end of ['dismiss','back','failure','late','success','dismiss']){
        const before=await page.evaluate(()=>initiations);
        await page.getByRole('button',{name:'Use Quick Connect'}).click();await page.waitForFunction(before=>initiations===before+1,before);
        await page.locator('#quickConnectAlert').waitFor({state:'attached'});
        if(end==='dismiss')await page.evaluate(()=>dismissQuick());
        if(end==='back')await page.evaluate(()=>dismissQuick(true));
        if(end==='failure')await page.evaluate(async()=>{pollFailure=true;quickTick();await Promise.resolve();pollFailure=false});
        if(end==='late'){
            await page.evaluate(()=>{latePoll=true;quickTick()});await page.waitForFunction(()=>!!window.finishPoll);
            await page.evaluate(()=>{dismissQuick();finishPoll({Authenticated:true,Secret:'test-only'});latePoll=false});
        }
        if(end==='success')await page.evaluate(()=>{authenticated=true;quickTick()});
        await page.waitForFunction(()=>timers.size===0);await page.locator('#quickConnectAlert').waitFor({state:'detached'});
    }
    assert.equal(await page.evaluate(()=>logins),1);assert.equal(await page.evaluate(()=>failures),1);
    await page.evaluate(()=>ui.clear());
    await page.evaluate(()=>{
        document.body.style.background='#101010';
        const player=document.createElement('div');player.id='player';player.className='page';
        player.innerHTML='<div class="osdMainTextContainer"><span class="osdTitle"></span></div><div class="track"><input class="mdl-slider show-focus" type="range"></div>';document.body.append(player);ui.player();
    });
    assert.equal(await page.locator('.osdMainTextContainer').evaluate(n=>getComputedStyle(n).display),'none');
    await page.evaluate(()=>document.querySelector('.osdTitle').textContent='Audio title');
    await page.waitForFunction(()=>!document.querySelector('.osdMainTextContainer').classList.contains('jfmod-empty'));
    const resting=await page.locator('#player input').screenshot();
    await page.locator('#player input').focus();await page.waitForTimeout(250);
    const focused=await page.locator('#player input').screenshot();
    assert.ok(!resting.equals(focused),'seeking retains a visible focus cue');
    await page.evaluate(()=>{ui.stopPlayer();document.documentElement.className='layout-tv';const header=document.createElement('div');header.className='skinHeader';header.innerHTML='<div class="headerTabs">Tabs</div>';document.body.append(header)});
    assert.notEqual(await page.locator('.headerTabs').evaluate(n=>getComputedStyle(n).display),'none');
    await page.evaluate(()=>document.documentElement.classList.add('jfmod-chrome'));
    assert.equal(await page.locator('.headerTabs').evaluate(n=>getComputedStyle(n).display),'none');
    assert.deepEqual(errors,[]);
    console.log('PASS review fixes: inherited Preferences setters, validation/service errors, repeated page disposal, Safari body-focus dismissal, fixed-caption controls, Quick Connect dismissal/failure/late/completed retry, player empty-state class. Offline only.');
} finally {await browser.close();}
