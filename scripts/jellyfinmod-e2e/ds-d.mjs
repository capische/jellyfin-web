// Offline dsD integration: source template, native React markup and existing select/playback-start logic. No server or credentials.
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
const feature = path.join(repo, 'src/apps/modern/features/jellyfinmod');
const mocks = {
    layoutManager: `export default { get tv(){return document.documentElement.classList.contains('layout-tv')},get mobile(){return document.documentElement.classList.contains('layout-mobile')} };`,
    browser: 'export default {supportsCssAnimation:()=>false};',
    inputManager: `export default {on:(n,f)=>n.addEventListener('command',f),off:(n,f)=>n.removeEventListener('command',f)};`,
    scrollManager: 'export default {isEnabled:()=>false};',
    scrollHelper: 'export const centerFocus={on(){},off(){}};',
    keyboardNavigation: 'export const getKeyName=event=>event.key;',
    dpadModals: `export const isBackKey=key=>['Escape','GoBack','BrowserBack'].includes(key);`,
    loading: 'export default {show(){window.loading=true},hide(){window.loading=false}};',
    globalize: "export default {translate:key=>key,getCurrentDateTimeLocale:()=> 'en-US'};"
};
const result = await build({
    stdin:{contents:`import React from 'react'; import {createRoot} from 'react-dom/client'; import {flushSync} from 'react-dom';
        import {TitlePage} from '${feature}/design/TitlePage';
        import FileChooser,{useTrackStrip} from '${feature}/components/FileChooser';
        import FileHistoryPopover from '${feature}/components/FileHistoryPopover';
        import RatingsGroup from '${feature}/components/RatingsGroup';
        import {setTitleSources} from '${feature}/design/titleModel';
        import focusManager from '${repo}/src/components/focusManager';
        import {DownloadMark} from '${feature}/design/StateMark';
        import {Pending} from '${feature}/design/Pending';
        import {Root} from '${feature}/design/Root';
        import {withPlaybackStart} from '${feature}/integration/playbackStart';
        import Events from '${repo}/src/utils/events';
        const view=document.getElementById('itemDetailPage');
        const host=document.createElement('div'); host.className='jfmod-dsTitleHost'; view.append(host); view.classList.add('jfmod-dsTitle');
        const root=createRoot(host); const widget=createRoot(document.getElementById('widgets'));
        const versions=['aaaa','bbbb'].map((id,i)=>({mediaSourceId:id,jellyfinItemId:id,bindingId:id,label:i?'1080p':'2160p',resolution:i?'1080p':'2160p',
            videoCodec:i?'h264':'hevc',videoRange:i?'SDR':'HDR',bitDepth:i?8:10,sizeBytes:i?15000000000:55000000000,isDefault:!i,phoneCopy:!!i,retention:null}));
        const Chooser=()=>{const strip=useTrackStrip(view,true);const [history,setHistory]=React.useState(null);const closeHistory=React.useCallback(()=>setHistory(null),[]);return React.createElement(React.Fragment,null,strip&&React.createElement(FileChooser,{view,strip,versions,preferred:versions[1],busy:false,
            pin:()=>({kept:false,title:'Keep'}),onPin:()=>window.pins=(window.pins||0)+1,canRemove:()=>true,onRemove:()=>window.removes=(window.removes||0)+1,
            removeDate:()=>null,onHistory:(version,anchor)=>setHistory({version,anchor}),
            pending:React.createElement('div',{className:'pend'},'Pending'),note:'Whole folder delete warning'}),
            history&&React.createElement(FileHistoryPopover,{...history,history:[],onClose:closeHistory}));};
        let starting; const manager={};
        window.api={render(type='Movie'){flushSync(()=>root.render(React.createElement(TitlePage,{view,type,art:''})));},
            sources(){setTitleSources(view,[{Id:'aaaa',Size:55000000000,MediaStreams:[{Type:'Video',Width:3840,Height:2160,Codec:'hevc'},{Type:'Audio',Codec:'truehd',Profile:'Atmos'}]},
                {Id:'bbbb',Size:15000000000,MediaStreams:[{Type:'Video',Width:1920,Height:1080,Codec:'h264'},{Type:'Audio',Codec:'aac'}]}]);},
            right(){focusManager.moveRight(document.activeElement)},
            ratings(ratings,sources=['imdb','tomatoes_critic','trakt']){flushSync(()=>widget.render(React.createElement(Root,null,React.createElement('div',{className:'meta'},React.createElement(RatingsGroup,{ratings,sources,ready:!!ratings,wanted:true})))));},
            chooser(){flushSync(()=>widget.render(React.createElement(Chooser)));},
            mark(kind){flushSync(()=>widget.render(React.createElement('div',{className:'jfds'},React.createElement(DownloadMark,{size:'page',progress:{kind,percent:42,text:'42%',tooltip:'42%'}}))));},
            pending(){flushSync(()=>widget.render(React.createElement(Root,null,React.createElement('div',{className:'vlist',style:{width:'20em'}},React.createElement(Pending,{
                id:'pending',quality:'4K Remux',size:'64.0 GB',mark:React.createElement(DownloadMark,{size:'row',progress:{kind:'downloading',percent:42,text:'42%',tooltip:'42%',plus:true}}),
                state:React.createElement('span',{className:'dlf'},'42% · 12 min left'),flag:'Replaces 2160p',action:React.createElement('button',{className:'rb red focusable'},'X')})))));},
            start(){window.startResult=null;withPlaybackStart(manager,true,()=>new Promise((resolve,reject)=>{starting={resolve,reject}})).then(v=>window.startResult=v,e=>window.startResult=e.message)},
            event(name){Events.trigger(manager,name)},settle(reject=false){reject?starting.reject(new Error('rejected')):starting.resolve('original-result')},
            listeners(){return Object.values(manager._callbacks||{}).reduce((sum,list)=>sum+list.length,0)},
            destroy(){flushSync(()=>widget.unmount());flushSync(()=>root.unmount())}};`,resolveDir:repo,loader:'tsx'},
    bundle:true,write:false,format:'iife',platform:'browser',tsconfig:path.join(repo,'tsconfig.json'),
    plugins:[{name:'app-environment',setup(builder){
        builder.onResolve({filter:/\.(scss|css)$/},args=>({path:args.path,namespace:'empty'}));
        builder.onLoad({filter:/.*/,namespace:'empty'},()=>({contents:'',loader:'js'}));
        builder.onResolve({filter:/(?:^|\/)(layoutManager|browser|inputManager|scrollManager|scrollHelper|keyboardNavigation|dpadModals|loading|globalize)$/},args=>({path:args.path.split('/').pop(),namespace:'mock'}));
        builder.onLoad({filter:/.*/,namespace:'mock'},args=>({contents:mocks[args.path],loader:'js'}));
    }}]
});
const css = [path.join(repo,'src/styles/librarybrowser.scss'),...['design/design.scss','components/ratings.scss','integration/playbackStart.scss'].map(file=>path.join(feature,file))]
    .map(file=>sass.compile(file,{silenceDeprecations:['import','global-builtin','color-functions'],logger:{warn(){}}}).css).join('\n');
