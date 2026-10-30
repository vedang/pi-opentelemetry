import {mkdtemp,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {createAgentSessionServices,createAgentSessionFromServices,createAgentSessionRuntime,SessionManager,SettingsManager,ModelRuntime} from '@earendil-works/pi-coding-agent';
import {AssistantMessageEventStream} from '@earendil-works/pi-ai';
const dir=await mkdtemp(join(tmpdir(),'pi-otel-discovery-'));
const events=[];
const factory=async ({sessionManager,sessionStartEvent})=>{
 const modelRuntime=await ModelRuntime.create({authPath:join(dir,'auth.json'),modelsPath:null,modelsStorePath:join(dir,'models-cache.json'),refreshOnCreate:false});
 modelRuntime.registerProvider('fixture',{baseUrl:'http://127.0.0.1:1',apiKey:'fake',api:'fixture',models:[{id:'known',name:'Known',reasoning:false,input:['text'],cost:{input:1,output:1,cacheRead:1,cacheWrite:1},contextWindow:100000,maxTokens:1000}],streamSimple(model){const s=new AssistantMessageEventStream();queueMicrotask(()=>{const m={role:'assistant',api:'fixture',provider:'fixture',model:'known',content:[],timestamp:Date.now(),stopReason:'pending',usage:{input:3,output:2,cacheRead:1,cacheWrite:0,totalTokens:6,cost:{input:0.1,output:0.2,cacheRead:0.01,cacheWrite:0,total:0.31}}};s.push({type:'start',partial:m});m.stopReason='stop';s.push({type:'done',reason:'stop',message:m});s.end();});return s;}});
 const services=await createAgentSessionServices({cwd:dir,agentDir:dir,modelRuntime,settingsManager:SettingsManager.inMemory({compaction:{enabled:false},retry:{enabled:false}}),resourceLoaderOptions:{noExtensions:true,noSkills:true,noPromptTemplates:true,noThemes:true,noContextFiles:true,extensionFactories:[pi=>{for(const e of ['session_start','session_shutdown','agent_start','message_start','message_end','agent_end'])pi.on(e,(event)=>{events.push([e,event.message?.role,event.reason]);});}]}});
 return {...await createAgentSessionFromServices({services,sessionManager,sessionStartEvent,model:modelRuntime.getModel('fixture','known'),tools:[]}),services,diagnostics:[]};
};
try{const runtime=await createAgentSessionRuntime(factory,{cwd:dir,agentDir:dir,sessionManager:SessionManager.inMemory(dir)});await runtime.session.bindExtensions({});await runtime.session.prompt('synthetic');await runtime.newSession();await runtime.session.bindExtensions({});await runtime.dispose();console.log(JSON.stringify(events));}finally{await rm(dir,{recursive:true,force:true});}
