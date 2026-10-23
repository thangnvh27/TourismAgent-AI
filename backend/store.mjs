const copy=x=>JSON.parse(JSON.stringify(x));
export function memoryStore(){
  const docs=new Map();let queue=Promise.resolve();
  return {kind:'memory-test',get:async p=>docs.has(p)?copy(docs.get(p)):null,
    query:async(c,o={})=>{let rows=[...docs].filter(([p])=>p.startsWith(c+'/')&&p.split('/').length===c.split('/').length+1).map(([p,d])=>({...copy(d),id:p.split('/').at(-1),path:p}));for(const [k,op,v]of o.where||[])rows=rows.filter(d=>op==='=='?d[k]===v:op==='<'?d[k]<v:d[k]<=v);const k=o.orderBy||'createdAt';rows.sort((a,b)=>(String(a[k]).localeCompare(String(b[k]))||a.id.localeCompare(b.id))*(o.desc===false?1:-1));if(o.after)rows=rows.filter(d=>o.desc===false?d[k]>o.after.value||(d[k]===o.after.value&&d.id>o.after.id):d[k]<o.after.value||(d[k]===o.after.value&&d.id<o.after.id));return rows.slice(0,o.limit||20);},
    transaction:fn=>{const run=queue.then(async()=>{const pending=[];let writing=false;const r=await fn({get:async p=>{if(writing)throw Error('Read after write');return docs.has(p)?copy(docs.get(p)):null;},set:(p,d)=>{writing=true;pending.push([p,copy(d)]);},delete:p=>{writing=true;pending.push([p,null]);}});for(const [p,d]of pending)d?docs.set(p,d):docs.delete(p);return r;});queue=run.catch(()=>{});return run;},
    deleteTree:async p=>{for(const k of docs.keys())if(k===p||k.startsWith(p+'/'))docs.delete(k);},_docs:docs};
}
export async function firebaseStore(projectId){
  const {initializeApp,applicationDefault}=await import('firebase-admin/app');
  const {getFirestore,FieldPath}=await import('firebase-admin/firestore');
  const {getAuth}=await import('firebase-admin/auth');
  const app=initializeApp({projectId,credential:applicationDefault()});const db=getFirestore(app);
  return {kind:'firestore',db,verifyToken:token=>getAuth(app).verifyIdToken(token,true),get:async p=>{const s=await db.doc(p).get();return s.exists?s.data():null;},
    query:async(c,o={})=>{let q=db.collection(c);for(const [k,op,v]of o.where||[])q=q.where(k,op,v);const direction=o.desc===false?'asc':'desc';q=q.orderBy(o.orderBy||'createdAt',direction).orderBy(FieldPath.documentId(),direction);if(o.after)q=q.startAfter(o.after.value,o.after.id);const s=await q.limit(o.limit||20).get();return s.docs.map(d=>({...d.data(),id:d.id,path:d.ref.path}));},
    transaction:fn=>db.runTransaction(tx=>fn({get:async p=>{const s=await tx.get(db.doc(p));return s.exists?s.data():null;},set:(p,d)=>tx.set(db.doc(p),copy(d)),delete:p=>tx.delete(db.doc(p))})),
    deleteTree:p=>db.recursiveDelete(db.doc(p))};
}
