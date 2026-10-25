import express from "express";
import superjson from "superjson";
import path from "node:path";
import {settingsFixture} from "./settings-fixtures.mjs";
import {chatFixture} from "./chat-fixtures.mjs";
import {personaFixture} from "./persona-fixtures.mjs";
import {homeFixture} from "./home-fixtures.mjs";
import {scenesFixture} from "./scenes-fixtures.mjs";
import {socialFixture} from "./social-fixtures.mjs";
const root=path.resolve(import.meta.dirname,"..");
const user={id:1,username:"界面对照",name:"界面对照",email:"",role:"user",loginMethod:"local",createdAt:new Date("2026-10-01T00:00:00Z"),lastSignedIn:new Date("2026-10-24T00:00:00Z")};
function resolve(name,input,referer){
 if(name==="auth.me")return /\/(login|welcome)(?:[?#]|$)/.test(referer??"")?null:user;
 if(name==="user.getProfile")return user;
 if(name==="user.getAccountStats")return {totalPersonas:1,totalFiles:0,totalMessages:36,totalChats:18,fileCount:0,totalFileSize:0,storageUsed:0,daysActive:24};
 for(const fn of [personaFixture,homeFixture,scenesFixture,socialFixture,settingsFixture,chatFixture]){const value=fn(name,input);if(value!==undefined)return value;}
 return undefined;
}
function failure(name,message,code="PRECONDITION_FAILED"){return {error:{json:{message,code:-32012,data:{code,httpStatus:412,path:name}}}};}
const port = Number(process.env.UI_PREVIEW_PORT ?? "4173");
if (!Number.isInteger(port) || port < 1 || port > 65535) throw new Error("UI_PREVIEW_PORT 必须是1到65535之间的整数");
const dir = "ui-preview-dist";
const title = "界面阶段快照：合成数据，后台未接通";
{
 const app=express();app.disable("x-powered-by");
 app.use((req,res,next)=>{res.set("Cache-Control","no-store");res.set("X-Mirrai-Preview","ui-only");next()});
 app.use("/api/trpc",express.json({limit:"1mb"}));
 app.all(/^\/api\/trpc\/(.+)$/, (req,res)=>{
  const names=decodeURIComponent(req.params[0]).split(",");const batch=req.query.batch==="1";let inputs={};
  try{inputs=req.method==="GET"?JSON.parse(req.query.input??"{}"):req.body??{}}catch{}
  const results=names.map((name,i)=>{
   if(req.method!=="GET")return failure(name,"界面预览：此操作尚未接入后台，本次没有保存、发送或调用外部服务。");
   let input;try{input=superjson.deserialize(batch?inputs[i]??{json:null}:inputs)}catch{input=null}
   const value=resolve(name,input,req.headers.referer);
   if(value===undefined){console.log("未接入读取："+name);return failure(name,"界面预览：此模块的后台读取尚未接入。","NOT_IMPLEMENTED")}
   return {result:{data:superjson.serialize(value)}};
  });
  res.status(req.method==="GET"?200:412).json(batch?results:results[0]);
 });
 app.get("/api/auth/config",(_req,res)=>res.json(homeFixture("/api/auth/config",{})));
 app.all(/^\/api\/.*/,(_req,res)=>res.status(412).json({error:"界面预览：后台功能尚未接入，未执行操作。"}));
 app.use(express.static(path.join(root,dir),{index:false}));
 app.get(/.*/,(_req,res)=>res.sendFile(path.join(root,dir,"index.html")));
 app.listen(port,"127.0.0.1",()=>console.log(title+" http://127.0.0.1:"+port));
}
