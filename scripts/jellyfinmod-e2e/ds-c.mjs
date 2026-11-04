// Local dsC browser integration: real React components + dialogHelper + focusManager, no server or credentials.
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium } from 'playwright';
const require = createRequire(import.meta.url);
const { build } = require('esbuild');
const sass = require('sass');
const repo = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const temp = await mkdtemp(path.join(tmpdir(), 'jfds-c-'));
const source = path.join(repo, 'src/apps/modern/features/jellyfinmod/design');
const mocks = {
    RootAppRouter: `const listeners = new Set(); const stack = []; export const history = {
        location: { pathname: '/', search: '', state: {} },
        listen(fn) { listeners.add(fn); return () => listeners.delete(fn); },
        push(url, state) { stack.push(this.location); this.location = { pathname: '/', search: '', state }; this.emit(); },
        replace(url, state) { this.location = { pathname: '/', search: '', state }; this.emit(); },
        back() { this.location = stack.pop() || {pathname:'/',search:'',state:{}}; this.emit(); },
        emit() { for (const fn of [...listeners]) fn({location:this.location}); }
    };`,
    layoutManager: `export default { get tv() { return document.documentElement.classList.contains('layout-tv'); },
        get mobile() { return document.documentElement.classList.contains('layout-mobile'); } };`,
    browser: 'export default { supportsCssAnimation: () => false };',
    inputManager: `export default { on: (node, fn) => node.addEventListener('command', fn), off: (node, fn) => node.removeEventListener('command', fn) };`,
    scrollManager: 'export default { isEnabled: () => false };',
    scrollHelper: 'export const centerFocus = {on() {}, off() {}};',
    keyboardNavigation: 'export const getKeyName = event => event.key;',
    dpadModals: `export const isBackKey = key => ['Escape', 'GoBack', 'BrowserBack'].includes(key);`,
    globalize: `export default {translate: key => ({ButtonCancel:'Cancel',ButtonOk:'OK'})[key] || key};`
};
let browser;
try {
    const result = await build({
        stdin: { contents: `import React from 'react'; import {createRoot} from 'react-dom/client'; import {flushSync} from 'react-dom';
            import {showDesignSheet} from '${source}/ActionSheet';
            import {showDesignDialog,showDesignPrompt} from '${source}/Dialogs';
            import {RemovalDialog} from '${source}/RemovalDialog';
            import {mountDialog,hasDesignPage} from '${source}/dialogHost';
            import {Select,Button,Input,Switch,DialogContent} from '${source}/Controls';
            import {Root} from '${source}/Root';
            import {Dialog} from '${source}/Dialog';
            import {useDeleteWarning} from '${source}/../hooks/useDeleteWarning';
            import loading from '${repo}/src/components/loading/loading';
            import helper from '${repo}/src/components/dialogHelper/dialogHelper';
            const reactHost = document.createElement('div'); document.body.appendChild(reactHost); const reactRoot=createRoot(reactHost);
            const sampleHost = document.createElement('div'); document.body.appendChild(sampleHost); const sampleRoot=createRoot(sampleHost);
            const Warning = () => {useDeleteWarning(document.body, 'Every version in this folder is deleted.');return null;};
            window.api = {sheet:showDesignSheet,dialog:showDesignDialog,prompt:showDesignPrompt,loading,helper,hasDesignPage,
              samples() {flushSync(()=>sampleRoot.render(React.createElement(Root,{className:'samples'},React.createElement(DialogContent,{title:'Controls',narrow:true},
                React.createElement(Button,{kind:'main'},'Save'),React.createElement(Button,null,'Cancel'),React.createElement(Button,{kind:'destroy'},'Delete'),
                React.createElement(Button,{disabled:true},'Refused'),React.createElement(Input,{label:'Name',value:'Example',onChange:()=>{}}),
                React.createElement(Switch,{label:'Enabled',checked:true,onChange:()=>{}})))));},
              warning() {flushSync(()=>reactRoot.render(React.createElement(Warning)));},
              reactDialog(value) {flushSync(()=>reactRoot.render(React.createElement(Dialog,{title:'Retention',close:()=>window.dsClosed=(window.dsClosed||0)+1},
                React.createElement(Select,{label:'Window',id:'nested-window',value,options:[{value:'1',label:'One day'},{value:'3',label:'Three days'}],onChange:()=>{}}))));},
              removal(plan) { const host=helper.createDialog({removeOnClose:true,scrollY:false});
                mountDialog(host,React.createElement(RemovalDialog,{plan,release:'Original.Release.Name',close:()=>helper.close(host),
                  choose:(id,blocklist)=>{window.result={id,blocklist};helper.close(host);}}),()=>helper.close(host)); return helper.open(host); },
              controls() { const root=createRoot(document.getElementById('controls')); flushSync(()=>root.render(React.createElement(Root,null,
                React.createElement(Select,{label:'Remove this episode',id:'window',value:'inherit',options:[{value:'inherit',label:'Series default'},{value:'3',label:'3 days after watching'}],onChange:value=>window.selected=value}),
                React.createElement(Button,{disabled:true,onClick:()=>window.refused=true},'Refused'),
                React.createElement(Input,{label:'Name',required:true,value:'',onChange:()=>{}})))); }
            };`, resolveDir: repo, loader: 'tsx' },
        bundle: true, write: false, format: 'iife', platform: 'browser', tsconfig: path.join(repo, 'tsconfig.json'),
        plugins: [{ name: 'app-environment', setup(builder) {
            builder.onResolve({filter: /\.(scss|css)$/}, args => ({path:args.path,namespace:'empty'}));
            builder.onLoad({filter:/.*/,namespace:'empty'},()=>({contents:'',loader:'js'}));
            builder.onResolve({filter: /(?:^|\/)(RootAppRouter|layoutManager|browser|inputManager|scrollManager|scrollHelper|keyboardNavigation|dpadModals|globalize)$/}, args => {
                const name=args.path.split('/').pop(); return {path:name,namespace:'mock'};
            });
            builder.onLoad({filter:/.*/,namespace:'mock'}, args => ({contents:mocks[args.path],loader:'js'}));
        }}]
    });
    const css = ['src/components/dialogHelper/dialoghelper.scss', 'src/components/loading/loading.scss',
        'src/apps/modern/features/jellyfinmod/shell/sharedChrome.scss', 'src/apps/modern/features/jellyfinmod/design/design.scss']
        .map(file => sass.compile(path.join(repo, file), {silenceDeprecations:['legacy-js-api','import','global-builtin','color-functions'], logger:{warn() {}}}).css).join('\n');
    browser = await chromium.launch({headless:true});
    const page = await browser.newPage({viewport:{width:1440,height:900}});
    const errors=[];
    page.on('pageerror', error => errors.push(error.message));
    await page.setContent('<html class="jfmod-chrome layout-desktop" data-theme="dark"><body><button id="opener">Open</button><div class="jfds" id="page"></div><div id="controls"></div></body></html>');
    await page.addStyleTag({content:css});
    await page.addScriptTag({content:result.outputFiles[0].text});
    const openSheet = async (options = {}) => {
        await page.locator('#opener').focus();
        await page.evaluate(options => { window.answer='pending'; window.api.sheet({items:[{id:'play',name:'Play',icon:'play_arrow'},{id:'current',name:'English',selected:true,asideText:'Atmos'},{divider:true},{id:'delete',name:'Delete Media',icon:'delete'}], ...options}).then(value=>window.answer=value,()=>window.answer='cancelled'); }, options);
        await page.locator('[data-ds-actionsheet]').waitFor();
    };
    await openSheet();
    assert.equal(await page.locator('.actionSheetContent,.MuiPaper-root,.actionSheetMenuItem').count(),0);
    assert.equal(await page.locator('.mi.sel > .tx0').textContent(),'English');
    assert.equal(await page.locator('.mi.redrow > svg').count(),1);
    assert.equal(await page.evaluate(()=>document.activeElement?.getAttribute('data-id')),'current');
    await page.keyboard.press('ArrowDown');
    assert.equal(await page.evaluate(()=>document.activeElement?.getAttribute('data-id')),'delete');
    await page.keyboard.press('Escape');
    await page.waitForFunction(()=>window.answer==='cancelled');
    assert.equal(await page.evaluate(()=>document.activeElement?.id),'opener');
    await openSheet({resolveOnClick:true});
    await page.locator('[data-id="play"]').click();
    await page.waitForFunction(()=>window.answer==='play');
    await page.locator('[data-ds-actionsheet]').waitFor({state:'detached'});
    // Phone: the last row remains reachable even on a short viewport; live layout and theme require no reload.
    await page.setViewportSize({width:390,height:400});
    await page.evaluate(()=>document.documentElement.className='jfmod-chrome layout-mobile');
    await openSheet({items:Array.from({length:40},(_,i)=>({id:String(i),name:'Entry '+i}))});
    assert.equal(await page.locator('.pmenu.sheet.bottom .sgrab').count(),1);
    const scroll=await page.locator('.pmenu').evaluate(node=>({height:node.clientHeight,scroll:node.scrollHeight,overflow:getComputedStyle(node).overflowY}));
    assert.ok(scroll.scroll>scroll.height && scroll.overflow==='auto');
    await page.locator('[data-id="39"]').click();
    await page.waitForFunction(()=>window.answer==='39');
    await page.locator('[data-ds-actionsheet]').waitFor({state:'detached'});
    await openSheet();
    await page.evaluate(()=>{document.documentElement.className='jfmod-chrome layout-tv';document.documentElement.dataset.theme='light';});
    await page.waitForSelector('.dialogportal.dev-tv[data-theme="light"] .pmenu:not(.sheet)');
    assert.equal(await page.locator('.dialogportal').evaluate(node=>getComputedStyle(node).fontSize),'20px');
    await page.keyboard.press('Escape');
    await page.waitForFunction(()=>window.answer==='cancelled');
    // Confirmations preserve button IDs and refusal, prompts preserve the submitted value.
    await page.setViewportSize({width:1440,height:900});
    await page.evaluate(()=>document.documentElement.className='jfmod-chrome layout-desktop');
    await page.evaluate(()=>{ void window.api.dialog({title:'Delete',text:'Only the selected file',buttons:[{id:'cancel',name:'Cancel',type:'cancel'},{id:'ok',name:'Delete',type:'delete'}]}).then(value=>window.answer=value); });
    await page.locator('.dialog .btn.destroy').click();
    await page.waitForFunction(()=>window.answer==='ok');
    await page.evaluate(()=>{ void window.api.prompt({title:'Name',label:'Name',value:'Old'}).then(value=>window.answer=value); });
    await page.getByRole('textbox',{name:'Name',exact:true}).fill('New');
    await page.getByRole('button',{name:'OK',exact:true}).click();
    await page.waitForFunction(()=>window.answer==='New');
    await page.evaluate(()=>window.api.controls());
    await page.locator('#window').click();
    await page.getByRole('option',{name:'3 days after watching'}).click();
    await page.waitForFunction(()=>window.selected==='3');
    await page.getByRole('button',{name:'Refused'}).click({force:true});
    assert.equal(await page.evaluate(()=>window.refused),undefined);
    await page.evaluate(()=>{ void window.api.removal({title:'Cancel Download',question:'Stop downloading?',facts:[{html:'42% downloaded'}],notes:['The library file stays.'],blocklist:true,choices:[{id:'delete',name:'Delete the Download',red:true},{id:'cancel',name:'Keep Downloading'}]}); });
    assert.equal(await page.evaluate(()=>document.activeElement?.getAttribute('data-choice')),'cancel');
    await page.getByRole('switch',{name:'Blocklist this release'}).click();
    await page.locator('[data-choice="delete"]').click();
    assert.deepEqual(await page.evaluate(()=>window.result),{id:'delete',blocklist:true});
    await page.evaluate(()=>window.api.loading.show());
    assert.equal(await page.locator('.loadingportal .docspinner .mdl-spinner__layer').count(),4);
    await page.evaluate(()=>window.api.loading.hide());
    assert.equal(await page.locator('.loadingportal').count(),0);
    // A nested field's Back leaves its dialog open. A rerender keeps one history/focus scope.
    await page.evaluate(()=>window.api.reactDialog('1'));
    await page.locator('#nested-window').click();
    await page.keyboard.press('Escape');
    await page.getByRole('option').first().waitFor({state:'detached'});
    assert.equal(await page.locator('[data-ds-dialog]').count(),1);
    await page.evaluate(()=>window.api.reactDialog('3'));
    assert.equal(await page.locator('.jfmod-designDialogHost').count(),1);
    await page.evaluate(()=>{void window.api.dialog({title:'Child',text:'Nested',buttons:[{id:'ok',name:'OK'}]}).catch(()=>{});});
    await page.keyboard.press('Escape');
    await page.getByRole('dialog',{name:'Child'}).waitFor({state:'detached'});
    assert.equal(await page.locator('[data-ds-dialog]').count(),1);
    await page.keyboard.press('Escape');
    await page.waitForFunction(()=>window.dsClosed===1);
    // The multi-version warning follows exactly the title's More -> Delete -> confirmation sequence.
    await page.evaluate(()=>{window.api.warning();document.getElementById('opener').classList.add('btnMoreCommands');});
    await page.locator('#opener').click();
    await openSheet();
    await page.locator('.mi[data-id="delete"]').click();
    await page.waitForFunction(()=>window.answer==='delete');
    await page.evaluate(()=>{void window.api.dialog({title:'Delete Media',text:'Delete the folder?',buttons:[{id:'cancel',name:'Cancel'},{id:'ok',name:'Delete',type:'delete'}]}).catch(()=>{});});
    await page.locator('[data-ds-text] .jfmod-deleteWarning').waitFor();
    assert.equal(await page.locator('.jfmod-deleteWarning').textContent(),'Every version in this folder is deleted.');
    await page.keyboard.press('Escape');
    await page.locator('[data-ds-dialog]').waitFor({state:'detached'});
    await openSheet({items:[{id:'no',name:'Refused',disabled:true}],timeout:500});
    await page.locator('.mi[data-id="no"]').click({force:true});
    assert.equal(await page.evaluate(()=>window.answer),'pending');
    await page.waitForFunction(()=>window.answer==='cancelled');
    // Player menus stay dark, including the legacy TV player with no visible bar/root.
    await page.setViewportSize({width:1280,height:720});
    await page.evaluate(()=>{document.documentElement.className='jfmod-chrome jfmod-chromePlayer layout-tv';document.getElementById('page').classList.remove('jfds');});
    assert.equal(await page.evaluate(()=>window.api.hasDesignPage()),true);
    await openSheet({titleButton:{id:'jfds-back',title:'Quality',icon:'arrow_back'}});
    assert.equal(await page.locator('.dialogportal').getAttribute('data-theme'),'dark');
    assert.equal(await page.evaluate(()=>document.activeElement?.getAttribute('aria-label')),'Quality');
    await page.keyboard.press('Escape');
    await page.waitForFunction(()=>window.answer==='cancelled');
    // Active loading crosses to upstream presentation when the shell leaves for admin.
    await page.evaluate(()=>window.api.loading.show());
    await page.evaluate(()=>document.documentElement.classList.remove('jfmod-chrome'));
    await page.locator('.loadingportal').waitFor({state:'detached'});
    assert.equal(await page.locator('body > .docspinner.mdlSpinnerActive').count(),1);
    await page.evaluate(()=>window.api.loading.hide());
    assert.equal(await page.evaluate(()=>window.api.hasDesignPage()),false);
    assert.deepEqual(errors,[]);
    // Compare the port against the read-only source CSS, without needing a running mockup server.
    const mockup = process.env.DS_MOCKUP || path.resolve(repo,'../../../../reviews/design-system');
    const rawCss = (await Promise.all([path.resolve(mockup,'../tmdb-search-design/mockup/chrome.css'),path.join(mockup,'spinner.css'),path.join(mockup,'ds.css')]
        .map(file=>readFile(file,'utf8')))).join('\n');
    const reference = await browser.newPage();
    const metrics = async (target, prefix='') => target.evaluate(prefix => {
        const out={};
        for (const selector of ['.dialog','.dlghead','.dlgbody','.btn.main','.btn:not(.main):not(.destroy):not(.dis)','.btn.destroy','.btn.dis','.fld .box','.sw','.sw i']) {
            const node=document.querySelector(prefix+selector); const style=getComputedStyle(node);
            out[selector]=Object.fromEntries(['paddingTop','paddingRight','paddingBottom','paddingLeft','fontSize','fontWeight','color','backgroundColor','borderRadius','boxShadow','lineHeight'].map(key=>[key,style[key]]));
            if (!['.dialog','.dlghead','.dlgbody'].includes(selector)) out[selector].height=node.getBoundingClientRect().height;
        }
        return out;
    },prefix);
    for (const [device,width,height,layout] of [['computer',1440,900,'desktop'],['tablet',768,1024,'desktop'],['phone',390,844,'mobile'],['tv',1280,720,'tv'],['tv',1920,1080,'tv']]) {
        for (const theme of ['dark','light']) {
            await page.setViewportSize({width,height}); await reference.setViewportSize({width,height});
            await page.evaluate(({layout,theme})=>{document.documentElement.className='jfmod-chrome layout-'+layout;document.documentElement.dataset.theme=theme;window.api.samples();},{layout,theme});
            await page.waitForFunction(({device,theme})=>{
                const root=document.querySelector('.samples');return root.classList.contains('dev-'+device)&&root.dataset.theme===theme;
            },{device,theme});
            await page.waitForTimeout(400);
            const html=await page.locator('.samples .dialog').evaluate(node=>node.outerHTML);
            await reference.setContent(`<html class="dev-${device} layout-${layout}" data-theme="${theme}"><head><style>${rawCss}</style></head><body><div class="frame">${html}</div></body></html>`);
            assert.deepEqual(await metrics(page,'.samples '),await metrics(reference),`${device} ${width} ${theme}: copied dialog/control CSS`);
        }
    }
    await reference.close();
    console.log('dsC: menu structure, selection, keyboard, dismissal, phone scrolling, live device/theme, confirmation, prompt, fields, refusal, safe focus, switch, spinner and admin boundary passed.');
} finally {
    await browser?.close();
    await rm(temp,{recursive:true,force:true});
}
