import { mkdirSync, readFileSync, rmSync, statSync, writeFileSync, writeSync } from 'node:fs';
import { dirname } from 'node:path';

const FORMATS = ['auto', 'unified', 'search-replace', 'v4a', 'json'];
class Exit2 { readonly line: string; constructor(line: string) { this.line = line; } }
class Fail { readonly code: string; readonly path: string; constructor(code: string, path: string) { this.code = code; this.path = path; } }
type Edit = (tree: Tree) => void;
const blank = (s: string): boolean => s.trim() === '';
function patchLines(text: string): string[] {
  if (text === '') return [];
  const a = text.split('\n'); if (text.endsWith('\n')) a.pop();
  return a.map(x => x.endsWith('\r') ? x.slice(0, -1) : x);
}
function safe(p: string): boolean { return p !== '' && !p.startsWith('/') && !p.includes('\\') && p.split('/').every(x => x !== '' && x !== '.' && x !== '..'); }
class Tree {
  private orig = new Map<string, string | null>(); readonly now = new Map<string, string | null>(); readonly moves = new Map<string,string>();
  original(p: string): string | null {
    if (!this.orig.has(p)) { let v: string | null = null; try { if (statSync(p).isFile()) v = readFileSync(p, 'utf8'); } catch {} this.orig.set(p, v); }
    return this.orig.get(p)!;
  }
  get(p: string): string | null { return this.now.has(p) ? this.now.get(p)! : this.original(p); }
}
function detect(lines: string[]): string | null {
  const i = lines.findIndex(x => !blank(x)); if (i < 0) return null;
  if (lines[i]!.trim() === '*** Begin Patch') return 'v4a';
  const c = lines[i]!.trimStart()[0]; if (c === '[' || c === '{') return 'json';
  if (lines.some(x => x.trimEnd() === '<<<<<<< SEARCH')) return 'search-replace';
  if (lines.some((x,j) => x.startsWith('diff --git ') || (x.startsWith('--- ') && (lines[j+1] ?? '').startsWith('+++ ')))) return 'unified';
  return null;
}
function lineParts(text: string): { lines: string[]; br: string; final: boolean } {
  const n = text.indexOf('\n'), br = n > 0 && text[n-1] === '\r' ? '\r\n' : '\n';
  if (text === '') return { lines: [], br, final: false };
  const a = text.split(br), final = text.endsWith(br); if (final) a.pop();
  return { lines: a, br, final };
}
function fromParts(lines: string[], br: string, final: boolean): string { return lines.length ? lines.join(br) + (final ? br : '') : ''; }
function tierMatches(file: string[], old: string[], strict: boolean): { tier: number; at: number[] } | null {
  for (let t=0;t<=(strict?0:2);t++) {
    const norm = (s:string) => t===0 ? s : t===1 ? s.replace(/[ \t]+$/g,'') : s.replace(/^[ \t]+|[ \t]+$/g,'');
    const at:number[]=[];
    for(let i=0;i+old.length<=file.length;i++) if(old.every((x,j)=>norm(file[i+j]!)===norm(x))) at.push(i);
    if(at.length) return {tier:t,at};
  }
  return null;
}
function reindent(lines:string[], old:string[], file:string[], at:number, tier:number, contexts?:boolean[]):string[] {
  if(!old.length)return lines;
  const f=(file[at]!.match(/^[ \t]*/)??[''])[0]!,p=(old[0]!.match(/^[ \t]*/)??[''])[0]!;
  const norm=(s:string)=>tier===0?s:tier===1?s.replace(/[ \t]+$/g,''):s.replace(/^[ \t]+|[ \t]+$/g,'');
  const mapped=new Map<number,number>();let oi=old.length-1;
  for(let j=lines.length-1;j>=0;j--)if(contexts?.[j]===true){while(oi>=0&&norm(old[oi]!)!==norm(lines[j]!))oi--;if(oi>=0)mapped.set(j,oi--);}
  return lines.map((x,j)=>contexts?.[j]===true&&mapped.has(j)?file[at+mapped.get(j)!]!:tier===2&&x.trim()&&x.startsWith(p)?f+x.slice(p.length):x);
}
function exists(tree:Tree,p:string):string { if(!safe(p)) throw new Fail('unsafe',p); const t=tree.get(p); if(t===null) throw new Fail('missing',p); return t; }
function create(tree:Tree,p:string,text:string):void { if(!safe(p)) throw new Fail('unsafe',p); if(tree.get(p)!==null) throw new Fail('exists',p); tree.now.set(p,text); }
function replaceLines(source:string,old:string[],next:string[],strict:boolean,choose:(positions:number[],tier:number)=>number, adjust=true):{text:string;at:number} {
  const q=lineParts(source), m=tierMatches(q.lines,old,strict); if(!m) throw new Fail('no-match','');
  const at=choose(m.at,m.tier), out=adjust?reindent(next,old,q.lines,at,m.tier):next;
  q.lines.splice(at,old.length,...out); return {text:fromParts(q.lines,q.br,q.final),at};
}
function jsonEdit(v:unknown):Edit|null {
 if(!v||typeof v!=='object'||Array.isArray(v))return null; const o=v as Record<string,unknown>,p=o.path; if(typeof p!=='string')return null;
 if(o.command==='create'&&typeof o.file_text==='string') return t=>create(t,p,o.file_text as string);
 if(o.command==='str_replace'&&typeof o.old_str==='string'&&o.old_str!==''&&(o.new_str===undefined||typeof o.new_str==='string')) return t=>{let s=exists(t,p); const n=s.indexOf('\n'),cr=n>0&&s[n-1]==='\r'; const lf=(x:string)=>cr?x.replaceAll('\r\n','\n'):x; s=lf(s);const old=lf(o.old_str as string), ne=lf((o.new_str as string|undefined)??'');let count=0;for(let k=s.indexOf(old);k>=0;k=s.indexOf(old,k+1))count++;if(!count)throw new Fail('no-match',p);if(count>1)throw new Fail('ambiguous',p);const k=s.indexOf(old),out=s.slice(0,k)+ne+s.slice(k+old.length);t.now.set(p,cr?out.replaceAll('\n','\r\n'):out);};
 if(o.command==='insert'&&typeof o.insert_line==='number'&&Number.isInteger(o.insert_line)&&typeof o.new_str==='string')return t=>{const s=exists(t,p),q=lineParts(s),at=o.insert_line as number;if(at<0||at>q.lines.length)throw new Fail('no-match',p);q.lines.splice(at,0,...patchLines(o.new_str as string));t.now.set(p,fromParts(q.lines,q.br,q.final));};
 return null;
}
function jsonEdits(text:string,lines:string[]):Edit[]{const first=lines.findIndex(x=>!blank(x));if(first<0)throw new Exit2('error: parse 1');const out:Edit[]=[];
 if(lines[first]!.trimStart().startsWith('[')){let v:unknown;try{v=JSON.parse(text)}catch{throw new Exit2(`error: parse ${first+1}`)}if(!Array.isArray(v))throw new Exit2(`error: parse ${first+1}`);for(const x of v){const e=jsonEdit(x);if(!e)throw new Exit2(`error: parse ${first+1}`);out.push(e)}return out;}
 lines.forEach((x,i)=>{if(blank(x))return;let e:Edit|null=null;try{e=jsonEdit(JSON.parse(x))}catch{}if(!e)throw new Exit2(`error: parse ${i+1}`);out.push(e)});return out;
}
function unifiedEdits(lines:string[],strict:boolean):Edit[]{
 type H={a:number;oldCount:number;newCount:number;old:string[];neu:string[];ctx:boolean[];nctx:boolean[];lastNo:boolean;oldLast:boolean}; type S={old:string|null;neu:string|null;renameOld?:string;renameNew?:string;creation:boolean;deletion:boolean;gitHeader?:boolean;fileHeader?:boolean;h:H[]};
 const ss:S[]=[];let s:S|null=null;
 const path=(x:string,pre:string)=>{let p=x.slice(pre.length).split('\t')[0]!.trim();if(p.startsWith('a/')||p.startsWith('b/'))p=p.slice(2);return p;};
 for(let i=0;i<lines.length;i++){
  const x=lines[i]!;
  if(x.startsWith('diff --git ')){const m=/^diff --git a\/(\S+) b\/(\S+)$/.exec(x);if(!m)throw new Exit2(`error: parse ${i+1}`);s={old:m[1]!,neu:m[2]!,creation:false,deletion:false,gitHeader:true,h:[]};ss.push(s);continue;}
  if(x.startsWith('@@')){if(!/^@@ -\d+(?:,\d+)? \+\d+(?:,\d+)? @@(?:.*)$/.test(x)||!s)throw new Exit2(`error: parse ${i+1}`);const hm=/^@@ -(\d+)(?:,(\d+))? \+(\d+)(?:,(\d+))? @@/.exec(x)!;const h:H={a:Number(hm[1]),oldCount:Number(hm[2]??1),newCount:Number(hm[4]??1),old:[],neu:[],ctx:[],nctx:[],lastNo:false,oldLast:false};s.h.push(h);let j=i+1;for(;j<lines.length;j++){const b=lines[j]!;if(b.startsWith('diff --git ')||(b.startsWith('--- ')&&(lines[j+1]??'').startsWith('+++ ')&&lines.slice(i+1,j).filter(y=>y[0]==='+'||y[0]==='-'||y==='').length>=h.oldCount))break;if(b.startsWith('\\')){h.lastNo=true;continue;}if(b!==''&&!/^[ +\\-]/.test(b))break;h.lastNo=false;if(b[0]===' '||b===''){const v=b===''?'':b.slice(1);h.old.push(v);h.neu.push(v);h.ctx.push(true);h.nctx.push(true)}else if(b[0]==='-'){h.old.push(b.slice(1));h.ctx.push(false);h.oldLast=b.slice(1)==='}'}else if(b[0]==='+'){h.neu.push(b.slice(1));h.nctx.push(false)}if(h.old.length===h.oldCount&&h.neu.length===h.newCount){if(lines[j+1]?.startsWith('\\')){h.lastNo=true;j++;}j++;break;}}i=j-1;continue;}
  if(x.startsWith('--- ')){if(!s||s.fileHeader||!s.gitHeader){s={old:null,neu:null,creation:false,deletion:false,h:[]};ss.push(s)}if(!(lines[i+1]??'').startsWith('+++ '))throw new Exit2(`error: parse ${i+2}`);s.fileHeader=true;s.old=path(x,'--- ');s.neu=path(lines[++i]!,'+++ ');if(s.old==='/dev/null')s.creation=true;if(s.neu==='/dev/null')s.deletion=true;continue;}
  if(s&&x.startsWith('rename from ')){s.renameOld=x.slice(12).trim().replace(/^[ab]\//,'');continue}if(s&&x.startsWith('rename to ')){s.renameNew=x.slice(10).trim().replace(/^[ab]\//,'');continue}
  if(s&&x.startsWith('new file mode'))s.creation=true;if(s&&x.startsWith('deleted file mode'))s.deletion=true;
 }
 if(!ss.length)throw new Exit2('error: parse 1');
 return ss.map(sec=>t=>{let old=sec.old??sec.renameOld??null, neu=sec.neu??sec.renameNew??null;if(old===null||neu===null)throw new Fail('no-match',String(old??neu??''));if(old==='/dev/null')sec.creation=true;if(neu==='/dev/null')sec.deletion=true;const src=sec.creation?null:old;if(sec.deletion){exists(t,old);t.now.set(old,null);return;}if(sec.creation){if(!safe(neu))throw new Fail('unsafe',neu);if(t.get(neu)!==null)throw new Fail('exists',neu);let content:string[]=[];for(const h of sec.h)content.push(...h.neu.filter((_,j)=>!h.ctx[j]));const no=sec.h.at(-1)?.lastNo??false;t.now.set(neu,content.length?content.join('\n')+(!no?'\n':''):'');return;}
 const original=exists(t,src!);if(old!==neu){if(!safe(neu))throw new Fail('unsafe',neu);if(t.get(neu)!==null)throw new Fail('exists',neu);}let q=lineParts(original),delta=0;for(const h of sec.h){const O=h.old,N=h.neu;let at:number;if(O.length){const m=tierMatches(q.lines,O,strict);if(!m)throw new Fail('no-match',src!);at=m.at.reduce((best,v)=>Math.abs(v-(h.a-1+delta))<Math.abs(best-(h.a-1+delta))?v:best);const written=reindent(N,O,q.lines,at,m.tier,h.nctx);q.lines.splice(at,O.length,...written);if(h.nctx.at(-1)===true&&q.lines[at+written.length]!==undefined&&q.lines[at+written.length-1]===q.lines[at+written.length])q.lines.splice(at+written.length,1);if(at+O.length>=q.lines.length||at+written.length>=q.lines.length)q.final=!h.lastNo;}else{at=Math.min(h.a+delta,q.lines.length);q.lines.splice(at,0,...N);if(at===q.lines.length)q.final=!h.lastNo;}delta+=N.length-O.length;}
 const result=fromParts(q.lines,q.br,q.final);if(old!==neu){t.now.set(old,null);t.now.set(neu,result);t.moves.set(old,neu)}else t.now.set(old,result);
 });
}
function searchEdits(lines:string[],strict:boolean):Edit[]{const out:Edit[]=[];let prev=-1,lastPath:string|null=null;
 for(let i=0;i<lines.length;i++){if(lines[i]!.trimEnd()!=='<<<<<<< SEARCH')continue;let sep=-1,end=-1;for(let j=i+1;j<lines.length;j++){if(sep<0&&lines[j]!.trimEnd()==='=======')sep=j;if(sep>=0&&lines[j]!.trimEnd()==='>>>>>>> REPLACE'){end=j;break;}}if(sep<0||end<0)throw new Exit2(`error: parse ${i+1}`);
 let p:string|null=null;for(let j=i-1;j>prev;j--)if(!blank(lines[j]!)&&!lines[j]!.trim().startsWith('```')){p=lines[j]!.trim();break;}p??=lastPath;if(p===null)throw new Exit2(`error: parse ${i+1}`);lastPath=p;prev=end;const old=lines.slice(i+1,sep),neu=lines.slice(sep+1,end);out.push(t=>{if(!safe(p!))throw new Fail('unsafe',p!);if(!old.length){create(t,p!,neu.length?neu.join('\n')+'\n':'');return}const src=exists(t,p!),q=lineParts(src),m=tierMatches(q.lines,old,strict);if(!m)throw new Fail('no-match',p!);if(m.at.length!==1)throw new Fail('ambiguous',p!);const at=m.at[0]!,written=reindent(neu,old,q.lines,at,m.tier);q.lines.splice(at,old.length,...written);t.now.set(p!,fromParts(q.lines,q.br,q.final));});i=end;
 }if(!out.length)throw new Exit2('error: parse 1');return out;
}
function v4aEdits(lines:string[],strict:boolean):Edit[]{const first=lines.findIndex(x=>!blank(x));let last=lines.length-1;while(last>=0&&blank(lines[last]!))last--;if(first<0||lines[first]!.trim()!=='*** Begin Patch')throw new Exit2(`error: parse ${first<0?1:first+1}`);if(last<0||lines[last]!.trim()!=='*** End Patch')throw new Exit2(`error: parse ${lines.length+1}`);
 const out:Edit[]=[];let i=first+1;while(i<last){if(blank(lines[i]!)){i++;continue}const header=lines[i]!,num=i+1;let m=/^\*\*\* (Add|Delete|Update) File: (.*)$/.exec(header);if(!m)throw new Exit2(`error: parse ${num}`);const kind=m[1]!,p=m[2]!.trim();i++;if(kind==='Add'){const a:string[]=[];while(i<last&&!lines[i]!.startsWith('*** ')){const x=lines[i++]!;if(x==='' )a.push('');else if(x.startsWith('+'))a.push(x.slice(1));else throw new Exit2(`error: parse ${i}`)}out.push(t=>create(t,p,a.length?a.join('\n')+'\n':''));continue}if(kind==='Delete'){if(i<last&&!blank(lines[i]!)&&!lines[i]!.startsWith('*** '))throw new Exit2(`error: parse ${i+1}`);out.push(t=>{exists(t,p);t.now.set(p,null)});continue}
 let move:string|null=null,chunks:{anchor:string;old:string[];neu:string[];ctx:boolean[];nctx:boolean[];eof:boolean}[]=[];if(lines[i]?.startsWith('*** Move to: ')){move=lines[i]!.slice(12).trim();i++}let chunk:{anchor:string;old:string[];neu:string[];ctx:boolean[];nctx:boolean[];eof:boolean}|null=null;
 while(i<last&&!/^\*\*\* (?:Add|Delete|Update) File: /.test(lines[i]!)){let x=lines[i]!;if(blank(x)&&!chunk){i++;continue}if(x.startsWith('@@')){if(chunk)chunks.push(chunk);chunk={anchor:x.slice(2).trim(),old:[],neu:[],ctx:[],nctx:[],eof:false};i++;continue}if(x==='*** End of File'){if(!chunk)chunk={anchor:'',old:[],neu:[],ctx:[],eof:true};else chunk.eof=true;i++;continue}if(!chunk)chunk={anchor:'',old:[],neu:[],ctx:[],nctx:[],eof:false};if(x===''||x[0]===' '){const v=x===''?'':x.slice(1);chunk.old.push(v);chunk.neu.push(v);chunk.ctx.push(true);chunk.nctx.push(true)}else if(x[0]==='-'){chunk.old.push(x.slice(1));chunk.ctx.push(false)}else if(x[0]==='+'){chunk.neu.push(x.slice(1));chunk.nctx.push(false)}else throw new Exit2(`error: parse ${i+1}`);i++}
 if(chunk){while(chunk.old.length&&chunk.old.at(-1)===''){chunk.old.pop();chunk.ctx.pop()}while(chunk.neu.length&&chunk.neu.at(-1)===''){chunk.neu.pop();chunk.nctx.pop()}chunks.push(chunk)}if(!chunks.length&&!move)throw new Exit2(`error: parse ${num}`);out.push(t=>{const src=exists(t,p);if(move!==null){if(!safe(move))throw new Fail('unsafe',move);if(t.get(move)!==null)throw new Fail('exists',move)}let q=lineParts(src),cursor=0;for(const c of chunks){if(c.anchor){let found=-1;for(let k=cursor;k<q.lines.length;k++){const m=tierMatches(q.lines.slice(k),[c.anchor],strict);if(m){found=k+m.at[0]!;break}}if(found<0)throw new Fail('no-match',p);cursor=found+1}const m=tierMatches(q.lines.slice(cursor),c.old,strict);if(!m)throw new Fail('no-match',p);let candidates=m.at.map(x=>x+cursor);if(c.eof)candidates=candidates.filter(x=>x+c.old.length===q.lines.length);if(!candidates.length)throw new Fail('no-match',p);const at=candidates[0]!,written=reindent(c.neu,c.old,q.lines,at,m.tier,c.nctx);q.lines.splice(at,c.old.length,...written);cursor=at+c.old.length;}const result=fromParts(q.lines,q.br,q.final);if(move!==null){t.now.set(p,null);t.now.set(move,result);t.moves.set(p,move)}else t.now.set(p,result)});
 }if(!out.length)throw new Exit2(`error: parse ${first+1}`);return out;
}
function run(args:string[]):{code:number;out:string[]}{let format:string|null=null,check=false,strict=false;const pos:string[]=[];let ended=false;
 for(const a of args){if(!ended&&a==='--')ended=true;else if(!ended&&a.startsWith('-')&&a!=='-'){if(a.startsWith('--format=')&&format===null&&FORMATS.includes(a.slice(9)))format=a.slice(9);else if(a==='--check'&&!check)check=true;else if(a==='--strict'&&!strict)strict=true;else return{code:2,out:['error: usage']}}else pos.push(a)}if(pos.length>1)return{code:2,out:['error: usage']};const file=pos.length===0||pos[0]==='-'?null:pos[0]!;let text='';try{text=readFileSync(file??0,'utf8')}catch{if(file!==null)return{code:2,out:['error: no-patch']}}
 const lines=patchLines(text),kind=format===null||format==='auto'?detect(lines):format;if(kind===null)return{code:2,out:['error: format']};let edits:Edit[];try{edits=kind==='json'?jsonEdits(text,lines):kind==='unified'?unifiedEdits(lines,strict):kind==='search-replace'?searchEdits(lines,strict):v4aEdits(lines,strict);if(!edits.length)throw new Exit2('error: parse 1')}catch(e){if(e instanceof Exit2)return{code:2,out:[e.line]};throw e}
 const tree=new Tree(),fails:Fail[]=[];for(const edit of edits){const before=new Map(tree.now);try{edit(tree)}catch(e){if(!(e instanceof Fail))throw e;tree.now.clear();for(const [k,v]of before)tree.now.set(k,v);fails.push(e)}}if(fails.length)return{code:1,out:[...fails.map(f=>`error: ${f.code} ${f.path}`),`failed: ${fails.length} of ${edits.length} edits`]};
 const changed=[...tree.now.keys()].filter(p=>tree.original(p)!==tree.now.get(p));const pairs=new Map<string,string>([...tree.moves].filter(([from,to])=>changed.includes(from)&&changed.includes(to)));const rows:string[]=[];for(const p of changed.sort((a,b)=>Buffer.compare(Buffer.from(a),Buffer.from(b)))){const pair=[...pairs].find(([,to])=>to===p);if(pair){rows.push(`R ${pair[0]} -> ${p}`);continue}if(pairs.has(p))continue;const was=tree.original(p),now=tree.now.get(p)!;rows.push(`${was===null?'A':now===null?'D':'M'} ${p}`)}
 if(!check)for(const p of changed){const v=tree.now.get(p)!;if(v===null)rmSync(p,{force:true});else{mkdirSync(dirname(p),{recursive:true});writeFileSync(p,v)}}return{code:0,out:[...rows,`ok: ${rows.length} ${rows.length===1?'file':'files'}`]};
}

const trialEnv = process.env.MAKEFUN_ENV_URL;
if (trialEnv !== undefined && trialEnv !== '') {
  // A trial: the kit's runner reads the checks from the env and runs this file on each one, without this variable.
  const { runTrial } = await import('./runner.ts');
  await runTrial(trialEnv);
} else {
  const r = run(process.argv.slice(2));
  writeSync(1, r.out.map((l) => `${l}\n`).join(''));
  process.exitCode = r.code;
}
