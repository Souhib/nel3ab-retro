import { SwitchInput, SWITCH_AXES, SWITCH_BUTTONS, SWITCH_TARGETS, type SwitchTarget, type SwitchAxis, type SwitchButton } from "../../../front/src/media/switch";
import type { Session } from "../../../front/src/media/session";

const labels: Record<SwitchTarget,string> = {
  A:"A",B:"B",X:"X",Y:"Y",L:"L · épaule gauche",R:"R · épaule droite",ZL:"ZL · gâchette gauche",ZR:"ZR · gâchette droite",
  PLUS:"+ · pause",MINUS:"−",LS:"Clic du stick gauche",RS:"Clic du stick droit",UP:"Croix · haut",DOWN:"Croix · bas",LEFT:"Croix · gauche",RIGHT:"Croix · droite",
  "lx+":"Stick gauche · droite","lx-":"Stick gauche · gauche","ly+":"Stick gauche · haut","ly-":"Stick gauche · bas",
  "rx+":"Stick droit · droite","rx-":"Stick droit · gauche","ry+":"Stick droit · haut","ry-":"Stick droit · bas",
};
const physical = ["Bas · A Xbox / ✕ PlayStation","Droite · B Xbox / ○ PlayStation","Gauche · X Xbox / □ PlayStation","Haut · Y Xbox / △ PlayStation","L1 / LB","R1 / RB","L2 / LT","R2 / RT","Select / Share","Start / Options","Clic gauche","Clic droit","Croix haut","Croix bas","Croix gauche","Croix droite"];
const keyName=(code:string|undefined)=>code ? ({ArrowLeft:"←",ArrowRight:"→",ArrowUp:"↑",ArrowDown:"↓",Enter:"Entrée",Backspace:"Retour arrière"}[code] ?? code.replace(/^Key|^Digit/,"")) : "Non assigné";
const el=(id:string)=>document.getElementById(id)!;
export function setup(source:SwitchInput, session:()=>Session|null, notice:(text:string)=>void) {
  const dialog=el("setup") as HTMLDialogElement;
  const choices=el("setup-device") as HTMLSelectElement;
  const names=el("setup-profiles") as HTMLSelectElement;
  const name=el("setup-name") as HTMLInputElement;
  const file=el("setup-file") as HTMLInputElement;
  let frame:number|null=null;
  let lastDevices="",lastNames="",lastMessage="";
  let after: (()=>void)|null=null;
  const rows=new Map<SwitchTarget,{row:HTMLElement; key:HTMLButtonElement; pad:HTMLButtonElement}>();
  for(const target of SWITCH_TARGETS) {
    const row=document.createElement("div");row.className="binding-row";row.dataset.target=target;
    const label=document.createElement("strong");label.textContent=labels[target];
    const make=(kind:"key"|"pad")=>{
      const group=document.createElement("div");group.className="binding-source";
      const button=document.createElement("button");button.type="button";button.dataset.bind=kind;button.setAttribute("aria-label",`${labels[target]} : changer ${kind==="key"?"la touche":"la commande physique"}`);
      button.onclick=()=>source.begin(target,kind);
      const clear=document.createElement("button");clear.type="button";clear.className="clear-binding";clear.textContent="×";clear.setAttribute("aria-label",`${labels[target]} : effacer ${kind==="key"?"la touche":"la commande physique"}`);clear.onclick=()=>{source.clear(target,kind);};
      group.append(button,clear);row.append(group);return button;
    };
    row.append(label);const key=make("key"),pad=make("pad");el("setup-bindings").append(row);rows.set(target,{row,key,pad});
  }
  // Native SVG belongs to this prototype, so its buttons can follow the exact
  // canonical state. It adds no raster or rendering work to the video loop.
  const svg=el("switch-diagram");
  const ns="http://www.w3.org/2000/svg";
  const buttonSpots:Record<SwitchButton,[number,number,string]>={
    A:[350,132,"A"],B:[322,160,"B"],X:[322,104,"X"],Y:[294,132,"Y"],
    L:[96,44,"L"],R:[320,44,"R"],ZL:[96,18,"ZL"],ZR:[320,18,"ZR"],
    MINUS:[173,100,"−"],PLUS:[243,100,"+"],LS:[99,117,"L3"],RS:[264,200,"R3"],
    UP:[155,166,"▲"],DOWN:[155,210,"▼"],LEFT:[133,188,"◀"],RIGHT:[177,188,"▶"],
  };
  for(const [key,[x,y,label]] of Object.entries(buttonSpots)) {
    const g=document.createElementNS(ns,"g");g.dataset.button=key;g.setAttribute("transform",`translate(${x} ${y})`);
    const circle=document.createElementNS(ns,"circle");circle.setAttribute("r",["LS","RS"].includes(key)?"22":"16");
    const text=document.createElementNS(ns,"text");text.textContent=label;text.setAttribute("dy","5");g.append(circle,text);svg.append(g);
  }
  function refresh() {
    if(!dialog.open) {frame=null;return;}
    if(!session())source.poll(new Set(),navigator.getGamepads?.()??[]);
    const pad=source.pad,device=source.device();
    const signature=JSON.stringify(source.pads.map(p=>[p.index,p.id]));
    if(signature!==lastDevices) {
      choices.replaceChildren(new Option("Première manette détectée","auto"),...source.pads.map(p=>new Option(`${p.index+1} · ${p.id}`,String(p.index))));
      choices.value=source.selected===null?"auto":String(source.selected);lastDevices=signature;
    }
    const profileNames=Object.keys(source.named).sort();
    if(JSON.stringify(profileNames)!==lastNames) {const previous=names.value;names.replaceChildren(new Option("Choisir un profil…",""),...profileNames.map(n=>new Option(n,n)));names.value=previous;lastNames=JSON.stringify(profileNames);}
    el("setup-detected").textContent=pad ? device ? `${pad.id} · ${pad.mapping==="standard"?"disposition standard":"disposition apprise"}` : `${pad.id} · disposition inconnue : assigne les commandes ci-dessous.` : "Clavier disponible. Branche une manette puis appuie sur un bouton pour la détecter.";
    el("setup-seat").textContent=session()?.getSnapshot().input.port ? `Joueur ${session()!.getSnapshot().input.port} · commandes retenues pendant la configuration` : "Prépare tes commandes avant de prendre une place";
    for(const [target,{row,key,pad:button}] of rows) {
      key.textContent=source.capturing?.target===target && source.capturing.source==="key"?"Appuie sur une touche…":keyName(source.profile.keys[target]);
      const isButton=SWITCH_BUTTONS.includes(target as SwitchButton);
      const binding=isButton?device?.buttons[target as SwitchButton]:device?.sticks[target.slice(0,2) as SwitchAxis];
      button.disabled=pad===null;
      button.textContent=source.capturing?.target===target && source.capturing.source==="pad"?"Actionne la commande…":binding ? "button" in binding ? (pad?.mapping==="standard"?physical[binding.button]:null)??`Bouton ${binding.button}` : `Axe ${binding.axis}${"sign" in binding ? binding.sign<0?" · inversé":"":" · gâchette"}` : "Non assigné";
      const axis=target.slice(0,2) as SwitchAxis;
      const lit=isButton?Boolean(source.reading.buttons&(1<<SWITCH_BUTTONS.indexOf(target as SwitchButton))):source.reading[axis]*(target.endsWith("+")?1:-1)>.15;
      row.dataset.lit=String(lit);row.dataset.waiting=String(source.capturing?.target===target);
    }
    for(const [i,key] of SWITCH_BUTTONS.entries()) svg.querySelector(`[data-button="${key}"]`)?.setAttribute("data-lit",String(Boolean(source.reading.buttons&(1<<i))));
    for(const [id,x,y,ax,ay] of [["LS",99,117,"lx","ly"],["RS",264,200,"rx","ry"]] as const) svg.querySelector(`[data-button="${id}"]`)?.setAttribute("transform",`translate(${x+source.reading[ax]*10} ${y-source.reading[ay]*10})`);
    el("setup-output").textContent=SWITCH_AXES.map(axis=>`${axis} ${Math.round(source.reading[axis]*100)} %`).join(" · ");
    if((el("setup-diagnostic") as HTMLDetailsElement).open)el("setup-raw").textContent=JSON.stringify({physique:source.raw,commandes_interpretees:source.reading, sortie_vers_le_jeu:"neutre pendant la configuration"},null,2);
    if(source.message!==lastMessage) {el("setup-message").textContent=source.message;lastMessage=source.message;}
    frame=requestAnimationFrame(refresh);
  }
  function open(callback:(()=>void)|null=null) {
    after=callback;session()?.input.blockGameplay(true);dialog.showModal();el("setup-confirm").textContent=callback?"Valider et jouer":"Reprendre";
    if(frame===null)frame=requestAnimationFrame(refresh);
  }
  function close() {
    const callback=after;after=null;source.releaseBeforePlay();session()?.input.blockGameplay(false);dialog.close();callback?.();
  }
  dialog.addEventListener("cancel",event=>{event.preventDefault();if(source.capturing){source.cancel();source.message="Assignation annulée.";}else{after=null;close();}});
  // close() releases the input synchronously. The native close event runs later;
  // clearing held keys again here swallowed the first new press (browser test).
  dialog.addEventListener("close",()=>{if(frame!==null)cancelAnimationFrame(frame);frame=null;});
  el("configure").onclick=()=>open();el("setup-confirm").onclick=close;
  choices.onchange=()=>{source.cancel();source.selected=choices.value==="auto"?null:Number(choices.value);};
  el("setup-reset").onclick=()=>attempt(()=>source.reset(),"Configuration d’origine restaurée. Tes profils enregistrés sont conservés.");
  const attempt=(action:()=>void,message:string)=>{try{action();source.message=message;}catch(error){source.message=error instanceof Error?error.message:"La configuration n’a pas pu être enregistrée.";}};
  el("setup-save").onclick=()=>attempt(()=>source.save(name.value),"Profil enregistré dans ce navigateur. Exporte-le pour le retrouver sur un autre appareil.");
  el("setup-load").onclick=()=>attempt(()=>source.load(names.value),"Profil chargé. Vérifie les correspondances avant de reprendre.");
  el("setup-export").onclick=()=>{
    const url=URL.createObjectURL(new Blob([JSON.stringify(source.profile,null,2)],{type:"application/json"}));const link=document.createElement("a");link.href=url;link.download="nel3ab-switch-profil.json";link.click();setTimeout(()=>URL.revokeObjectURL(url),1000);notice("Profil exporté.");
  };
  el("setup-import").onclick=()=>file.click();file.onchange=async()=>{const chosen=file.files?.[0];if(chosen){if(chosen.size>100000)source.message="Le fichier est trop grand.";else{const text=await chosen.text();attempt(()=>source.import(text),"Profil importé. Vérifie les commandes sur ta manette.");}}file.value="";};
  const test=el("setup-key-test");
  test.onkeydown=e=>{if(source.capturing || ["Tab","Escape"].includes(e.code))return; if(source.handlesKey(e.code)){e.preventDefault();source.previewKeys.add(e.code);}};
  test.onkeyup=e=>source.previewKeys.delete(e.code);test.onblur=()=>source.previewKeys.clear();
  // Before joining, InputStream has not installed its key listener yet.
  window.addEventListener("keydown",e=>{if(dialog.open&&!session()&&!(e.target instanceof HTMLInputElement)&&source.captureKey(e))e.preventDefault();});
  return {open};
}