const template = await readFile(path.join(repo,'src/apps/legacy/controllers/itemDetails/index.html'),'utf8');
const browser = await chromium.launch({headless:true});
try {
    const page = await browser.newPage({viewport:{width:1440,height:900}});
    await page.route('**/*',route=>route.abort());
    const errors=[];page.on('pageerror',error=>errors.push(error.message));
    await page.setContent(`<html class="jfmod-chrome layout-desktop" data-theme="dark"><head><style>body{margin:0}.hide{display:none!important}${css}</style></head><body>${template}<div id="widgets"></div></body></html>`);
    await page.evaluate(()=>{
        const view=document.getElementById('itemDetailPage');
        view.querySelector('.nameContainer').innerHTML='<h1>The Matrix</h1>';
        view.querySelector('.itemMiscInfo-primary').innerHTML='<span>1999</span><span class="mediaInfoOfficialRating">R</span>';
        view.querySelector('.overview').textContent='An ordinary computer programmer discovers the truth.';
        view.querySelector('.detailImageContainer').innerHTML='<img src="data:image/svg+xml,%3Csvg xmlns=\'http://www.w3.org/2000/svg\' width=\'200\' height=\'300\'%3E%3C/svg%3E">';
        for(const cls of ['btnPlay','btnPlaystate','btnUserRating','btnMoreCommands']){const button=view.querySelector('.'+cls);button.classList.remove('hide');button.title=cls;button.onclick=()=>window.lastCommand=cls;}
        view.querySelector('.trackSelections').classList.remove('hide');
        view.querySelector('.selectSource').innerHTML='<option value="aaaa">2160p</option><option value="bbbb">1080p</option>';
        view.querySelector('.selectAudio').innerHTML='<option value="1">English</option><option value="2">Ukrainian</option>';
        view.querySelector('.selectSubtitles').innerHTML='<option value="-1">Off</option><option value="4">English</option>';
        for(const select of view.querySelectorAll('select'))select.addEventListener('change',()=>window.trackChange={source:view.querySelector('.selectSource').value,audio:view.querySelector('.selectAudio').value,subtitle:view.querySelector('.selectSubtitles').value});
        const section=view.querySelector('#castCollapsible');section.classList.remove('hide');section.querySelector('#castContent').innerHTML='<div class="card personCard" data-type="Person" data-id="person"><div class="cardText">Keanu Reeves</div><div class="cardText">Neo</div></div>';
    });
    await page.addScriptTag({content:result.outputFiles[0].text});
    await page.evaluate(()=>window.api.sources());
    await page.evaluate(()=>window.api.render());
    const painted=page.locator('.jfmod-dsTitleHost');
    assert.equal(await painted.locator('.dhead .col h1').innerText(),'The Matrix');
    assert.equal(await painted.locator('.card,.cardBox,.MuiButton-root').count(),0);
    assert.equal(await page.locator('.detailPageWrapperContainer').isVisible(),false);
    assert.equal(await painted.locator('.cell.c > .tile > .post').count(),1);
    await painted.locator('[data-ds-command~=btnPlay]').click();
    assert.equal(await page.evaluate(()=>window.lastCommand),'btnPlay');
    const played = painted.locator('[data-ds-command~=btnPlaystate]');
    await played.focus();
    await played.evaluate(node => { window.focusedPlayed = node; });
    await page.evaluate(() => {
        const source = document.querySelector('.detailPageWrapperContainer .btnPlaystate');
        source.classList.add('playstatebutton-played');
        source.title = 'Mark unplayed';
    });
    await page.waitForFunction(() => window.focusedPlayed?.getAttribute('aria-pressed') === 'true');
    assert.equal(await page.evaluate(() => document.activeElement === window.focusedPlayed && window.focusedPlayed.isConnected), true);
    await page.evaluate(() => {
        const source = document.querySelector('.detailPageWrapperContainer .btnPlaystate');
        source.classList.remove('playstatebutton-played');
        source.title = 'btnPlaystate';
    });
    await page.waitForFunction(() => window.focusedPlayed?.getAttribute('aria-pressed') === 'false');
    await painted.locator('[data-jfmod-track-field=Audio]').click();
    await painted.getByRole('option',{name:'Ukrainian'}).click();
    assert.equal(await page.evaluate(()=>window.trackChange.audio),'2');
    await painted.locator('[data-jfmod-track-field=Subtitles]').focus();
    await page.keyboard.press('Enter');
    await painted.getByRole('option',{name:'English',exact:true}).focus();
    await page.keyboard.press('Enter');
    assert.equal(await page.evaluate(()=>window.trackChange.subtitle),'4');
    assert.equal(await painted.locator('.vlist').count(),0);
    // Exercise the controller's own command functions and dispatch bridge, without rewriting their playback logic here.
    const controller=await readFile(path.join(repo,'src/apps/legacy/controllers/itemDetails/index.js'),'utf8');
    const methods=controller.slice(controller.indexOf('    function getPlayOptions('),controller.indexOf('    function onPlayerChange('));
    const bridge=controller.slice(controller.indexOf('        const designCommand = event =>'),controller.indexOf("        view.addEventListener('viewdestroy', () => view.removeEventListener('ds-title-command'"));
    assert(methods.includes('function onMoreCommandsClick()')&&bridge.includes("view.addEventListener('ds-title-command'"));
    await page.addScriptTag({content:`(()=>{const view=document.getElementById('itemDetailPage');
        const currentItem={Id:'title',Type:'Movie',UserData:{PlaybackPositionTicks:12345}};const ItemAction={Resume:'resume'};
        const playbackManager={play(options){window.playOptions=options},shuffle(item){window.shuffled=item}};
        const getApiClient=()=>({getCurrentUserId:()=> 'user',getItem:async(user,id)=>({Id:id}),getCurrentUser:async()=>({Id:'user'})});
        const getContextMenuOptions=(item,user,button)=>({item,user,positionTo:button});
        const itemContextMenu={show:async options=>{window.moreOpener=options.positionTo;window.moreItem=options.item.Id;return {}}};
        ${methods}\n${bridge}})();`});
    await painted.locator('[data-ds-command~=btnPlay]').click();
    assert.deepEqual(await page.evaluate(()=>({source:window.playOptions.mediaSourceId,audio:window.playOptions.audioStreamIndex,subtitle:window.playOptions.subtitleStreamIndex,ticks:window.playOptions.startPositionTicks})),
        {source:'aaaa',audio:'2',subtitle:'4',ticks:12345});
    await painted.locator('[data-ds-command~=btnMoreCommands]').click();
    await page.waitForFunction(()=>window.moreOpener?.closest('.jfmod-dsTitleHost .actbar'));
    assert.equal(await page.evaluate(()=>window.moreItem),'aaaa');
    await painted.locator('.seg.v').click();
    assert.doesNotMatch(await painted.locator('.vlist').innerText(),/Atmos|TrueHD|AAC/);
    await painted.getByRole('option',{name:'1080p',exact:false}).click();
    assert.equal(await page.evaluate(()=>window.trackChange.source),'bbbb');
    // The focus manager must discover real native card stops, including inert person cards.
    await page.evaluate(()=>{
        const cast=document.getElementById('castContent');const second=cast.firstElementChild.cloneNode(true);
        second.dataset.id='person2';second.querySelector('.cardText').textContent='Carrie-Anne Moss';cast.append(second);
    });
    await page.waitForFunction(()=>document.querySelectorAll('.jfmod-dsTitleHost .cell.c').length===2);
    await painted.locator('.cell').first().focus();
    await page.evaluate(()=>window.api.right());
    assert.equal(await page.evaluate(()=>document.activeElement?.getAttribute('data-id')),'person2');
    // A TV card has no upstream overlay button. Its new disc forwards the real shortcut Play command.
    const shortcuts=await readFile(path.join(repo,'src/components/shortcuts.js'),'utf8');
    const cardInfo=shortcuts.slice(shortcuts.indexOf('function getItemInfoFromCard('),shortcuts.indexOf('function showPlayMenu('));
    const execute=shortcuts.slice(shortcuts.indexOf('function executeAction('),shortcuts.indexOf('function addToPlaylist('));
    const onCommand=shortcuts.slice(shortcuts.indexOf('function onCommand('),shortcuts.indexOf('export function on('));
    assert(cardInfo.includes('PlaybackPositionTicks')&&execute.includes('playbackManager.play')&&onCommand.includes('executeAction'));
    await page.addScriptTag({content:`(()=>{const dom={parentWithClass:(n,c)=>n.closest('.'+c),parentWithAttribute:(n,a)=>n.closest('['+a+']')};
        const ItemAction={Play:'play',Resume:'resume'};const playbackManager={canPlay:()=>true,play:options=>{window.cardPlay=options}};
        const userSettings={getSortValuesLegacy:key=>{window.cardSortKey=key;return {sortBy:'PremiereDate',sortOrder:'Descending'}}};
        ${cardInfo}\n${execute}\n${onCommand}
        const section=document.getElementById('similarCollapsible');section.classList.remove('hide');const list=section.querySelector('.itemsContainer');list.dataset.parentid='folder';
        list.innerHTML='<div class="card" data-id="movie2" data-type="Movie" data-serverid="server" data-mediatype="Video" data-positionticks="65432"><div class="cardText">Another movie</div><div class="cardText">2003</div></div>';
        list.addEventListener('command',onCommand);list.firstElementChild.addEventListener('pointerover',()=>window.preparedCard=true);
    })();`});
    const nativeCard=painted.locator('.cell[data-id=movie2]');
    await nativeCard.hover();
    await nativeCard.locator('.disc').click();
    assert.deepEqual(await page.evaluate(()=>window.cardPlay),{ids:['movie2'],startPositionTicks:65432,serverId:'server',queryOptions:{SortBy:'PremiereDate',SortOrder:'Descending'}});
    assert.equal(await page.evaluate(()=>window.cardSortKey),'items-folder-Folder');
    assert.equal(await page.evaluate(()=>window.preparedCard),true);
    await page.evaluate(()=>document.querySelector('#similarCollapsible .card').insertAdjacentHTML('beforeend',
        '<span class="jfmod-mark--none" title="Not Downloaded"></span><span class="jfmod-dlmark" data-jfmod-kind="downloading" title="40%"><svg class="jfmod-dlmark-fill" style="stroke-dashoffset:60"></svg></span><span class="jfmod-dlBar-fill" style="width:40%"></span>'));
    await nativeCard.locator('.cmark .dm.downloading').waitFor();
    assert.equal(await nativeCard.locator('[data-ds-progress] i').evaluate(node=>node.style.width),'40%','live download wins over the old cloud and keeps its bar');
    await page.evaluate(()=>{
        const card=document.querySelector('#similarCollapsible .card');card.querySelector('.jfmod-dlmark').remove();card.querySelector('.jfmod-dlBar-fill').remove();
        const mark=card.querySelector('.jfmod-mark--none');mark.className='jfmod-mark--countdown';mark.innerHTML='<span class="jfmod-countdown">2d</span>';
    });
    await page.waitForFunction(()=>document.querySelector('.jfmod-dsTitleHost .cell[data-id=movie2] .mark .num')?.textContent==='2d');
    const before=await painted.locator('.poster').boundingBox();
    await painted.locator('.poster img').evaluate(node=>node.dispatchEvent(new Event('error')));
    await painted.locator('.poster .fallback').waitFor();
    const after=await painted.locator('.poster').boundingBox();
    assert.equal(Math.round(before.height),Math.round(after.height));
    assert.equal(await painted.locator('.poster .fallback').count(),1);
    await page.evaluate(()=>window.api.chooser());
    await page.waitForFunction(()=>document.querySelector('.selectSource').value==='bbbb');
    await page.evaluate(()=>document.querySelector('.trackSelections').classList.add('hide'));
    await painted.locator('.gpk').waitFor({state:'hidden'});
    await page.evaluate(()=>document.querySelector('.trackSelections').classList.remove('hide'));
    await painted.locator('.gpk').waitFor({state:'visible'});
    await painted.locator('.gpk .seg.v').click();
    assert.equal(await painted.locator('.vlist .vrow').count(),2);
    assert.match(await painted.locator('.vlist').innerText(),/Whole folder delete warning/);
    assert.doesNotMatch(await painted.locator('.vlist .vrow').first().innerText(),/AAC|Atmos|5\.1/);
    await painted.locator('[data-jfmod-file-pin]').first().click();
    assert.equal(await page.evaluate(()=>window.pins),1);
    assert.equal(await painted.locator('.vlist').count(),1);
    await painted.locator('[data-jfmod-file-history]').first().click();
    await page.locator('.historyportal').waitFor();
    await page.keyboard.press('Escape');
    await page.locator('.historyportal').waitFor({state:'detached'});
    assert.equal(await painted.locator('.vlist').count(),1,'Back closes history alone');
    assert.equal(await page.evaluate(()=>document.activeElement.hasAttribute('data-jfmod-file-history')),true);
    await painted.locator('[data-jfmod-file-history]').first().click();
    await page.locator('.historyportal').waitFor();
    await page.evaluate(()=>window.dispatchEvent(new CustomEvent('command',{cancelable:true,detail:{command:'back'}})));
    await page.locator('.historyportal').waitFor({state:'detached'});
    assert.equal(await painted.locator('.vlist').count(),1,'remote Back closes history alone');
    await painted.locator('[data-jfmod-media-source-id=aaaa]').focus();await page.keyboard.press('Enter');
    assert.equal(await page.evaluate(()=>document.querySelector('.selectSource').value),'aaaa');
    assert.equal(await painted.locator('.vlist').count(),0);
    const stable=await page.evaluate(()=>{const slot=document.querySelector('[data-ds-slot=tracks]');slot._identity=true;return true});assert(stable);
    for(const [layout,device,width,height] of [['mobile','phone',390,844],['tv','tv',1280,720],['desktop','tablet',768,1024],['desktop','computer',1440,900]]){
        await page.setViewportSize({width,height});
        await page.evaluate(layout=>{document.documentElement.className='jfmod-chrome layout-'+layout;document.documentElement.dataset.theme='light'},layout);
        await page.waitForFunction(device=>document.querySelector('.jfmod-dsTitleHost .jfds').classList.contains('dev-'+device),device);
        assert.equal(await page.evaluate(()=>document.querySelector('[data-ds-slot=tracks]')._identity),true);
        assert.equal(await painted.locator('.gpk .seg.v').count(),1);
        if(device==='tv')assert.equal(await nativeCard.locator('[tabindex="-1"]:not(.focusable)').count(),1,'TV card holds one focus stop');
        if(device==='phone'||device==='tv')await painted.locator('.gpk.stacked').waitFor();
        if(device==='phone'||device==='tv')assert.equal(await painted.locator('.gpk.stacked').count(),1);
    }
    for(const type of ['Series','Season','Episode','Person']){
        await page.evaluate(type=>{window.api.render(type);document.getElementById('itemDetailPage').dispatchEvent(new CustomEvent('ds-title-update',{detail:{type,art:''}}));},type);
        assert.equal(await painted.locator('.dhead').count(),1);
        assert.equal(await painted.locator('.poster.wide').count(),type==='Episode'?1:0);
    }
    for(const event of ['playbackstart','playbackerror','playbackcancelled','playbackstop']){
        await page.evaluate(()=>window.api.start());assert.equal(await page.locator('.jfmod-playbackStart').count(),1);
        await page.evaluate(event=>window.api.event(event),event);assert.equal(await page.locator('.jfmod-playbackStart').count(),0);
        assert.equal(await page.evaluate(()=>window.api.listeners()),0);
        await page.evaluate(()=>window.api.settle());await page.waitForFunction(()=>window.startResult==='original-result');
    }
    await page.evaluate(()=>{window.api.start();window.api.settle(true)});await page.waitForFunction(()=>window.startResult==='rejected');
    assert.equal(await page.locator('.jfmod-playbackStart').count(),0);
    await page.evaluate(()=>{window.api.start();window.dispatchEvent(new Event('hashchange'))});
    assert.equal(await page.locator('.jfmod-playbackStart').count(),0);assert.equal(await page.evaluate(()=>window.api.listeners()),0);
    await page.evaluate(()=>window.api.settle());
    // Compare the painted source controls with the untouched mockup CSS, on every device/theme.
    const mockup=process.env.DS_MOCKUP || path.resolve(repo,'../../../../reviews/design-system');
    const rawCss=(await Promise.all([path.resolve(mockup,'../tmdb-search-design/mockup/chrome.css'),path.join(mockup,'spinner.css'),path.join(mockup,'ds.css')].map(file=>readFile(file,'utf8')))).join('\n');
    const reference=await browser.newPage();await reference.route('**/*',route=>route.abort());
    const metrics=(target,prefix='')=>target.evaluate(prefix=>{
        const result={};for(const selector of ['.dhead','.itemName','.meta','.actbar','.actbar .play','.actbar .dbtn','.gpk','.seg.v','.seg.v .val','.seg.v .cap']){
            const node=document.querySelector(prefix+selector);if(!node)throw new Error('Missing '+prefix+selector);
            const style=getComputedStyle(node);result[selector]=Object.fromEntries(['fontSize','fontWeight','lineHeight','color','backgroundColor','borderRadius','paddingTop','paddingRight','paddingBottom','paddingLeft'].map(key=>[key,style[key]]));
        }return result;
    },prefix);
    for(const [device,layout,width,height] of [['computer','desktop',1440,900],['tablet','desktop',768,1024],['phone','mobile',320,800],['phone','mobile',375,812],['phone','mobile',390,844],['phone','mobile',414,896],['tv','tv',1280,720],['tv','tv',1920,1080]]){
        for(const theme of ['dark','light']){
            await page.setViewportSize({width,height});await reference.setViewportSize({width,height});
            await page.evaluate(({layout,theme})=>{document.documentElement.className='jfmod-chrome layout-'+layout;document.documentElement.dataset.theme=theme},{layout,theme});
            await page.waitForFunction(({device,theme})=>{const root=document.querySelector('.jfmod-dsTitleHost .jfds');return root.classList.contains('dev-'+device)&&root.dataset.theme===theme},{device,theme});
            await page.mouse.move(0,0);await reference.mouse.move(0,0);
            const html=await painted.locator('.jfds').innerHTML();
            await reference.setContent(`<html class="shots dev-${device} layout-${layout}" data-theme="${theme}"><head><style>${rawCss}</style></head><body><div class="frame">${html}</div></body></html>`);
            await page.waitForTimeout(400);await reference.waitForTimeout(400);
            if(process.env.DS_D_SHOTS && ((device==='computer'&&theme==='dark')||(device==='phone'&&theme==='light')||(device==='tv'&&width===1280&&theme==='dark')))await page.screenshot({path:path.join(process.env.DS_D_SHOTS,`${device}-${width}-${theme}.png`),fullPage:true});
            assert.deepEqual(await metrics(page,'.jfmod-dsTitleHost '),await metrics(reference),`${device} ${width} ${theme}: source head/pill/picker recipes`);
        }
    }
    // The native phone list remains usable through its final entry.
    await page.setViewportSize({width:390,height:844});
    await page.evaluate(()=>{document.documentElement.className='jfmod-chrome layout-mobile';window.api.pending()});
    await page.locator('#widgets .pend.narrow').waitFor();
    const pendingLines=await page.locator('#widgets .pend').evaluate(node=>{
        const state=node.querySelector('.dlf').getBoundingClientRect();const flag=node.querySelector('.flag').getBoundingClientRect();
        return {state:state.top,bottom:state.bottom,flag:flag.top,text:node.querySelector('.flag').textContent};
    });
    assert(pendingLines.flag>=pendingLines.bottom-1,'narrow pending flag has its own third line');
    assert(!pendingLines.text.startsWith('·'),'narrow pending flag has no leading dot');
    await page.evaluate(()=>{document.querySelector('.selectAudio').innerHTML=Array.from({length:40},(_,i)=>'<option value="'+i+'">Language '+i+'</option>').join('')});
    await painted.locator('[data-jfmod-track-field=Audio]').click();
    for(let i=0;i<39;i++)await page.keyboard.press('ArrowDown');
    assert.equal(await page.evaluate(()=>document.activeElement.textContent.trim()),'Language 39');
    assert(await painted.locator('.vlist').evaluate(node=>node.scrollTop>0),'phone list scrolls to its final entry');
    await page.keyboard.press('Enter');
    assert.equal(await page.evaluate(()=>document.querySelector('.selectAudio').value),'39');
    // Real RatingsGroup keeps its reserve, stale/provenance data, toggle/Back and held-focus behavior on source markup.
    await page.evaluate(()=>{
        document.documentElement.className='jfmod-chrome layout-tv';
        window.api.ratings([{source:'imdb',value:8.7,scale:'ten',provider:'mdblist',fetchedAt:'2026-11-01T00:00:00Z',stale:true,votes:250000},
            {source:'tomatoes_critic',value:83,scale:'percent',provider:'tmdb',stale:false},
            {source:'trakt',value:85,scale:'percent',provider:'mdblist',stale:false}]);
    });
    const ratings=page.locator('#widgets .rgroup:not([aria-hidden=true])');
    await ratings.waitFor();
    assert.equal(await ratings.locator('[data-jfmod-rating=imdb]').evaluate(node=>getComputedStyle(node).opacity),'0.55');
    await ratings.focus();
    assert.equal(await page.locator('#widgets .rmenu.open').count(),0);
    await page.keyboard.press('Enter');
    await page.locator('#widgets .rmenu.open').waitFor();
    assert.equal(await page.locator('#widgets .rmenu .jfmod-ratingsHidden').count(),3);
    assert(await page.locator('#widgets .rmenu .jfmod-ratingsHidden').first().evaluate(node=>getComputedStyle(node).position==='absolute'&&node.getBoundingClientRect().width<=1),
        'provenance stays available to assistive technology without becoming visible popup copy');
    assert.equal(await ratings.evaluate(node=>node.dispatchEvent(new CustomEvent('command',{bubbles:true,cancelable:true,detail:{command:'back'}}))),false,'ratings consumes remote Back');
    await page.locator('#widgets .rmenu.open').waitFor({state:'detached'});
    await page.evaluate(()=>window.api.ratings([],[]));
    assert.equal(await ratings.count(),1,'a focused rating group keeps its values until focus leaves');
    await painted.locator('.actbar .play').focus();
    await page.waitForFunction(()=>getComputedStyle(document.querySelector('#widgets .rgwrap')).display==='none');
    await page.evaluate(()=>{window.api.pending();window.api.ratings(undefined,['metacritic','tmdb','rogerebert'])});
    const reserve=page.locator('#widgets .rgroup[data-ds-reserve-stack]');
    await reserve.waitFor({state:'attached'});
    assert.equal(await reserve.evaluate(node=>node.classList.contains('focusable')),false,'a hidden reserve is no TV focus stop');
    assert(await reserve.evaluate(node=>node.getBoundingClientRect().width< [...node.querySelectorAll('.ritem')].reduce((sum,item)=>sum+item.getBoundingClientRect().width,0)),
        'fallback reserves the widest rating, not their sum');
    await reference.close();
    assert.deepEqual(errors,[]);
    console.log('dsD: native heads/actions/cards; source selects and version choices; video-only facts; binding actions; image fallback; live device/theme and persistent slots; playback-start cleanup passed.');
} finally {await browser.close();}
