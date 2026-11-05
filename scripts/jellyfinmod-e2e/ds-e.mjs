// Offline dsE integration: native surfaces and existing client/action controllers. No server, credentials or network.
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium } from 'playwright';
const require = createRequire(import.meta.url);
const { build } = require('esbuild');
const sass = require('sass');
const repo = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const source = path.join(repo, 'src/apps/modern/features/jellyfinmod');
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

mocks.useApi = `export const useApi=()=>({api:window.client,user:{Id:'viewer',Policy:{IsAdministrator:true}},__legacyApiClient__:{serverId:()=> 'server'}});`;
mocks.useUserViews = `export const useUserViews=()=>({isSuccess:true,data:{Items:[{Id:'movies',Name:'Movies',CollectionType:'movies'}]}});`;
mocks.qualityProfiles = `export const profileSummary=p=>p.qualities.join(' · ');`;
mocks.Page = `import React from 'react'; export default ({children,id})=>React.createElement('div',{id,'data-role':'page'},children);`;
mocks.MissingChildren = `export const episodePath=(id,s,e)=>'/episode/'+id+'/'+s+'/'+e;export const seasonPath=(id,s)=>'/season/'+id+'/'+s;`;
mocks.appRouter = `export const appRouter={getRouteUrl:()=> '#/movies'};`;
mocks.toast = `export default text=>window.toasts.push(text);`;
mocks.confirm = `import {showDesignDialog} from '${source}/design/Dialogs';export default o=>showDesignDialog({...o,buttons:[{id:'cancel',name:'Cancel'},{id:'yes',name:o.confirmText,type:o.primary}]}).then(v=>v==='yes'?undefined:Promise.reject());`;
mocks.actionSheet = `import {showDesignSheet} from '${source}/design/ActionSheet';export default {show:showDesignSheet};`;
const result = await build({
    stdin:{contents:`import React from 'react';import {createRoot} from 'react-dom/client';import {flushSync} from 'react-dom';
        import {QueryClient,QueryClientProvider} from '@tanstack/react-query';
        import QueuePage from '${source}/components/QueuePage';
        import {ReleasePicker} from '${source}/design/ReleasePicker';
        import {removeWithDialog} from '${source}/integration/queueActions';
        import EpisodeWindowDialog from '${source}/components/EpisodeWindowDialog';
        import {paintDownloadMark} from '${source}/components/DownloadStateMark';
        import {Root} from '${source}/design/Root';
        import focusManager from '${repo}/src/components/focusManager';
        const client=new QueryClient({defaultOptions:{queries:{retry:false},mutations:{retry:false}}});
        const root=createRoot(document.getElementById('app'));
        window.ui={down(){focusManager.moveDown(document.activeElement)},up(){focusManager.moveUp(document.activeElement)},queue(){flushSync(()=>root.render(React.createElement(QueryClientProvider,{client},React.createElement(QueuePage))));},
            picker(intent){client.clear();flushSync(()=>root.render(React.createElement(QueryClientProvider,{client},React.createElement(ReleasePicker,{api:window.client,entryId:'entry',mediaType:'movie',episodes:[],title:'The Matrix (1999)',intent,close:()=>window.ui.clear()}))));},
            clear(){flushSync(()=>root.render(null));},
            remove(row){window.removed=null;removeWithDialog(window.client,row).then(value=>window.removed=value);},
            retention(){const Widget=()=>{const [value,set]=React.useState('inherit');return React.createElement(EpisodeWindowDialog,{open:true,value,busy:false,onClose:()=>window.ui.clear(),onChange:next=>{window.retention=next;set(next)}})};flushSync(()=>root.render(React.createElement(Widget)));},
            marks(){flushSync(()=>root.render(React.createElement(Root,null,['queued','downloading','stalled','importing','failed','seeding','releasing'].map(kind=>React.createElement('span',{key:kind,ref:node=>node&&paintDownloadMark(node,{kind,percent:42,text:'42%',tooltip:kind},'row')})))));}
        };`,resolveDir:repo,loader:'tsx'},bundle:true,write:false,format:'iife',platform:'browser',tsconfig:path.join(repo,'tsconfig.json'),
    plugins:[{name:'environment',setup(b){
        b.onResolve({filter:/\.(scss|css)$/},a=>({path:a.path,namespace:'empty'}));b.onLoad({filter:/.*/,namespace:'empty'},()=>({contents:'',loader:'js'}));
        b.onResolve({filter:/(?:^|\/)(RootAppRouter|layoutManager|browser|inputManager|scrollManager|scrollHelper|keyboardNavigation|dpadModals|globalize|useApi|useUserViews|Page|MissingChildren|appRouter|toast|confirm|actionSheet|qualityProfiles)$/},a=>({path:a.path.split('/').pop(),namespace:'mock'}));
        b.onLoad({filter:/.*/,namespace:'mock'},a=>({contents:mocks[a.path],loader:'js',resolveDir:repo}));
        b.onResolve({filter:/\.svg\?raw$/},a=>({path:path.resolve(a.resolveDir,a.path.replace('?raw','')),namespace:'raw'}));
        b.onLoad({filter:/.*/,namespace:'raw'},async a=>({contents:'export default '+JSON.stringify(await readFile(a.path,'utf8')),loader:'js'}));
    }}]
});
const css=['src/components/dialogHelper/dialoghelper.scss','src/apps/modern/features/jellyfinmod/design/design.scss'].map(file=>sass.compile(path.join(repo,file),{logger:{warn(){}},silenceDeprecations:['import','global-builtin','color-functions']}).css).join('\n');
const browser=await chromium.launch({headless:true});
try {
    const page=await browser.newPage({viewport:{width:1440,height:900}});
    page.setDefaultTimeout(10000);
    const errors=[];page.on('pageerror',e=>{errors.push(e.message);console.error('PAGE',e.message)});
    await page.route('**/*',async route=>{if(route.request().resourceType()==='image')await new Promise(r=>setTimeout(r,500));await route.abort()});
    await page.setContent('<html class="jfmod-chrome layout-desktop" data-theme="dark"><body style="margin:0"><button id="opener">Open</button><div id="app"></div></body></html>');
    // A real origin lets the unchanged preference code read localStorage, with all network blocked.
    await page.evaluate(()=>{window.toasts=[];window.writes=[];window.reads=[];
        const now=new Date().toISOString();
        const row={id:'row',grabId:'grab',entry:{id:'entry',title:'The Matrix',year:1999,mediaType:'movie',jellyfinItemId:null,posterPath:'/missing.jpg'},episode:null,
            releaseTitle:'The.Matrix.1999.2160p.WEB-DL.HEVC',state:'downloading',importState:'waiting',reason:null,message:null,progress:.42,sizeBytes:7400000000,downloadedBytes:3100000000,
            downloadRateBytes:38000000,etaSeconds:420,observedAt:now,stalledSince:null,versionLabel:'2160p',intent:'acquire',client:{id:'client',name:'Transmission',openUrl:'https://client.invalid/'},seeding:null,
            createdAt:now,updatedAt:now,canDeleteFiles:true,pack:null};
        window.row=row;window.list={items:[row],totalRecordCount:1,generatedAt:now,clientStatus:{reachable:true},importEnabled:true,seedReleaseEnabled:true};
        const candidate={releaseId:'release',rawTitle:row.releaseTitle,indexerId:'one',indexerName:'Indexer One',detailsUrl:'https://indexer.invalid/',size:7400000000,seeders:121,
            eligible:true,rejections:[],score:870,inLibrary:false,heldQuality:false,freeleech:true,proper:true,parsed:{resolution:'2160p',source:'webdl',codec:'h265',hdr:'DV HDR10',audio:'DD+ Atmos',audioChannels:'5.1',languages:['EN'],subtitles:['EN','FR']}};
        window.candidate=candidate;
        window.search={searchId:'search',intent:'addVersion',createdAt:now,expiresAt:new Date(Date.now()+3600000).toISOString(),target:{entryId:'entry',title:'The Matrix',mediaType:'movie',scope:'movie'},
            profile:{id:'profile',name:'4K',revision:1,inherited:true},grab:{available:true,holdSeconds:10,activeOperationId:null,modes:['fill','add','replace'],heldFiles:1},
            candidates:[candidate,{...candidate,releaseId:'rejected',eligible:false,rejections:[{message:'Below the profile minimum.'}]}],eligibleCount:1,rejectedCount:1,
            indexers:[{indexerId:'one',name:'Indexer One',status:'ok',resultCount:2,colorIndex:0},{indexerId:'two',name:'Indexer Two',status:'failed',resultCount:0,message:'Timed out.',colorIndex:1}],partial:true,truncated:false};
        window.operation={id:'grab',state:'pending',active:true,cancellable:true,entryId:'entry',releaseTitle:row.releaseTitle,indexerName:'Indexer One',size:7400000000,holdUntil:new Date(Date.now()+60000).toISOString(),message:'Held',mode:'add'};
        const dataFor=(url,config)=>{
            if(url.endsWith('/Health'))return {Name:'JellyfinMod',Version:'1',Ok:true,Capabilities:['queue','releases','acquisition.packs']};
            if(url.endsWith('/Queue'))return window.list;
            if(url.endsWith('/Settings/QualityProfiles'))return [{id:'profile',name:'4K',qualities:['webdl-2160p'],isDefault:true,revision:1},{id:'phone',name:'Phones',qualities:['webdl-1080p'],isDefault:false,prefer:'everywhere',revision:1}];
            if(url.endsWith('/Settings/Indexers'))return [{id:'one',name:'Indexer One',enabled:true,colorIndex:0},{id:'two',name:'Indexer Two',enabled:true,colorIndex:1}];
            if(url.endsWith('/Settings/Acquisition'))return {downloadClientId:'client'};
            if(url.endsWith('/Settings/DownloadClients'))return [{id:'client',name:'Transmission',openUrl:'https://client.invalid/'}];
            if(url.includes('/Releases/Progress/'))return null;
            if(url.endsWith('/Releases'))return window.search;
            if(url.includes('/Grabs/'))return window.operation;
            throw Error('Unexpected GET '+url);
        };
        window.client={basePath:'https://offline.invalid',axiosInstance:{
            get:async(url,config)=>{window.reads.push({url,params:config?.params?.toString()});return {status:200,data:dataFor(url,config)}},
            post:async(url,body)=>{window.writes.push({method:'POST',url,body});if(url.endsWith('/Cancel'))window.operation={...window.operation,state:'cancelled',active:false};return {data:window.operation}},
            delete:async(url,config)=>{window.writes.push({method:'DELETE',url,body:config.data});if(window.refuse&&config.data.deleteFiles){window.refuse=false;throw {response:{data:{type:'delete_not_allowed',title:'Its files are in your library.'}}}}return {data:{}}}
        }};
    });
    await page.addStyleTag({content:css});await page.addScriptTag({content:result.outputFiles[0].text});
    await page.evaluate(()=>ui.queue());
    await page.locator('.qrow').waitFor();
    assert.equal(await page.locator('.qrow > .th > img[loading="lazy"]').count(),1);
    await page.locator('.qrow .fallback').waitFor();
    assert.equal(await page.locator('.qrow .dm.downloading').count(),1);
    await page.locator('.qdisc').hover();await page.locator('.qtip').waitFor({state:'visible'});
    assert.match(await page.locator('.qtip').innerText(),/Downloading/);
    await page.locator('.qrow .ib').click();await page.locator('[data-ds-actionsheet]').waitFor();
    await page.locator('[data-id="remove"]').click();await page.locator('.jfmod-removeDialog').waitFor();
    assert.equal(await page.locator('[data-choice="cancel"]').evaluate(n=>n===document.activeElement),true);
    await page.locator('[data-choice="cancel"]').click();await page.locator('.jfmod-removeDialog').waitFor({state:'detached'});
    assert.equal(await page.evaluate(()=>writes.length),0);
    // The same destructive controller must preserve permission, blocklist, retry refusal and safe outcomes.
    await page.evaluate(()=>{window.refuse=true;ui.remove(row)});await page.locator('.jfmod-removeDialog').waitFor();
    await page.getByRole('switch',{name:'Blocklist this release'}).click();
    await page.locator('[data-choice="delete"]').click();
    await page.waitForFunction(()=>document.querySelector('[data-ds-note]')?.textContent.includes('Its files are in your library'));
    assert.equal(await page.locator('[data-choice="delete"]').count(),0);
    await page.locator('[data-choice="keep"]').click();await page.waitForFunction(()=>window.removed===true);
    const requests=await page.evaluate(()=>writes.filter(x=>x.method==='DELETE'));
    assert.deepEqual(requests.map(x=>x.body),[{removeFromClient:true,deleteFiles:true,blocklist:true},{removeFromClient:true,deleteFiles:false,blocklist:false}]);
    await page.evaluate(()=>{writes=[];ui.remove({...row,importState:'held'})});await page.waitForFunction(()=>writes.length===1);
    assert.match((await page.evaluate(()=>writes[0])).url,/Grabs\/grab\/Cancel$/);
    await page.evaluate(()=>{writes=[];window.operation={...window.operation,state:'pending',active:true};ui.picker('addVersion')});await page.locator('.rel').first().waitFor();
    assert.equal(await page.locator('.pickerDialog .formDialogHeader, .pickerDialog .MuiSelect-select').count(),0);
    await page.locator('#jfmod-releaseProfile').click();await page.getByRole('option',{name:/Phones/}).waitFor();
    assert.match(await page.getByRole('option',{name:/Phones/}).innerText(),/1080/);
    await page.keyboard.press('Escape');await page.getByRole('button',{name:'Sources',exact:true}).click();
    await page.locator('.srcmenu .srow').first().waitFor();
    await page.locator('.srcmenu .inf').click();await page.locator('.ipop').waitFor();
    await page.keyboard.press('Escape');await page.locator('.ipop').waitFor({state:'detached'});assert.equal(await page.locator('.srcmenu').count(),1);
    await page.locator('[data-jfmod-source="two"]').click();
    assert.equal(await page.locator('[data-jfmod-source="one"]').getAttribute('aria-disabled'),'true');
    await page.keyboard.press('Escape');await page.locator('.srcmenu').waitFor({state:'detached'});
    await page.getByRole('button',{name:'Show Names',exact:true}).click();assert.match(await page.locator('.rel > .rname').first().innerText(),/score 870/);
    await page.locator('.rejt').click();await page.locator('.rejrows .rel').waitFor();
    await page.locator('.rejrows .rel').press('Enter');assert.equal(await page.evaluate(()=>writes.length),0);
    await page.locator('.rels:not(.rejrows) [data-jfmod-release-add="release"]').click();
    await page.locator('.grab').waitFor();await page.locator('[data-jfmod-release-x="release"]').click();
    await page.waitForFunction(()=>writes.some(x=>x.url.endsWith('/Cancel')));
    const grab=await page.evaluate(()=>writes.find(x=>x.url.endsWith('/Releases/Grab')));
    assert.equal(grab.body.releaseId,'release');assert.equal(grab.body.mode,'add');assert.ok(grab.body.idempotencyKey);
    await page.evaluate(()=>ui.clear());
    // Every mark state, live theme/layout switching, phone ratio fallback, sources scrolling and TV stops.
    for(const [device,width] of [['computer',1440],['tablet',768],['phone',390],['tv',1280],['tv',1920]]){
        await page.setViewportSize({width,height:900});
        await page.evaluate(device=>{document.documentElement.className='jfmod-chrome layout-'+(device==='phone'?'mobile':device==='tv'?'tv':'desktop');ui.marks()},device);
        await page.locator('.jfds.dev-'+device).waitFor();
        assert.equal(await page.locator('.dm').count(),7);assert.equal(await page.locator('.dm.failed .glyph [stroke-width="4.4"]').count(),1);
        const sizes=await page.locator('.dm').evaluateAll(nodes=>nodes.map(n=>[n.offsetWidth,n.offsetHeight]));assert.ok(sizes.every(([w,h])=>w>0&&w===h));
        await page.evaluate(()=>document.documentElement.dataset.theme='light');await page.locator('.jfds[data-theme="light"]').waitFor();
        await page.evaluate(()=>document.documentElement.dataset.theme='dark');
        await page.evaluate(device=>{if(device==='tv'&&!search.candidates.some(x=>x.releaseId==='next'))search.candidates.splice(1,0,{...candidate,releaseId:'next',score:869});ui.picker('addVersion')},device);await page.locator('.rel').first().waitFor();
        if(device==='phone')assert.equal(await page.locator('.rel').first().locator(':scope > .rl').count(),3);
        const openClient=page.locator('.pickerDialog [aria-label="Open Transmission"]');if(device!=='tv')await openClient.waitFor();await page.waitForTimeout(100);assert.equal(await openClient.count(),device==='tv'?0:1,'Open Transmission is in the picker except on the TV');if(device!=='tv')assert.equal(await openClient.getAttribute('data-tip'),'Open Transmission');
        if(device==='tv'){
            const row=page.locator('[data-jfmod-release-row="release"]');
            await row.focus();await row.press('ArrowRight');
            assert.equal(await page.locator('[data-jfmod-release-add="release"]').evaluate(n=>n===document.activeElement),true);
            await page.keyboard.press('ArrowRight');
            assert.equal(await page.locator('[data-jfmod-release-replace="release"]').evaluate(n=>n===document.activeElement),true);
            await page.keyboard.press('ArrowLeft');await page.keyboard.press('ArrowLeft');
            assert.equal(await row.evaluate(n=>n===document.activeElement),true);
            await page.locator('.rejt').click();const rejected=page.locator('[data-jfmod-release-row="rejected"]');await rejected.waitFor();
            await rejected.focus();await rejected.press('ArrowRight');await page.keyboard.press('Enter');
            await page.locator('[data-ds-dialog]:not(.pickerDialog)').waitFor();
            await page.getByRole('button',{name:'Cancel',exact:true}).click();
            const next=page.locator('[data-jfmod-release-row=next]');
            await next.focus();await page.evaluate(()=>ui.up());
            assert.equal(await row.evaluate(n=>n===document.activeElement),true,'real focus manager arrives on row');
            await row.press('ArrowRight');await page.evaluate(()=>ui.down());
            assert.equal(await next.evaluate(n=>n===document.activeElement),true,'Down from action reaches next row');
            await rejected.focus();
            await page.evaluate(()=>{operation={...operation,state:'pending',active:true};document.activeElement.dispatchEvent(new CustomEvent('command',{bubbles:true,cancelable:true,detail:{command:'right'}}))});
            assert.equal(await page.locator('[data-jfmod-release-add="rejected"]').evaluate(n=>n===document.activeElement),true);
            await row.focus();await row.press('ArrowRight');await page.keyboard.press('Enter');
            await page.locator('[data-jfmod-release-x="release"]').waitFor();
            await row.focus();await row.press('ArrowRight');
            assert.equal(await page.locator('[data-jfmod-release-x="release"]').evaluate(n=>n===document.activeElement),true);
            const before=await page.evaluate(()=>writes.filter(x=>x.url.endsWith('/Cancel')).length);
            await page.keyboard.press('Enter');await page.waitForFunction(before=>writes.filter(x=>x.url.endsWith('/Cancel')).length>before,before);
        }
        const actions=await page.locator('.ract').first().evaluate(n=>[...n.children].map(c=>c.getBoundingClientRect().toJSON()));
        assert.ok(actions[0].right<=actions[1].left+1,'Add and Replace remain beside each other');
        if(process.env.DS_SHOTS&&['computer','phone'].includes(device))await page.screenshot({path:process.env.DS_SHOTS+'/'+device+'-picker.png'});
        await page.evaluate(()=>ui.queue());await page.locator('.qrow').waitFor();
        if(device==='phone'){
            await page.locator('.q-s > .rb').click();await page.locator('.ipop').waitFor();
            await page.waitForTimeout(450);const box=await page.locator('.ipop').boundingBox();assert.ok(Math.abs(box.width-width*.9)<1,'source phone popover spans the viewport between its 5% gutters');
            await page.keyboard.press('Escape');await page.locator('.ipop').waitFor({state:'detached'});
        }
        if(device==='tv'){
            await page.locator('.qrow').focus();await page.keyboard.press('Enter');await page.locator('[data-ds-actionsheet]').waitFor();
            await page.keyboard.press('Escape');await page.locator('[data-ds-actionsheet]').waitFor({state:'detached'});
            assert.equal(await page.locator('.qrow').evaluate(n=>n===document.activeElement),true);
        }
        await page.evaluate(()=>ui.clear());
    }
    for(const [state,deletable,choice,expected] of [['downloading',false,'keep',false],['failed',true,'keep',false],['seeding',false,'keep',false]]){
        await page.evaluate(({state,deletable})=>{writes=[];ui.remove({...row,state,canDeleteFiles:deletable})},{state,deletable});
        await page.locator('.jfmod-removeDialog').waitFor();
        assert.equal(await page.locator('[data-choice=delete]').count(),deletable?1:0);
        if(state==='seeding')assert.equal(await page.getByRole('switch').count(),0);
        await page.locator('[data-choice='+choice+']').click();await page.waitForFunction(()=>window.removed===true);
        assert.equal(await page.evaluate(()=>writes[0].body.deleteFiles),expected);
    }
    await page.evaluate(()=>ui.retention());await page.locator('#jfmod-episode-window').click();
    await page.getByRole('option',{name:'3 days after watching',exact:true}).click();assert.equal(await page.evaluate(()=>window.retention),'3');
    await page.locator('[data-jfmod-window-done]').click();await page.locator('.jfmod-windowDialog').waitFor({state:'detached'});
    assert.deepEqual(errors,[]);
    console.log('PASS dsE: Queue, picker, sources, marks, retention control, removal request/refusal/cancel; computer/tablet/phone/TV; live theme/layout. Offline only.');
} finally {await browser.close();}
