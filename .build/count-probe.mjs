const BASE = process.env.BASE;
const SECRET = "9598879826a344d8ac267a6754ee6d183aeb8d1f7d9ff6988c7f6167ce30e4d8";
function enc(b){let s="";for(const x of b)s+=String.fromCharCode(x);return btoa(s).replace(/\+/g,"-").replace(/\//g,"_").replace(/=+$/g,"");}
async function key(sec){const d=await crypto.subtle.digest("SHA-256",new TextEncoder().encode(sec));return crypto.subtle.importKey("raw",d,"AES-GCM",false,["encrypt","decrypt"]);}
async function seal(v,sec){const iv=crypto.getRandomValues(new Uint8Array(12));const k=await key(sec);const p=new TextEncoder().encode(JSON.stringify(v));const e=await crypto.subtle.encrypt({name:"AES-GCM",iv},k,p);return enc(iv)+"."+enc(new Uint8Array(e));}
const s={userId:"user_synthetic_student_a",googleSub:"synthetic_student_a",email:"a@qcu.edu.ph",name:"Maria",state:"ACTIVE",role:"student",createdAt:new Date().toISOString()};
const c=`qcu_platform_session=${await seal(s,SECRET)}`;
const list=async()=>{const r=await fetch(`${BASE}/api/v1/tasks`,{headers:{Cookie:c}});const b=await r.json();return b.data||[];};
console.log("initial tasks:", (await list()).map(t=>`${t.taskId.slice(0,12)} ${t.title} [${t.status}]`));
