// Keep unlocked account keys in the existing app, never in storage or messages.
// The frame remains mounted while hidden, preserving files and running jobs.
export function createXrdWorkspace({document:doc=globalThis.document,window:win=globalThis.window}={}){
  let host=null,frame=null,owner=null,returnFocus=null,previousOverflow='',previousInert=false;
  const visible=()=>Boolean(host&&!host.hidden);
  function hide(){
    if(!visible())return;
    host.hidden=true;
    doc.body.style.overflow=previousOverflow;
    const app=doc.querySelector('#app');if(app)app.inert=previousInert;
    if(returnFocus?.isConnected)returnFocus.focus();
  }
  function close(){
    hide();
    if(win.history.state?.yanxiXrdWorkspace)win.history.back();
  }
  function destroy(){
    close();host?.remove();host=null;frame=null;owner=null;returnFocus=null;
  }
  function syncOwner(nextOwner){if(host&&owner!==nextOwner)destroy();}
  function open(user=null){
    const nextOwner=user?.id||user?.username||'public';syncOwner(nextOwner);
    if(!host){
      owner=nextOwner;host=doc.createElement('section');host.hidden=true;
      host.className='xrd-workspace';host.setAttribute('role','dialog');host.setAttribute('aria-modal','true');host.setAttribute('aria-label','XRD 精修工作区');
      const bar=doc.createElement('header');bar.className='xrd-workspace-bar';
      const back=doc.createElement('button');back.type='button';back.className='button subtle';back.textContent='← 返回工作台';back.addEventListener('click',close);
      const text=doc.createElement('div');
      const title=doc.createElement('strong');title.textContent='XRD 结构精修';
      const account=doc.createElement('small');account.textContent=user?`当前账号：${user.displayName||user.username||'研究成员'} · 返回不退出登录`:'公开工具 · 返回公开文献';
      text.append(title,account);bar.append(back,text);
      frame=doc.createElement('iframe');frame.title='XRD 结构精修输入、结果与帮助';
      const frameUrl=new URL('./xrd-refinement.html?embedded=1',win.location.href);
      const version=new URL(import.meta.url).searchParams.get('v');if(version)frameUrl.searchParams.set('v',version);
      frame.src=frameUrl.href;
      host.append(bar,frame);doc.body.append(host);
    }
    if(visible())return;
    returnFocus=doc.activeElement;previousOverflow=doc.body.style.overflow;
    const app=doc.querySelector('#app');previousInert=Boolean(app?.inert);if(app)app.inert=true;
    doc.body.style.overflow='hidden';host.hidden=false;host.querySelector('button').focus();
    const url=new URL(win.location.href);url.hash='xrd';
    win.history.pushState({...win.history.state,yanxiXrdWorkspace:true},'',url.href);
  }
  const pop=()=>{
    if(!win.history.state?.yanxiXrdWorkspace){hide();return;}
    if(host&&!visible()){
      previousOverflow=doc.body.style.overflow;
      const app=doc.querySelector('#app');previousInert=Boolean(app?.inert);if(app)app.inert=true;
      doc.body.style.overflow='hidden';host.hidden=false;host.querySelector('button').focus();
    }
  };
  const message=event=>{
    if(event.origin!==win.location.origin||event.source!==frame?.contentWindow)return;
    if(event.data?.type==='yanxi-xrd-return')close();
  };
  win.addEventListener('popstate',pop);win.addEventListener('message',message);
  return {open,close,syncOwner,destroy};
}
